-- =====================================================================
-- 0013 - Automacao do fluxo (CRM automatico), numeracao e RPCs
-- =====================================================================

-- ---------------------------------------------------------------------
-- Numeracao
-- ---------------------------------------------------------------------
create or replace function public.tg_attendance_number()
returns trigger language plpgsql as $$
begin
  if new.attendance_number is null then
    new.attendance_number := nextval('public.attendance_number_seq');
  end if;
  return new;
end$$;

drop trigger if exists set_attendance_number on public.attendances;
create trigger set_attendance_number before insert on public.attendances
for each row execute function public.tg_attendance_number();

create or replace function public.tg_order_number()
returns trigger language plpgsql as $$
begin
  if new.order_number is null or new.order_number = '' then
    new.order_number := to_char(now(), 'YYYYMM') || '-' ||
                        lpad(nextval('public.order_number_seq')::text, 6, '0');
  end if;
  return new;
end$$;

drop trigger if exists set_order_number on public.orders;
create trigger set_order_number before insert on public.orders
for each row execute function public.tg_order_number();

-- ---------------------------------------------------------------------
-- CRM: registra movimentacoes sempre que o estagio muda
-- ---------------------------------------------------------------------
create or replace function public.tg_attendance_stage_movement()
returns trigger language plpgsql as $$
declare
  seconds_prev int;
begin
  if tg_op = 'INSERT' then
    insert into public.crm_movements (tenant_id, attendance_id, from_stage, to_stage, is_manual, moved_by)
    values (new.tenant_id, new.id, null, new.stage_code, false, auth.uid());
    return new;
  end if;

  if new.stage_code is distinct from old.stage_code then
    seconds_prev := greatest(extract(epoch from (now() - coalesce(old.stage_changed_at, old.created_at)))::int, 0);
    new.stage_changed_at := now();
    insert into public.crm_movements
      (tenant_id, attendance_id, from_stage, to_stage, is_manual, moved_by, seconds_in_previous)
    values
      (new.tenant_id, new.id, old.stage_code, new.stage_code,
       coalesce(current_setting('app.manual_move', true) = 'on', false), auth.uid(), seconds_prev);
  end if;
  return new;
end$$;

drop trigger if exists attendance_stage_movement_ins on public.attendances;
create trigger attendance_stage_movement_ins after insert on public.attendances
for each row execute function public.tg_attendance_stage_movement();

drop trigger if exists attendance_stage_movement_upd on public.attendances;
create trigger attendance_stage_movement_upd before update on public.attendances
for each row execute function public.tg_attendance_stage_movement();

-- ---------------------------------------------------------------------
-- CRM automatico: reage ao ciclo de vida dos exames
-- ---------------------------------------------------------------------
create or replace function public.tg_patient_exam_progress()
returns trigger language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  pending_count int;
  running_count int;
  att public.attendances%rowtype;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  select * into att from public.attendances where id = new.attendance_id;
  if not found then return new; end if;

  select count(*) filter (where status in ('pendente','em_fila','chamado','em_andamento')),
         count(*) filter (where status in ('chamado','em_andamento'))
    into pending_count, running_count
  from public.patient_exams where attendance_id = new.attendance_id;

  if running_count > 0 then
    update public.attendances
       set stage_code = 'em_exames',
           exams_started_at = coalesce(exams_started_at, now()),
           in_service = true,
           current_room_id = new.room_id
     where id = att.id and stage_code <> 'em_exames';
  elsif pending_count = 0 then
    update public.attendances
       set stage_code = 'aguardando_medico',
           exams_finished_at = coalesce(exams_finished_at, now()),
           in_service = false,
           current_room_id = null
     where id = att.id and stage_code in ('em_exames','aguardando_exames');
  else
    update public.attendances
       set stage_code = case when stage_code = 'em_exames' then 'aguardando_exames' else stage_code end,
           in_service = false,
           current_room_id = null
     where id = att.id;
  end if;

  return new;
end$$;

drop trigger if exists patient_exam_progress on public.patient_exams;
create trigger patient_exam_progress after update on public.patient_exams
for each row execute function public.tg_patient_exam_progress();

-- Triagem concluida -> aguardando exames -----------------------------------
create or replace function public.tg_triage_finished()
returns trigger language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if new.finished_at is not null and old.finished_at is null then
    update public.attendances
       set stage_code = 'aguardando_exames',
           triage_finished_at = new.finished_at,
           in_service = false
     where id = new.attendance_id;
  elsif tg_op = 'INSERT' then
    update public.attendances
       set stage_code = 'em_triagem',
           triage_started_at = coalesce(triage_started_at, now()),
           in_service = true
     where id = new.attendance_id;
  end if;
  return new;
end$$;

drop trigger if exists triage_started on public.triages;
create trigger triage_started after insert on public.triages
for each row execute function public.tg_triage_finished();

drop trigger if exists triage_finished on public.triages;
create trigger triage_finished after update on public.triages
for each row execute function public.tg_triage_finished();

-- Consulta medica ----------------------------------------------------------
create or replace function public.tg_consultation_progress()
returns trigger language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    update public.attendances
       set stage_code = 'em_consulta',
           consultation_started_at = coalesce(consultation_started_at, now()),
           in_service = true,
           current_room_id = new.room_id
     where id = new.attendance_id;
  elsif new.finished_at is not null and old.finished_at is null then
    update public.attendances
       set stage_code = 'aguardando_documentos',
           consultation_finished_at = new.finished_at,
           in_service = false,
           current_room_id = null
     where id = new.attendance_id;
  end if;
  return new;
end$$;

drop trigger if exists consultation_started on public.medical_consultations;
create trigger consultation_started after insert on public.medical_consultations
for each row execute function public.tg_consultation_progress();

drop trigger if exists consultation_finished on public.medical_consultations;
create trigger consultation_finished after update on public.medical_consultations
for each row execute function public.tg_consultation_progress();

-- Historico de status do pedido -------------------------------------------
create or replace function public.tg_order_status_history()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into public.order_status_history (tenant_id, order_id, from_status, to_status, changed_by, is_manual)
    values (new.tenant_id, new.id, null, new.status, auth.uid(), false);
  elsif new.status is distinct from old.status then
    insert into public.order_status_history (tenant_id, order_id, from_status, to_status, changed_by, is_manual)
    values (new.tenant_id, new.id, old.status, new.status, auth.uid(), true);
  end if;
  return new;
end$$;

drop trigger if exists order_status_history_trg on public.orders;
create trigger order_status_history_trg after insert or update on public.orders
for each row execute function public.tg_order_status_history();

-- Historico de status da sala ----------------------------------------------
create or replace function public.tg_room_status_history()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  insert into public.room_status_history (tenant_id, room_id, status, attendance_id, changed_by)
  values (new.tenant_id, new.id, new.status, new.current_attendance_id, auth.uid());
  return new;
end$$;

drop trigger if exists room_status_history_trg on public.rooms;
create trigger room_status_history_trg after insert or update on public.rooms
for each row execute function public.tg_room_status_history();

-- Revisao de triagem --------------------------------------------------------
create or replace function public.tg_triage_revision()
returns trigger language plpgsql as $$
begin
  insert into public.triage_revisions (tenant_id, triage_id, changed_by, previous, current)
  values (new.tenant_id, new.id, auth.uid(), to_jsonb(old), to_jsonb(new));
  return new;
end$$;

drop trigger if exists triage_revision_trg on public.triages;
create trigger triage_revision_trg after update on public.triages
for each row execute function public.tg_triage_revision();

-- ---------------------------------------------------------------------
-- RPC: proxima sequencia de senha do dia
-- ---------------------------------------------------------------------
create or replace function public.next_ticket_sequence(p_tenant uuid, p_date date, p_prefix text)
returns int
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare nxt int;
begin
  select coalesce(max(sequence), 0) + 1 into nxt
  from public.queue_tickets
  where tenant_id = p_tenant and service_date = p_date and prefix = p_prefix;
  return nxt;
end$$;

-- ---------------------------------------------------------------------
-- RPC: check-in no totem (cria atendimento + senha + fila de exames)
-- ---------------------------------------------------------------------
create or replace function public.checkin_patient(
  p_tenant uuid,
  p_appointment uuid default null,
  p_patient uuid default null,
  p_priority priority_level default 'normal',
  p_totem uuid default null,
  p_device text default null
)
returns jsonb
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_app public.appointments%rowtype;
  v_patient uuid;
  v_company uuid;
  v_attendance uuid;
  v_prefix text;
  v_seq int;
  v_ticket public.queue_tickets%rowtype;
  v_needs_triage boolean := true;
  v_prefixes jsonb;
begin
  if not public.can_access(p_tenant, 'totem.operar') then
    raise exception 'Sem permissao para realizar check-in' using errcode = '42501';
  end if;

  if p_appointment is not null then
    select * into v_app from public.appointments
     where id = p_appointment and tenant_id = p_tenant and deleted_at is null;
    if not found then
      raise exception 'Agendamento nao encontrado' using errcode = 'P0002';
    end if;
    v_patient := v_app.patient_id;
    v_company := v_app.company_id;
    if p_priority = 'normal' then p_priority := v_app.priority; end if;
  else
    v_patient := p_patient;
    select company_id into v_company from public.patients where id = v_patient and tenant_id = p_tenant;
  end if;

  if v_patient is null then
    raise exception 'Paciente nao informado' using errcode = '22023';
  end if;

  -- Impede check-in duplicado no mesmo dia
  select id into v_attendance from public.attendances
   where tenant_id = p_tenant and patient_id = v_patient
     and finished_at is null and cancelled_at is null and deleted_at is null
     and checkin_at >= date_trunc('day', now())
   limit 1;

  if v_attendance is not null then
    select * into v_ticket from public.queue_tickets where attendance_id = v_attendance limit 1;
    return jsonb_build_object('attendance_id', v_attendance, 'ticket', to_jsonb(v_ticket), 'already_checked_in', true);
  end if;

  select coalesce((settings->>'exige_triagem')::boolean, true) into v_needs_triage
    from public.tenant_settings where tenant_id = p_tenant and group_key = 'filas';
  v_needs_triage := coalesce(v_needs_triage, true);

  insert into public.attendances
    (tenant_id, appointment_id, patient_id, company_id, order_id, priority, needs_triage,
     stage_code, origin, created_by)
  values
    (p_tenant, p_appointment, v_patient, v_company, v_app.order_id, p_priority, v_needs_triage,
     'aguardando_recepcao', 'totem', auth.uid())
  returning id into v_attendance;

  -- Prefixos configuraveis pelo tenant
  select coalesce(settings->'prefixos', '{}'::jsonb) into v_prefixes
    from public.tenant_settings where tenant_id = p_tenant and group_key = 'totem';

  v_prefix := coalesce(
    v_prefixes->>(p_priority::text),
    case p_priority when 'prioritario' then 'P' when 'encaixe' then 'E' else 'A' end);

  v_seq := public.next_ticket_sequence(p_tenant, (now() at time zone 'America/Sao_Paulo')::date, v_prefix);

  insert into public.queue_tickets
    (tenant_id, attendance_id, appointment_id, patient_id, totem_id, prefix, sequence,
     ticket_type, origin, device_info)
  values
    (p_tenant, v_attendance, p_appointment, v_patient, p_totem, v_prefix, v_seq,
     p_priority, 'totem', p_device)
  returning * into v_ticket;

  -- Cria a fila de exames a partir do agendamento
  if p_appointment is not null then
    insert into public.patient_exams
      (tenant_id, attendance_id, patient_id, appointment_id, exam_type_id, status, priority,
       room_id, sort_order)
    select p_tenant, v_attendance, v_patient, p_appointment, ae.exam_type_id, 'pendente', p_priority,
           et.default_room_id, et.sort_order
      from public.appointment_exams ae
      join public.exam_types et on et.id = ae.exam_type_id
     where ae.appointment_id = p_appointment
    on conflict (attendance_id, exam_type_id) do nothing;

    update public.appointments set status = 'checkin' where id = p_appointment;
  end if;

  insert into public.queue_events (tenant_id, ticket_id, attendance_id, event, destination)
  values (p_tenant, v_ticket.id, v_attendance, 'emitida', 'recepcao');

  return jsonb_build_object('attendance_id', v_attendance, 'ticket', to_jsonb(v_ticket), 'already_checked_in', false);
end$$;

-- ---------------------------------------------------------------------
-- RPC: chamar proximo da fila de uma sala (atendimento cruzado)
-- ---------------------------------------------------------------------
create or replace function public.call_next_for_room(p_tenant uuid, p_room uuid)
returns jsonb
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_exam public.patient_exams%rowtype;
  v_ticket public.queue_tickets%rowtype;
  v_room public.rooms%rowtype;
  v_patient_name text;
begin
  if not public.can_access(p_tenant, 'filas.operar') then
    raise exception 'Sem permissao para operar filas' using errcode = '42501';
  end if;

  select * into v_room from public.rooms where id = p_room and tenant_id = p_tenant;
  if not found then raise exception 'Sala nao encontrada' using errcode = 'P0002'; end if;

  -- Seleciona o proximo exame elegivel:
  --  1) exames que a sala atende
  --  2) paciente nao pode estar em atendimento em outra sala
  --  3) ordem: prioridade -> tempo de espera
  select pe.* into v_exam
    from public.patient_exams pe
    join public.attendances a on a.id = pe.attendance_id
   where pe.tenant_id = p_tenant
     and pe.status in ('pendente','em_fila')
     and a.finished_at is null and a.cancelled_at is null
     and a.stage_code in ('aguardando_exames','em_exames')
     and a.in_service = false
     and (
       exists (select 1 from public.room_exam_types ret
                where ret.room_id = p_room and ret.exam_type_id = pe.exam_type_id)
       or exists (select 1 from public.exam_types et
                where et.id = pe.exam_type_id and et.default_room_id = p_room)
     )
     and not exists (
       select 1 from public.patient_exams x
        where x.attendance_id = pe.attendance_id and x.status in ('chamado','em_andamento'))
   order by
     case pe.priority when 'prioritario' then 0 when 'encaixe' then 1 else 2 end,
     coalesce(pe.queued_at, a.checkin_at) asc
   limit 1
   for update of pe skip locked;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  update public.patient_exams
     set status = 'chamado', called_at = now(), room_id = p_room, updated_by = auth.uid()
   where id = v_exam.id
  returning * into v_exam;

  update public.rooms
     set status = 'ocupada', current_attendance_id = v_exam.attendance_id
   where id = p_room;

  select qt.* into v_ticket
    from public.queue_tickets qt
   where qt.attendance_id = v_exam.attendance_id
   limit 1;

  select coalesce(p.social_name, p.full_name) into v_patient_name
    from public.patients p
   where p.id = v_exam.patient_id;

  insert into public.queue_events (tenant_id, ticket_id, attendance_id, room_id, exam_id, event, destination, called_by)
  values (p_tenant, v_ticket.id, v_exam.attendance_id, p_room, v_exam.id, 'chamada', 'sala', auth.uid());

  insert into public.tv_calls (tenant_id, ticket_code, patient_label, room_name, destination, priority)
  values (p_tenant, coalesce(v_ticket.code, '---'),
          split_part(coalesce(v_patient_name,''), ' ', 1),
          v_room.name, 'sala', v_exam.priority);

  return jsonb_build_object('found', true, 'exam', to_jsonb(v_exam), 'ticket', to_jsonb(v_ticket));
end$$;

-- ---------------------------------------------------------------------
-- RPC: mover atendimento de estagio manualmente (CRM drag and drop)
-- ---------------------------------------------------------------------
create or replace function public.move_attendance_stage(
  p_attendance uuid, p_stage text, p_reason text default null)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.attendances where id = p_attendance;
  if v_tenant is null then raise exception 'Atendimento nao encontrado' using errcode='P0002'; end if;
  if not public.can_access(v_tenant, 'crm.mover_manual') then
    raise exception 'Sem permissao para mover manualmente' using errcode = '42501';
  end if;
  if not exists (select 1 from public.crm_stages where tenant_id = v_tenant and code = p_stage and is_active) then
    raise exception 'Estagio invalido' using errcode = '22023';
  end if;

  perform set_config('app.manual_move', 'on', true);
  update public.attendances
     set stage_code = p_stage,
         updated_by = auth.uid(),
         finished_at = case when p_stage = 'finalizado' then coalesce(finished_at, now()) else finished_at end,
         cancelled_at = case when p_stage = 'cancelado' then coalesce(cancelled_at, now()) else cancelled_at end,
         absent_at = case when p_stage = 'ausente' then coalesce(absent_at, now()) else absent_at end,
         notes = coalesce(notes, '') || case when p_reason is null then '' else E'\n[CRM] ' || p_reason end
   where id = p_attendance;
  perform set_config('app.manual_move', 'off', true);
end$$;

grant execute on function public.checkin_patient(uuid,uuid,uuid,priority_level,uuid,text) to authenticated;
grant execute on function public.call_next_for_room(uuid,uuid) to authenticated;
grant execute on function public.move_attendance_stage(uuid,text,text) to authenticated;
grant execute on function public.next_ticket_sequence(uuid,date,text) to authenticated;
