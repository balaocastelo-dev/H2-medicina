-- =====================================================================
-- 0034 - Preencher a bancada nao pode interromper a triagem
--
-- Encontrado logo depois da 0033, no mesmo pente fino.
--
-- Acuidade, visao de cores, Romberg e fadiga sao feitos na mesa da
-- triagem, com a ficha de triagem aberta. Sao exames como os outros, e o
-- gatilho que reage ao ciclo de vida dos exames nao sabia disso:
--
--   - ao marcar o primeiro como "em andamento", ele jogava o atendimento
--     em 'em_exames' -- e o paciente sumia da lista da tela de Triagem,
--     com a ficha ainda aberta na frente de quem estava preenchendo;
--
--   - ao concluir o ultimo, ele mandava o paciente direto para
--     'aguardando_pagamento'. A triagem ficava pela metade, sem finalizar,
--     e o paciente era mandado ao caixa com a ficha em branco.
--
-- Enquanto a triagem esta acontecendo, quem decide o destino e o fim da
-- triagem -- nao a bancada. O gatilho dos exames passa a nao mexer em
-- quem esta em triagem.
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

  -- Paciente em triagem nao e movido pela bancada. `tg_triage_finished`
  -- decide para onde ele vai quando a ficha for finalizada, e ja olha os
  -- exames que sobraram para escolher entre fila, medico e pagamento.
  if att.stage_code in ('aguardando_triagem', 'em_triagem') then
    return new;
  end if;

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

comment on function public.tg_patient_exam_progress() is
  'Move o atendimento conforme os exames de sala. Nao mexe em quem esta em triagem: ali quem decide o destino e o fim da ficha.';

drop trigger if exists patient_exam_progress on public.patient_exams;
create trigger patient_exam_progress after update on public.patient_exams
for each row execute function public.tg_patient_exam_progress();

-- ---------------------------------------------------------------------
-- Conserta o que ja esta gravado: triagem aberta com o paciente empurrado
-- para outra etapa pela bancada.
-- ---------------------------------------------------------------------
update public.attendances a
   set stage_code = 'em_triagem'
  from public.triages t
 where t.attendance_id = a.id
   and t.finished_at is null
   and a.finished_at is null and a.cancelled_at is null and a.absent_at is null
   and a.stage_code in ('em_exames','aguardando_exames','aguardando_pagamento');
