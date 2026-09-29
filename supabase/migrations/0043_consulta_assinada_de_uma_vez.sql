-- =====================================================================
-- 0043 - Assinar a consulta de uma vez so fecha tudo
--
-- Encontrado pelo simulador da clinica, no primeiro paciente que ele
-- passou pelo sistema inteiro -- e no caminho mais comum que existe.
--
-- ---------------------------------------------------------------------
-- 1. O exame de consulta ficava pendente para sempre
-- ---------------------------------------------------------------------
-- Ha dois gatilhos sobre `medical_consultations`, os dois chamando a mesma
-- funcao: um AFTER INSERT e um AFTER UPDATE. A funcao decidia assim:
--
--     if tg_op = 'INSERT' then   -> marca "em consulta"
--     elsif finished_at mudou    -> encerra, conclui os itens do medico
--
-- Quando o medico abre a consulta, preenche e clica em finalizar SEM ter
-- salvo um rascunho antes, a linha nasce JA com `finished_at`. Cai no
-- primeiro ramo, que so marca "em consulta" -- e o segundo nunca roda.
--
-- Efeito: o item "Consulta clinica ocupacional" ficava `pendente` para
-- sempre num atendimento ja encerrado. O paciente aparecia com "exames
-- 1/2" depois de ter ido embora, e nenhuma sala podia chama-lo, porque
-- esse item nao ocupa sala.
--
-- A acao da tela ja compensava metade disso: ela grava a etapa
-- 'aguardando_pagamento' por conta propria, com um comentario explicando
-- que "o gatilho do banco so avanca a etapa no UPDATE". Compensou a etapa
-- e nao os exames -- e foi por isso que o defeito seguiu invisivel.
--
-- ---------------------------------------------------------------------
-- 2. Saber se ha parecer sem poder ler a consulta
-- ---------------------------------------------------------------------
-- O kit de saida pergunta se a consulta tem parecer de aptidao antes de
-- emitir o A.S.O. Quem encerra o atendimento costuma ser a recepcao, e a
-- recepcao NAO enxerga `medical_consultations` -- a leitura exige
-- `clinico.ver`, que o papel de atendimento nao tem, e com razao.
--
-- O embed voltava vazio, o sistema concluia "nao ha parecer" e o kit
-- avisava "a consulta ainda nao tem o parecer de aptidao preenchido" --
-- culpando o medico por uma consulta que ele tinha assinado.
--
-- A resposta nao pode ser dar prontuario para a recepcao. E uma funcao que
-- responde SIM ou NAO sem devolver nada do conteudo clinico.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. O gatilho passa a tratar "nasceu assinada"
-- ---------------------------------------------------------------------
create or replace function public.tg_consultation_progress()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_encerrou boolean;
begin
  -- Encerrar e: nascer ja assinada, ou passar de nao-assinada para
  -- assinada. Os dois casos precisam fechar as mesmas coisas.
  v_encerrou := (tg_op = 'INSERT' and new.finished_at is not null)
             or (tg_op = 'UPDATE' and new.finished_at is not null and old.finished_at is null);

  if tg_op = 'INSERT' and not v_encerrou then
    update public.attendances
       set stage_code = 'em_consulta',
           consultation_started_at = coalesce(consultation_started_at, now()),
           in_service = true,
           current_room_id = coalesce(new.room_id, current_room_id)
     where id = new.attendance_id;

  elsif v_encerrou then
    update public.attendances
       set stage_code = 'aguardando_documentos',
           consultation_finished_at = new.finished_at,
           in_service = false,
           current_room_id = null
     where id = new.attendance_id;

    perform public.liberar_salas_do_atendimento(new.attendance_id);

    -- Os itens que o proprio medico responde na consulta.
    update public.patient_exams pe
       set status = 'concluido',
           started_at = coalesce(pe.started_at, new.started_at, new.finished_at),
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

comment on function public.tg_consultation_progress() is
  'Move o atendimento e fecha os itens respondidos pelo medico. Trata tambem a consulta que nasce ja assinada, que e o caminho de quem preenche e finaliza sem salvar rascunho.';


-- ---------------------------------------------------------------------
-- 2. Ha parecer? Sim ou nao, sem devolver prontuario
-- ---------------------------------------------------------------------
create or replace function public.atendimento_tem_parecer(p_attendance uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.medical_consultations mc
      join public.attendances a on a.id = mc.attendance_id
     where mc.attendance_id = p_attendance
       and mc.verdict is not null
       and public.belongs_to_tenant(a.tenant_id)
  );
$$;

comment on function public.atendimento_tem_parecer(uuid) is
  'Verdadeiro quando a consulta daquele atendimento ja tem parecer de aptidao. Responde sim ou nao sem expor conteudo clinico, para que quem encerra o atendimento possa saber se o A.S.O. pode sair.';

grant execute on function public.atendimento_tem_parecer(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 3. Conserta o que ja esta gravado
--
-- Consulta assinada com o item do medico ainda pendente: e o defeito 1
-- acima, em todo atendimento que passou por aqui desde que existe.
-- ---------------------------------------------------------------------
update public.patient_exams pe
   set status = 'concluido',
       started_at = coalesce(pe.started_at, mc.started_at, mc.finished_at),
       finished_at = coalesce(pe.finished_at, mc.finished_at),
       professional_id = coalesce(pe.professional_id, mc.doctor_id)
  from public.exam_types et, public.medical_consultations mc
 where et.id = pe.exam_type_id
   and coalesce(et.respondido_pelo_medico, false)
   and mc.attendance_id = pe.attendance_id
   and mc.finished_at is not null
   and pe.status not in ('concluido','cancelado','nao_realizado');


do $$
declare v_pendentes int;
begin
  select count(*) into v_pendentes
    from public.patient_exams pe
    join public.exam_types et on et.id = pe.exam_type_id
    join public.medical_consultations mc on mc.attendance_id = pe.attendance_id
   where coalesce(et.respondido_pelo_medico, false)
     and mc.finished_at is not null
     and pe.status not in ('concluido','cancelado','nao_realizado');
  raise notice 'Itens do medico ainda pendentes apos o conserto: %', v_pendentes;
end$$;
