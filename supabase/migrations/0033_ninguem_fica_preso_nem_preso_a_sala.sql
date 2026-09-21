-- =====================================================================
-- 0033 - Tres buracos encontrados no pente fino de 21/09
--
-- Nenhum dos tres tem reclamacao da clinica ainda. Sairam de um teste que
-- passou dez pacientes pelo sistema inteiro e conferiu o dia peca por peca:
-- sao contradicoes entre partes que, sozinhas, passam.
--
--   1. Quem passa pela triagem e nao tem exame de sala fica preso.
--   2. Cancelar ou marcar ausente nao solta o paciente nem a sala.
--   3. A consulta clinica nunca e concluida.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Uma sala presa a um atendimento que acabou
--
-- Tres lugares diferentes precisam soltar sala: o fim da triagem, a etapa
-- terminal e o encerramento. Escrever a mesma coisa tres vezes e garantir
-- que uma delas fique para tras na proxima alteracao.
-- ---------------------------------------------------------------------
create or replace function public.liberar_salas_do_atendimento(p_attendance uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.rooms
     set status = 'disponivel', current_attendance_id = null
   where current_attendance_id = p_attendance;
end$$;

comment on function public.liberar_salas_do_atendimento(uuid) is
  'Solta qualquer sala que ainda aponte para o atendimento. Usada ao encerrar, cancelar e ao fim da triagem.';


-- ---------------------------------------------------------------------
-- 1. Fim da triagem: o destino depende do que o paciente tem para fazer
--
-- O gatilho mandava TODO mundo para 'aguardando_exames' ao fim da triagem.
-- Quem sai da triagem sem nenhum exame de sala -- o caso de quem veio so
-- para a consulta ocupacional -- caia numa fila em que nao havia nada para
-- concluir. E a fila de exames que dispara a etapa seguinte; sem exame,
-- nada dispara.
--
-- O paciente ficava invisivel: nao aparecia em sala nenhuma, nao aparecia
-- na fila do medico (que so enxerga 'aguardando_medico') e nem no aviso de
-- exame pendente (que ignora justamente 'aguardando_exames'). So apareceria
-- se alguem o procurasse pelo nome.
--
-- O destino agora e o mesmo que o gatilho dos exames ja usava: fila se ha
-- exame de sala, medico se ha consulta marcada, pagamento se nao ha nem um
-- nem outro.
-- ---------------------------------------------------------------------
create or replace function public.tg_triage_finished()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_na_fila int;
  v_tem_consulta boolean;
begin
  if new.finished_at is not null and old.finished_at is null then
    select
      count(*) filter (
        where coalesce(et.ocupa_sala, true)
          and pe.status in ('pendente','em_fila','chamado','em_andamento')),
      coalesce(bool_or(
        et.code = 'CLINICO'
          and pe.status in ('pendente','em_fila','chamado','em_andamento')), false)
      into v_na_fila, v_tem_consulta
      from public.patient_exams pe
      left join public.exam_types et on et.id = pe.exam_type_id
     where pe.attendance_id = new.attendance_id;

    update public.attendances
       set stage_code = case
             when v_na_fila > 0   then 'aguardando_exames'
             when v_tem_consulta  then 'aguardando_medico'
             else                      'aguardando_pagamento'
           end,
           triage_finished_at = new.finished_at,
           in_service = false,
           current_room_id = null
     where id = new.attendance_id;

    perform public.liberar_salas_do_atendimento(new.attendance_id);

  elsif tg_op = 'INSERT' then
    update public.attendances
       set stage_code = 'em_triagem',
           triage_started_at = coalesce(triage_started_at, now()),
           in_service = true
     where id = new.attendance_id;
  end if;
  return new;
end$$;

comment on function public.tg_triage_finished() is
  'Ao fim da triagem, manda o paciente para a fila, para o medico ou para o pagamento, conforme o que ele tem a fazer.';


-- ---------------------------------------------------------------------
-- 2. Etapa terminal solta o paciente e a sala
--
-- `move_attendance_stage` trocava o codigo da etapa e mais nada. Cancelar
-- um paciente que ja tinha sido chamado para uma sala deixava:
--
--   - `attendances.in_service = true`, ou seja, contado como em atendimento
--     no painel, para sempre;
--   - `attendances.current_room_id` apontando para a sala;
--   - `rooms.current_attendance_id` apontando para ele, com a sala marcada
--     como ocupada -- e o botao de chamar o proximo nao voltava ali.
--
-- Na tela existe codigo que solta a sala depois de cancelar. Mas a funcao e
-- chamavel por outros caminhos, e a garantia tem de estar onde a etapa muda.
-- ---------------------------------------------------------------------
create or replace function public.move_attendance_stage(
  p_attendance uuid, p_stage text, p_reason text default null)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_terminal boolean;
begin
  select tenant_id into v_tenant from public.attendances where id = p_attendance;
  if v_tenant is null then raise exception 'Atendimento nao encontrado' using errcode='P0002'; end if;
  if not public.can_access(v_tenant, 'crm.mover_manual') then
    raise exception 'Sem permissao para mover manualmente' using errcode = '42501';
  end if;
  if not exists (select 1 from public.crm_stages where tenant_id = v_tenant and code = p_stage and is_active) then
    raise exception 'Estagio invalido' using errcode = '22023';
  end if;

  v_terminal := p_stage in ('finalizado','cancelado','ausente');

  perform set_config('app.manual_move', 'on', true);
  update public.attendances
     set stage_code = p_stage,
         updated_by = auth.uid(),
         finished_at = case when p_stage = 'finalizado' then coalesce(finished_at, now()) else finished_at end,
         cancelled_at = case when p_stage = 'cancelado' then coalesce(cancelled_at, now()) else cancelled_at end,
         absent_at = case when p_stage = 'ausente' then coalesce(absent_at, now()) else absent_at end,
         in_service = case when v_terminal then false else in_service end,
         current_room_id = case when v_terminal then null else current_room_id end,
         notes = coalesce(notes, '') || case when p_reason is null then '' else E'\n[CRM] ' || p_reason end
   where id = p_attendance;
  perform set_config('app.manual_move', 'off', true);

  if v_terminal then
    perform public.liberar_salas_do_atendimento(p_attendance);

    -- Exame de quem foi embora nao e exame pendente. Sem isto ele fica na
    -- contagem de pendencias da clinica para sempre.
    if p_stage in ('cancelado','ausente') then
      update public.patient_exams
         set status = 'cancelado', updated_by = auth.uid()
       where attendance_id = p_attendance
         and status in ('pendente','em_fila','chamado','em_andamento');
    end if;
  end if;
end$$;

grant execute on function public.move_attendance_stage(uuid,text,text) to authenticated;
grant execute on function public.liberar_salas_do_atendimento(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 3. Assinar a consulta conclui a consulta clinica
--
-- 'Consulta clinica ocupacional' e um tipo de exame como os outros: a
-- recepcao marca, ela entra em `patient_exams` e e ela que decide se o
-- paciente vai ao medico. Mas nenhuma tela a concluia.
--
-- O atendimento terminava, o paciente ia embora, e a consulta ficava
-- 'pendente' no prontuario dele para sempre -- aparecendo como exame nao
-- realizado na relacao de exames e no historico do paciente.
--
-- Quem conclui e quem faz: assinar a consulta conclui o item.
-- ---------------------------------------------------------------------
create or replace function public.tg_consultation_progress()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    update public.attendances
       set stage_code = 'em_consulta',
           consultation_started_at = coalesce(consultation_started_at, now()),
           in_service = true,
           -- coalesce: consulta sem sala informada nao desfaz a chamada que
           -- levou o paciente ate o consultorio.
           current_room_id = coalesce(new.room_id, current_room_id)
     where id = new.attendance_id;

  elsif new.finished_at is not null and old.finished_at is null then
    update public.attendances
       set stage_code = 'aguardando_documentos',
           consultation_finished_at = new.finished_at,
           in_service = false,
           current_room_id = null
     where id = new.attendance_id;

    perform public.liberar_salas_do_atendimento(new.attendance_id);

    update public.patient_exams pe
       set status = 'concluido',
           started_at = coalesce(pe.started_at, new.started_at),
           finished_at = coalesce(pe.finished_at, new.finished_at),
           professional_id = coalesce(pe.professional_id, new.doctor_id),
           updated_by = auth.uid()
      from public.exam_types et
     where et.id = pe.exam_type_id
       and et.code = 'CLINICO'
       and pe.attendance_id = new.attendance_id
       and pe.status not in ('concluido','cancelado','nao_realizado');
  end if;
  return new;
end$$;

comment on function public.tg_consultation_progress() is
  'Abre e fecha a consulta: muda a etapa, solta a sala e conclui o item Consulta clinica ocupacional.';


-- ---------------------------------------------------------------------
-- 4. Conserta o que ja esta gravado
-- ---------------------------------------------------------------------

-- Sala apontando para atendimento que ja acabou.
update public.rooms r
   set status = 'disponivel', current_attendance_id = null
  from public.attendances a
 where a.id = r.current_attendance_id
   and (a.finished_at is not null or a.cancelled_at is not null or a.absent_at is not null
        or a.stage_code in ('finalizado','cancelado','ausente'));

-- Paciente contado como em atendimento depois de ter ido embora.
update public.attendances
   set in_service = false, current_room_id = null
 where stage_code in ('finalizado','cancelado','ausente')
   and (in_service or current_room_id is not null);

-- Exame ativo de quem foi embora.
update public.patient_exams pe
   set status = 'cancelado'
  from public.attendances a
 where a.id = pe.attendance_id
   and a.stage_code in ('cancelado','ausente')
   and pe.status in ('pendente','em_fila','chamado','em_andamento');

-- Consulta clinica que ficou pendente numa consulta ja assinada.
update public.patient_exams pe
   set status = 'concluido',
       started_at = coalesce(pe.started_at, mc.started_at),
       finished_at = coalesce(pe.finished_at, mc.finished_at),
       professional_id = coalesce(pe.professional_id, mc.doctor_id)
  from public.exam_types et, public.medical_consultations mc
 where et.id = pe.exam_type_id
   and et.code = 'CLINICO'
   and mc.attendance_id = pe.attendance_id
   and mc.finished_at is not null
   and pe.status not in ('concluido','cancelado','nao_realizado');

-- Paciente parado em 'aguardando_exames' sem nenhum exame de sala para fazer.
update public.attendances a
   set stage_code = case
         when exists (
           select 1 from public.patient_exams pe
             join public.exam_types et on et.id = pe.exam_type_id
            where pe.attendance_id = a.id and et.code = 'CLINICO'
              and pe.status in ('pendente','em_fila','chamado','em_andamento')
         ) then 'aguardando_medico'
         else 'aguardando_pagamento'
       end
 where a.stage_code = 'aguardando_exames'
   and a.finished_at is null and a.cancelled_at is null and a.absent_at is null
   and not exists (
     select 1 from public.patient_exams pe
       join public.exam_types et on et.id = pe.exam_type_id
      where pe.attendance_id = a.id
        and coalesce(et.ocupa_sala, true)
        and pe.status in ('pendente','em_fila','chamado','em_andamento'));
