-- =====================================================================
-- 0035 - Destrava quem ficou preso na bancada da triagem
--
-- "todos os pacientes tao ficando presos na triagem mesmo depois de
--  clicar em concluir triagem"
-- "finalizei todos os exames salvei as fichas e o paciente nao foi pro
--  modulo medico e sumiu do fluxo"
--                                              -- Isabella, 21/09
--
-- A causa: salvar a ficha de um exame nunca mudava o status do exame.
-- Nas salas do quadro de Filas isso nao aparecia, porque la existe um
-- botao de concluir. Na bancada da triagem — acuidade, visao de cores,
-- Romberg, fadiga — nao existe botao nenhum: preencher a ficha E fazer o
-- exame. O exame ficava 'pendente' para sempre.
--
-- E desde 15/09, quando as salas de triagem sairam do quadro de Filas, nao
-- havia mais nenhuma sala que pudesse chamar esses exames. O paciente
-- ficava parado com "exames 0/15", sem sala que o chamasse e sem etapa que
-- avancasse. Dois pacientes estavam assim ha 67 horas.
--
-- A aplicacao foi corrigida. Este script conserta quem ja esta preso.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Exame de bancada que tem ficha preenchida esta feito
--
-- So mexe em exame que TEM resultado gravado. Exame sem ficha continua
-- pendente: quem faz e o examinador, nao este script.
-- ---------------------------------------------------------------------
update public.patient_exams pe
   set status = 'concluido',
       started_at = coalesce(pe.started_at, er.created_at),
       finished_at = coalesce(pe.finished_at, er.updated_at, er.created_at),
       professional_id = coalesce(pe.professional_id, er.professional_id),
       room_id = coalesce(pe.room_id, et.default_room_id)
  from public.exam_results er,
       public.exam_types et,
       public.rooms r
 where er.patient_exam_id = pe.id
   and et.id = pe.exam_type_id
   and r.id = et.default_room_id
   and r.kind = 'triagem'
   and pe.status in ('pendente','em_fila','chamado','em_andamento');


-- ---------------------------------------------------------------------
-- 2. Triagem concluida que nao levou o paciente a lugar nenhum
--
-- Mesma regra do gatilho: fila se ha exame de sala por fazer, medico se ha
-- consulta marcada, pagamento se nao ha nem um nem outro.
-- ---------------------------------------------------------------------
update public.attendances a
   set stage_code = case
         when exists (
           select 1 from public.patient_exams pe
             join public.exam_types et on et.id = pe.exam_type_id
            where pe.attendance_id = a.id
              and coalesce(et.ocupa_sala, true)
              and pe.status in ('pendente','em_fila','chamado','em_andamento')
         ) then 'aguardando_exames'
         when exists (
           select 1 from public.patient_exams pe
             join public.exam_types et on et.id = pe.exam_type_id
            where pe.attendance_id = a.id and et.code = 'CLINICO'
              and pe.status in ('pendente','em_fila','chamado','em_andamento')
         ) then 'aguardando_medico'
         else 'aguardando_pagamento'
       end,
       triage_finished_at = coalesce(a.triage_finished_at, t.finished_at),
       in_service = false,
       current_room_id = null
  from public.triages t
 where t.attendance_id = a.id
   and t.finished_at is not null
   and a.stage_code in ('aguardando_triagem','em_triagem')
   and a.finished_at is null and a.cancelled_at is null and a.absent_at is null;


-- ---------------------------------------------------------------------
-- 3. Sala de triagem presa a quem ja saiu
-- ---------------------------------------------------------------------
update public.rooms r
   set status = 'disponivel', current_attendance_id = null
  from public.attendances a
 where a.id = r.current_attendance_id
   and a.stage_code not in ('em_triagem','em_exames','em_consulta');


-- ---------------------------------------------------------------------
-- 4. Quem esta parado numa fila que nao tem como chama-lo
--
-- Sobra o caso de quem ficou em 'aguardando_exames' so com exame de
-- bancada por fazer, sem ficha preenchida. Esse tem de voltar para a
-- triagem: e la que o exame e feito, e e la que a tela o mostra.
-- ---------------------------------------------------------------------
update public.attendances a
   set stage_code = 'aguardando_triagem'
 where a.stage_code = 'aguardando_exames'
   and a.finished_at is null and a.cancelled_at is null and a.absent_at is null
   and exists (
     select 1 from public.patient_exams pe
       join public.exam_types et on et.id = pe.exam_type_id
       join public.rooms r on r.id = et.default_room_id
      where pe.attendance_id = a.id and r.kind = 'triagem'
        and pe.status in ('pendente','em_fila','chamado','em_andamento'))
   and not exists (
     select 1 from public.patient_exams pe
       join public.exam_types et on et.id = pe.exam_type_id
       left join public.rooms r on r.id = et.default_room_id
      where pe.attendance_id = a.id
        and coalesce(et.ocupa_sala, true)
        and coalesce(r.kind, '') <> 'triagem'
        and pe.status in ('pendente','em_fila','chamado','em_andamento'));


-- ---------------------------------------------------------------------
-- 5. Aviso: o que ainda precisa de alguem
-- ---------------------------------------------------------------------
do $$
declare
  v_presos int;
  v_bancada int;
begin
  select count(*) into v_presos
    from public.attendances
   where finished_at is null and cancelled_at is null and absent_at is null
     and checkin_at < now() - interval '12 hours';

  select count(*) into v_bancada
    from public.patient_exams pe
    join public.exam_types et on et.id = pe.exam_type_id
    join public.rooms r on r.id = et.default_room_id
   where r.kind = 'triagem'
     and pe.status in ('pendente','em_fila','chamado','em_andamento');

  raise notice 'Atendimentos abertos ha mais de 12 horas: %', v_presos;
  raise notice 'Exames de bancada ainda por preencher: %', v_bancada;
end$$;
