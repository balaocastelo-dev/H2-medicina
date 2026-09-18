-- =====================================================================
-- So vai ao medico quem tem consulta marcada
--
-- "a consulta clinica ocupacional e a propria avaliacao com o medico.
--  entao o paciente so deve passar pelo medico se o icone 'consulta
--  clinica ocupacional' estiver ticado. se nao, ele finaliza os exames e
--  pode ir embora (acontece casos do paciente ir la apenas para fazer
--  eletroencefalo por exemplo e nao precisar ir pro medico)"
--                                              -- Isabella, 17/09/2026
--
-- Ate aqui o gatilho mandava TODO mundo para 'aguardando_medico' quando
-- os exames acabavam. Quem foi so fazer um eletroencefalograma caia na
-- fila do consultorio e ficava la, esperando uma consulta que ninguem
-- pediu, ate alguem notar e tirar na mao.
--
-- De quebra, isto resolve um travamento: a propria consulta e um item de
-- `patient_exams`, entao ela contava como exame pendente e segurava a
-- transicao. O paciente com consulta marcada so saia de 'aguardando_exames'
-- se alguem concluisse a consulta antes de ela acontecer.
--
-- Agora a consulta e contada a parte: ela decide o destino, nao atrasa a
-- saida das filas.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================

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

  -- A consulta clinica (CLINICO) fica fora das contagens de fila: ela nao
  -- e feita numa sala de exame, e por isso nao pode segurar a etapa.
  select
    count(*) filter (
      where et.code is distinct from 'CLINICO'
        and pe.status in ('pendente','em_fila','chamado','em_andamento')
    ),
    count(*) filter (
      where et.code is distinct from 'CLINICO'
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
             -- Consulta marcada: segue para o consultorio.
             when tem_consulta then 'aguardando_medico'
             -- Sem consulta: acabaram os exames, o paciente pode ir embora.
             -- Vai para o pagamento, que e o passo seguinte da esteira.
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

comment on function public.tg_patient_exam_progress() is
  'Move o atendimento conforme os exames andam. So vai ao medico quem tem a consulta clinica marcada.';
