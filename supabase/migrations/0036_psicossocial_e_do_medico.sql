-- =====================================================================
-- 0036 - A avaliacao psicossocial e do medico
--
-- "a avaliacao psicossocial esta se repetindo, aparece tanto na triagem
--  quanto no modulo medico, pode deixar somente no modulo medico"
--                                              -- Isabella, 21/09
--
-- O questionario psicossocial estava em dois lugares: como exame de
-- bancada na triagem e como bloco da consulta. O paciente respondia duas
-- vezes as mesmas perguntas -- inclusive as de ideacao suicida, que nao e
-- coisa para se perguntar duas vezes na mesma manha.
--
-- Ele continua sendo um item que a recepcao marca e que a clinica cobra.
-- O que muda e quem pergunta: o medico, na consulta.
--
-- Consequencia: como a consulta clinica, o psicossocial deixa de ocupar
-- sala e passa a ser um dos itens que levam o paciente ao medico. Sem essa
-- segunda parte, quem marcasse so o psicossocial ficaria numa fila sem
-- ninguem para chama-lo -- o mesmo buraco de 15/09.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Psicossocial sai das salas
-- ---------------------------------------------------------------------
update public.exam_types
   set ocupa_sala = false
 where code = 'PSICO';

delete from public.room_exam_types ret
 using public.exam_types et
 where et.id = ret.exam_type_id and et.code = 'PSICO';

update public.exam_types
   set default_room_id = null
 where code = 'PSICO';


-- ---------------------------------------------------------------------
-- 2. Quem decide que o paciente vai ao medico
--
-- Era so a consulta clinica. Agora e ela ou o psicossocial: os dois sao
-- perguntados pelo medico.
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

  -- Paciente em triagem nao e movido pela bancada. `tg_triage_finished`
  -- decide para onde ele vai quando a ficha for finalizada.
  if att.stage_code in ('aguardando_triagem', 'em_triagem') then
    return new;
  end if;

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
      et.code in ('CLINICO','PSICO')
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
-- 3. O fim da triagem segue a mesma regra
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
        et.code in ('CLINICO','PSICO')
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


-- ---------------------------------------------------------------------
-- 4. Assinar a consulta fecha tambem o psicossocial
--
-- Quem responde e o medico, na mesma consulta. Deixar o item pendente
-- depois da consulta assinada seria repetir o defeito de 21/09.
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
       and et.code in ('CLINICO','PSICO')
       and pe.attendance_id = new.attendance_id
       and pe.status not in ('concluido','cancelado','nao_realizado');
  end if;
  return new;
end$$;


-- ---------------------------------------------------------------------
-- 5. Conserta o que ja esta gravado
-- ---------------------------------------------------------------------

-- Psicossocial pendente em consulta ja assinada.
update public.patient_exams pe
   set status = 'concluido',
       started_at = coalesce(pe.started_at, mc.started_at),
       finished_at = coalesce(pe.finished_at, mc.finished_at),
       professional_id = coalesce(pe.professional_id, mc.doctor_id)
  from public.exam_types et, public.medical_consultations mc
 where et.id = pe.exam_type_id
   and et.code = 'PSICO'
   and mc.attendance_id = pe.attendance_id
   and mc.finished_at is not null
   and pe.status not in ('concluido','cancelado','nao_realizado');

-- Quem estava numa fila so por causa do psicossocial vai ao medico.
update public.attendances a
   set stage_code = 'aguardando_medico'
 where a.stage_code in ('aguardando_exames','em_exames')
   and a.finished_at is null and a.cancelled_at is null and a.absent_at is null
   and not exists (
     select 1 from public.patient_exams pe
       join public.exam_types et on et.id = pe.exam_type_id
      where pe.attendance_id = a.id
        and coalesce(et.ocupa_sala, true)
        and pe.status in ('pendente','em_fila','chamado','em_andamento'))
   and exists (
     select 1 from public.patient_exams pe
       join public.exam_types et on et.id = pe.exam_type_id
      where pe.attendance_id = a.id
        and et.code in ('CLINICO','PSICO')
        and pe.status in ('pendente','em_fila','chamado','em_andamento'));
