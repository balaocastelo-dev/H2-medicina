-- =====================================================================
-- 0042 - O teste de Romberg passa a ser feito na consulta
--
-- "o teste de romberg tem que mudar para ser realizado na aba medica"
--                                              -- Isabella, 28/09
--
-- O Romberg era preenchido na bancada da triagem. Vai para o medico, como
-- ja acontece com a consulta clinica e com o psicossocial.
--
-- ---------------------------------------------------------------------
-- Por que isto NAO e so trocar uma lista
-- ---------------------------------------------------------------------
-- Quais exames sao respondidos pelo medico estava escrito como
-- `et.code in ('CLINICO','PSICO')`, repetido em quatro funcoes. Essa lista
-- ja mudou duas vezes em uma semana: ganhou PSICO em 22/09 e ganharia
-- ROMBERG agora. Cada mudanca exige achar as quatro copias e acertar todas
-- -- e errar uma delas nao da erro, so deixa o paciente numa fila onde
-- ninguem vai chama-lo. Foi assim em 15/09.
--
-- Entao a lista vira uma coluna: `exam_types.respondido_pelo_medico`. As
-- funcoes passam a perguntar ao cadastro, e mudar quem responde o que deixa
-- de ser assunto de migracao.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. A coluna, com o que a lista dizia
-- ---------------------------------------------------------------------
alter table public.exam_types
  add column if not exists respondido_pelo_medico boolean not null default false;

comment on column public.exam_types.respondido_pelo_medico is
  'O medico responde este item na propria consulta. Nao ocupa sala, nao entra em fila, e marca-lo faz o paciente passar pelo consultorio.';

-- O estado de hoje, para nada mudar de comportamento nesta linha.
update public.exam_types
   set respondido_pelo_medico = true
 where code in ('CLINICO','PSICO')
   and respondido_pelo_medico is distinct from true;


-- ---------------------------------------------------------------------
-- 2. O Romberg entra
--
-- Sai das salas pelo mesmo caminho do psicossocial em 0036: sem sala
-- padrao e sem vinculo, senao a sala de triagem continuaria oferecendo
-- chamar um exame que o medico ja respondeu.
-- ---------------------------------------------------------------------
update public.exam_types
   set respondido_pelo_medico = true,
       ocupa_sala = false
 where code = 'ROMBERG';

delete from public.room_exam_types ret
 using public.exam_types et
 where et.id = ret.exam_type_id and et.code = 'ROMBERG';

update public.exam_types
   set default_room_id = null
 where code = 'ROMBERG';


-- ---------------------------------------------------------------------
-- 3. As quatro funcoes passam a ler a coluna
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
      coalesce(et.respondido_pelo_medico, false)
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
        coalesce(et.respondido_pelo_medico, false)
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


-- Assinar a consulta fecha o que o medico respondia nela.
--
-- Vale tambem para o Romberg, e de proposito. Se o medico preencheu a
-- ficha, o exame ja esta concluido e esta linha nao faz nada. Se ele nao
-- preencheu, o item nao pode ficar pendente para sempre em um atendimento
-- ja assinado -- seria o mesmo buraco de 21/09, com o paciente marcado
-- "exames 3/4" e nenhuma sala capaz de chama-lo.
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
       and coalesce(et.respondido_pelo_medico, false)
       and pe.attendance_id = new.attendance_id
       and pe.status not in ('concluido','cancelado','nao_realizado');
  end if;
  return new;
end$$;


-- ---------------------------------------------------------------------
-- 4. Quem ja esta no meio do caminho
-- ---------------------------------------------------------------------

-- Romberg pendente em consulta ja assinada: o medico nao tinha onde
-- responder ate agora.
update public.patient_exams pe
   set status = 'concluido',
       started_at = coalesce(pe.started_at, mc.started_at),
       finished_at = coalesce(pe.finished_at, mc.finished_at),
       professional_id = coalesce(pe.professional_id, mc.doctor_id)
  from public.exam_types et, public.medical_consultations mc
 where et.id = pe.exam_type_id
   and et.code = 'ROMBERG'
   and mc.attendance_id = pe.attendance_id
   and mc.finished_at is not null
   and pe.status not in ('concluido','cancelado','nao_realizado');

-- Quem estava numa fila so por causa do Romberg vai ao medico. Sem isto,
-- o exame deixou de ocupar sala e o paciente ficaria esperando uma chamada
-- que nao viria de lugar nenhum.
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
        and coalesce(et.respondido_pelo_medico, false)
        and pe.status in ('pendente','em_fila','chamado','em_andamento'));

-- Quem esta esperando triagem AGORA nao e mexido aqui, de proposito.
--
-- A recepcao grava um unico `needs_triage`, sem dizer se ele veio de ela ter
-- pedido a triagem ou de um exame de bancada ter exigido. Quem esta em
-- 'aguardando_triagem' pode estar la para aferir pressao. Move-lo para o
-- medico faria o paciente pular os sinais vitais -- consertar o Romberg
-- estragando a triagem.
--
-- E nao e preciso: esse paciente passa pela triagem normalmente, o
-- `tg_triage_finished` acima ja le a coluna nova, ve o Romberg pendente e o
-- manda ao consultorio. So a bancada e que deixa de oferecer o exame.


do $$
declare v_romberg int;
begin
  select count(*) into v_romberg from public.exam_types
   where code = 'ROMBERG' and respondido_pelo_medico;
  raise notice 'Romberg respondido pelo medico: %', v_romberg;
end$$;
