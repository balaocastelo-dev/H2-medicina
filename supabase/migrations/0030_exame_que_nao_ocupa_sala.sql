-- =====================================================================
-- Exame que nao ocupa sala da clinica
--
-- A clinica relatou tres sintomas em 18/09 que sao o mesmo problema:
--   "consulta clinica ocupacional nao esta direcionando para modulo
--    medico, fica sem sala"
--   "raio x tambem esta ficando preso sem sala perdido no processo"
--   "sem pacientes na fila e mesmo assim mostrando paciente ali"
--
-- Nem todo item da lista de exames acontece numa sala daqui:
--   - Consulta clinica: e a avaliacao com o medico, atendida pela fila
--     do modulo medico, que e uma so para os consultorios.
--   - Raio X: nao e feito na clinica. O paciente leva a guia ao
--     laboratorio e o resultado volta depois.
--
-- Os dois entravam na fila de salas com sala nula e ficavam presos:
-- nenhum cartao os mostrava e nenhum botao os alcancava.
--
-- A correcao anterior barrava a criacao na recepcao, mas o check-in pelo
-- totem cria os exames direto do agendamento e passava por fora. Em vez
-- de remendar cada caminho de criacao, a regra passa a valer na hora de
-- USAR a fila -- que e por onde todos passam.
--
-- As linhas continuam sendo criadas de proposito: e assim que o sistema
-- sabe que aquele paciente pediu raio X, e e o CLINICO que decide se ele
-- vai ao consultorio no fim dos exames.
--
-- ATENCAO: a coleta laboratorial NAO entra aqui. Ela e feita na Sala 5
-- da clinica; o que ela nao tem e ficha de preenchimento na sala.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================

alter table public.exam_types
  add column if not exists ocupa_sala boolean not null default true;

comment on column public.exam_types.ocupa_sala is
  'Falso quando o exame nao e realizado numa sala da clinica: fica fora da fila de salas.';

update public.exam_types
   set ocupa_sala = (code not in ('RAIOX', 'CLINICO'));

-- ---------------------------------------------------------------------
-- Libera a sala que ficou presa por um exame que nunca seria chamado
-- ---------------------------------------------------------------------
update public.rooms r
   set status = 'disponivel', current_attendance_id = null
 where r.current_attendance_id is not null
   and not exists (
     select 1
       from public.patient_exams pe
       join public.exam_types et on et.id = pe.exam_type_id
      where pe.attendance_id = r.current_attendance_id
        and pe.status in ('chamado', 'em_andamento')
        and et.ocupa_sala
   );

-- ---------------------------------------------------------------------
-- O paciente pode ter varios exames chamados -- na MESMA sala
--
-- A trava antiga era `unique (attendance_id) where status in
-- ('chamado','em_andamento')`: no maximo um exame em atendimento por
-- paciente. Ela existe por um bom motivo -- ninguem pode ser chamado em
-- duas salas ao mesmo tempo -- mas tambem impedia chamar dois exames da
-- mesma sala de uma vez, que e o que a clinica pediu.
--
-- A regra certa nao e "um exame", e "uma sala". Um indice unico nao
-- consegue dizer isso, entao vira gatilho.
-- ---------------------------------------------------------------------
drop index if exists public.uq_patient_exam_in_service;

create or replace function public.tg_exame_em_uma_sala_so()
returns trigger
language plpgsql
as $$
declare
  v_outra uuid;
begin
  if new.status not in ('chamado','em_andamento') then
    return new;
  end if;

  select pe.room_id into v_outra
    from public.patient_exams pe
   where pe.attendance_id = new.attendance_id
     and pe.id <> new.id
     and pe.status in ('chamado','em_andamento')
     and pe.room_id is distinct from new.room_id
   limit 1;

  if found then
    raise exception
      'Paciente ja esta em atendimento em outra sala'
      using errcode = '23505';
  end if;

  return new;
end$$;

comment on function public.tg_exame_em_uma_sala_so() is
  'Impede o mesmo paciente de estar em atendimento em duas salas ao mesmo tempo. Varios exames na mesma sala sao permitidos.';

drop trigger if exists exame_em_uma_sala_so on public.patient_exams;
create trigger exame_em_uma_sala_so
before insert or update of status, room_id on public.patient_exams
for each row execute function public.tg_exame_em_uma_sala_so();

-- ---------------------------------------------------------------------
-- Chamar o proximo: so exame de sala, e TODOS os daquele paciente
--
-- "se o paciente tem varios exames para fazer em uma sala, ao chamar ele
--  na primeira vez ja aparecer todas as fichas e nao precisar chamar a
--  senha varias vezes"
--
-- Antes a chamada pegava um exame so. O paciente entrava, fazia um,
-- saia, e era chamado de novo pela mesma sala -- com a senha tocando na
-- TV a cada vez.
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
  v_quantos int;
begin
  if not public.can_access(p_tenant, 'filas.operar') then
    raise exception 'Sem permissao para operar filas' using errcode = '42501';
  end if;

  select * into v_room from public.rooms where id = p_room and tenant_id = p_tenant;
  if not found then raise exception 'Sala nao encontrada' using errcode = 'P0002'; end if;

  select pe.* into v_exam
    from public.patient_exams pe
    join public.attendances a on a.id = pe.attendance_id
    join public.exam_types et on et.id = pe.exam_type_id
   where pe.tenant_id = p_tenant
     and pe.status in ('pendente','em_fila')
     and et.ocupa_sala
     and a.finished_at is null and a.cancelled_at is null
     and a.stage_code in ('aguardando_exames','em_exames')
     and a.in_service = false
     and (
       exists (select 1 from public.room_exam_types ret
                where ret.room_id = p_room and ret.exam_type_id = pe.exam_type_id)
       or et.default_room_id = p_room
     )
     and not exists (
       select 1 from public.patient_exams x
         join public.exam_types xt on xt.id = x.exam_type_id
        where x.attendance_id = pe.attendance_id
          and x.status in ('chamado','em_andamento')
          and xt.ocupa_sala)
   order by
     case pe.priority when 'prioritario' then 0 when 'encaixe' then 1 else 2 end,
     coalesce(pe.queued_at, a.checkin_at) asc
   limit 1
   for update of pe skip locked;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  -- Chama TODOS os exames deste paciente que esta sala atende, de uma vez.
  update public.patient_exams pe
     set status = 'chamado', called_at = now(), room_id = p_room, updated_by = auth.uid()
    from public.exam_types et
   where et.id = pe.exam_type_id
     and pe.attendance_id = v_exam.attendance_id
     and pe.status in ('pendente','em_fila')
     and et.ocupa_sala
     and (
       exists (select 1 from public.room_exam_types ret
                where ret.room_id = p_room and ret.exam_type_id = pe.exam_type_id)
       or et.default_room_id = p_room
     );

  get diagnostics v_quantos = row_count;

  select * into v_exam from public.patient_exams where id = v_exam.id;

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

  -- Uma chamada de TV por paciente, nao uma por exame.
  insert into public.tv_calls (tenant_id, ticket_code, patient_label, room_name, destination, priority)
  values (p_tenant, coalesce(v_ticket.code, '---'),
          split_part(coalesce(v_patient_name,''), ' ', 1),
          v_room.name,
          case
            when v_room.kind in ('recepcao', 'guiche') then 'recepcao'
            when v_room.kind = 'triagem'               then 'triagem'
            else 'sala'
          end,
          v_exam.priority);

  return jsonb_build_object(
    'found', true,
    'exam', to_jsonb(v_exam),
    'ticket', to_jsonb(v_ticket),
    'exames_chamados', v_quantos);
end$$;

-- ---------------------------------------------------------------------
-- O gatilho de progresso passa a usar a coluna, nao o codigo fixo
-- ---------------------------------------------------------------------
create or replace function public.tg_patient_exam_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pending_count int;
  running_count int;
  tem_consulta boolean;
  att public.attendances%rowtype;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  select * into att from public.attendances where id = new.attendance_id;
  if not found then return new; end if;

  -- So conta como fila o que ocupa sala. A consulta clinica decide o
  -- destino mas nao segura a saida das filas: ela acontece depois.
  select
    count(*) filter (
      where coalesce(et.ocupa_sala, true)
        and pe.status in ('pendente','em_fila','chamado','em_andamento')
    ),
    count(*) filter (
      where coalesce(et.ocupa_sala, true)
        and pe.status in ('chamado','em_andamento')
    ),
    coalesce(bool_or(
      et.code = 'CLINICO'
        and pe.status in ('pendente','em_fila','chamado','em_andamento')
    ), false)
    into pending_count, running_count, tem_consulta
  from public.patient_exams pe
  left join public.exam_types et on et.id = pe.exam_type_id
  where pe.attendance_id = new.attendance_id;

  if running_count > 0 then
    update public.attendances
       set stage_code = 'em_exames',
           exams_started_at = coalesce(exams_started_at, now()),
           in_service = true,
           current_room_id = new.room_id
     where id = att.id and stage_code <> 'em_exames';

  elsif pending_count = 0 then
    update public.attendances
       set stage_code = case
             when tem_consulta then 'aguardando_medico'
             else 'aguardando_pagamento'
           end,
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

-- ---------------------------------------------------------------------
-- Destrava quem ja estava preso
--
-- Quem terminou os exames de sala antes desta correcao continua parado em
-- 'aguardando_exames', porque o que sobrou na fila era consulta ou raio X
-- -- que nunca seriam chamados. Empurra cada um para onde deveria estar.
-- ---------------------------------------------------------------------
update public.attendances a
   set stage_code = case
         when exists (
           select 1 from public.patient_exams pe
             join public.exam_types et on et.id = pe.exam_type_id
            where pe.attendance_id = a.id and et.code = 'CLINICO'
              and pe.status in ('pendente','em_fila','chamado','em_andamento')
         ) then 'aguardando_medico'
         else 'aguardando_pagamento'
       end,
       exams_finished_at = coalesce(a.exams_finished_at, now()),
       in_service = false,
       current_room_id = null
 where a.stage_code in ('aguardando_exames', 'em_exames')
   and a.finished_at is null
   and a.cancelled_at is null
   and a.deleted_at is null
   and not exists (
     select 1
       from public.patient_exams pe
       join public.exam_types et on et.id = pe.exam_type_id
      where pe.attendance_id = a.id
        and et.ocupa_sala
        and pe.status in ('pendente','em_fila','chamado','em_andamento')
   );
