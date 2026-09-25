-- =====================================================================
-- 0039 - Pericia, SISPER e ingresso vao ao medico, sempre
--
-- "os pacientes que eu categorizo como sisper ao clicar em encaminhar
--  para o medico vao direto para a aba pagamentos sem passar pela chamada
--  do medico"
--                                              -- Isabella, 24/09
--
-- A regra "so vai ao medico quem tem Consulta clinica ocupacional marcada"
-- foi criada em 17/09 e esta certa -- para o PARTICULAR. Quem vem so fazer
-- um eletroencefalograma nao deve cair numa fila de consulta que ninguem
-- pediu.
--
-- Para pericia, SISPER e ingresso ela nao se aplica: a avaliacao medica e
-- o proprio motivo da visita, e como nao e cobrada como exame nao existe
-- "Consulta clinica ocupacional" para a recepcao marcar. Na tela o botao
-- ja dizia "Liberar para o medico"; era o destino que discordava do
-- rotulo.
--
-- Os dois gatilhos que decidem o destino passam a considerar tambem a
-- procedencia. Nada muda para o particular.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Quando os exames acabam
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

  -- Pericia, SISPER e ingresso vao ao medico com ou sem item marcado.
  if coalesce(att.origin_kind::text, 'particular') in ('estado','sisper','ingresso') then
    tem_consulta := true;
  end if;

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
-- 2. Quando a triagem termina
-- ---------------------------------------------------------------------
create or replace function public.tg_triage_finished()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_na_fila int;
  v_tem_consulta boolean;
  v_origem text;
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

    select coalesce(origin_kind::text, 'particular') into v_origem
      from public.attendances where id = new.attendance_id;

    if v_origem in ('estado','sisper','ingresso') then
      v_tem_consulta := true;
    end if;

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
-- 3. Conserta quem ja foi parar no caixa sem ver o medico
--
-- So quem ainda nao pagou e nao foi encerrado: atendimento fechado e
-- historico, e reabrir o passado confunde mais do que conserta.
-- ---------------------------------------------------------------------
update public.attendances a
   set stage_code = 'aguardando_medico'
 where a.stage_code = 'aguardando_pagamento'
   and coalesce(a.origin_kind::text, 'particular') in ('estado','sisper','ingresso')
   and a.finished_at is null and a.cancelled_at is null and a.absent_at is null
   and a.payment_status <> 'pago'
   and not exists (
     select 1 from public.medical_consultations mc
      where mc.attendance_id = a.id and mc.finished_at is not null);
