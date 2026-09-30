-- =====================================================================
-- 0051 - Reabrir um atendimento cancelado devolve os exames dele
--
-- ---------------------------------------------------------------------
-- O defeito
-- ---------------------------------------------------------------------
-- A 0046 fez as duas metades do terminal quase inteiras:
--
--   ENTRANDO em cancelado/ausente -> cancela os `patient_exams` abertos
--                                    (certo: exame de quem foi embora nao
--                                    e pendencia da clinica)
--   SAINDO de uma etapa terminal  -> limpa `finished_at`, `cancelled_at`,
--                                    `absent_at`, `exit_at`, solta sala e
--                                    `in_service`
--
-- Faltou justamente o par do cancelamento dos exames. Cancelar um paciente
-- por engano e arrasta-lo de volta para "aguardando exames" no CRM devolvia
-- um atendimento com ZERO exames: o cartao mostra 0/0, ele nao aparece em
-- sala nenhuma, e a lista do que ele veio fazer foi perdida.
--
-- E nada mais o move: o unico gatilho que avanca de `aguardando_exames`
-- reage a mudanca de status de `patient_exams`, e nao ha exame nenhum para
-- mudar de status. O paciente fica parado ali, invisivel em filas, triagem,
-- medico e pagamentos — visivel so no CRM, e so hoje.
--
-- ---------------------------------------------------------------------
-- Por que da para reverter com seguranca
-- ---------------------------------------------------------------------
-- O cancelamento em massa da 0046 e cirurgico: marca `cancelado` apenas nos
-- exames que estavam abertos (`pendente`, `em_fila`, `chamado`,
-- `em_andamento`). Exame ja concluido, ja recusado ou cancelado a mao antes
-- disso nao e tocado.
--
-- Mas ao reabrir nao se sabe quais dos cancelados foram cancelados pelo
-- terminal e quais foram cancelados a mao pela clinica. Por isso a 0046
-- passa a MARCAR: grava em `notes` de quem ela cancelou. Os exames voltam
-- como `pendente`, que e onde o `checkin_patient` os coloca — a fila os
-- reparte de novo pela sala de sempre.
--
-- Cancelamento a mao, sem a marca, continua cancelado. E o que a clinica
-- decidiu, e reabrir o atendimento nao desfaz decisao de ninguem.
--
-- Pode ser executada mais de uma vez sem efeito colateral.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A marca. Coluna propria em vez de texto dentro de `notes`: `notes` e
-- campo que a clinica le e escreve, e condicionar comportamento a uma
-- frase dentro dele quebraria no dia em que alguem apagasse a frase.
-- ---------------------------------------------------------------------
alter table public.patient_exams
  add column if not exists cancelado_pelo_encerramento boolean not null default false;

comment on column public.patient_exams.cancelado_pelo_encerramento is
  'Verdadeiro quando o exame foi cancelado porque o ATENDIMENTO foi cancelado ou o paciente faltou -- nao por decisao sobre o exame. Reabrir o atendimento devolve so estes a fila.';


-- Mesma assinatura, mesmos errcodes e mesma regra de terminal da 0046, de
-- proposito: a aplicacao trata P0002, 42501 e 22023 pelo codigo, e
-- `v_terminal` e a lista fixa das tres etapas — nao a coluna `is_terminal`,
-- que a clinica pode marcar em outra etapa. A unica mudanca e o `elsif` no
-- fim, que devolve os exames na reabertura.
create or replace function public.move_attendance_stage(
  p_attendance uuid, p_stage text, p_reason text default null)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_terminal boolean;
  v_etapa_atual text;
  v_era_terminal boolean;
begin
  select tenant_id, stage_code into v_tenant, v_etapa_atual
    from public.attendances where id = p_attendance;
  if v_tenant is null then raise exception 'Atendimento nao encontrado' using errcode='P0002'; end if;
  if not public.can_access(v_tenant, 'crm.mover_manual') then
    raise exception 'Sem permissao para mover manualmente' using errcode = '42501';
  end if;
  if not exists (select 1 from public.crm_stages where tenant_id = v_tenant and code = p_stage and is_active) then
    raise exception 'Estagio invalido' using errcode = '22023';
  end if;

  v_terminal := p_stage in ('finalizado','cancelado','ausente');
  -- De onde ele esta saindo: mesma lista, para saber se e REABERTURA.
  v_era_terminal := v_etapa_atual in ('finalizado','cancelado','ausente');

  perform set_config('app.manual_move', 'on', true);

  update public.attendances
     set stage_code = p_stage,
         updated_by = auth.uid(),
         -- Entrando numa etapa terminal, marca a data. SAINDO de uma,
         -- limpa as tres.
         --
         -- Trazer um cartao de Finalizado de volta ao fluxo deixava
         -- `finished_at` preenchido, e recepcao, triagem, modulo medico e
         -- pagamentos TODOS filtram por `finished_at is null`: o paciente
         -- voltava para uma etapa ativa e ficava invisivel nas quatro.
         finished_at = case when p_stage = 'finalizado' then coalesce(finished_at, now())
                            when v_terminal then finished_at else null end,
         cancelled_at = case when p_stage = 'cancelado' then coalesce(cancelled_at, now())
                             when v_terminal then cancelled_at else null end,
         absent_at = case when p_stage = 'ausente' then coalesce(absent_at, now())
                          when v_terminal then absent_at else null end,
         exit_at = case when p_stage = 'finalizado' then coalesce(exit_at, now())
                        when v_terminal then exit_at else null end,
         in_service = case when v_terminal then false else in_service end,
         current_room_id = case when v_terminal then null else current_room_id end,
         notes = coalesce(notes, '') || case when p_reason is null then '' else E'\n[CRM] ' || p_reason end
   where id = p_attendance;
  perform set_config('app.manual_move', 'off', true);

  if v_terminal then
    perform public.liberar_salas_do_atendimento(p_attendance);

    -- Exame de quem foi embora nao e exame pendente. Sem isto ele fica na
    -- contagem de pendencias da clinica para sempre.
    --
    -- A marca `cancelado_pelo_encerramento` e o que permite desfazer isto
    -- na reabertura sem tocar em exame que a clinica cancelou a mao.
    if p_stage in ('cancelado','ausente') then
      update public.patient_exams
         set status = 'cancelado',
             cancelado_pelo_encerramento = true,
             updated_by = auth.uid()
       where attendance_id = p_attendance
         and status in ('pendente','em_fila','chamado','em_andamento');
    end if;

  elsif v_era_terminal then
    -- REABERTURA. Os exames que cairam junto com o atendimento voltam a
    -- fila; a marca sai, porque a partir de agora eles sao exames normais.
    --
    -- Voltam como `pendente` (nao `em_fila`): e onde o check-in os coloca, e
    -- e o estado que a reparticao de salas espera. `queued_at` e limpo para
    -- a espera nao contar o tempo em que o atendimento estava cancelado.
    update public.patient_exams
       set status = 'pendente',
           cancelado_pelo_encerramento = false,
           queued_at = null,
           called_at = null,
           started_at = null,
           room_id = case when sala_escolhida_a_mao then room_id else null end,
           updated_by = auth.uid()
     where attendance_id = p_attendance
       and status = 'cancelado'
       and cancelado_pelo_encerramento;
  end if;
end$$;

comment on function public.move_attendance_stage(uuid, text, text) is
  'Move o atendimento de etapa. Ao ENTRAR numa etapa terminal solta paciente, sala e exames; ao SAIR de uma, limpa as datas de encerramento e DEVOLVE a fila os exames que cairam com o atendimento -- senao o paciente volta ao fluxo invisivel, sem exame e sem nada que o mova.';

grant execute on function public.move_attendance_stage(uuid, text, text) to authenticated;


-- ---------------------------------------------------------------------
-- Conserta o que ja esta gravado: atendimento em etapa ATIVA cujos exames
-- estao todos cancelados e que, por isso, esta parado em lugar nenhum.
--
-- Estes sao exatamente os reabertos antes desta migration. Nao ha marca
-- para consultar neles, entao o criterio e o estado: atendimento aberto,
-- em etapa de exame, sem um unico exame ativo.
-- ---------------------------------------------------------------------
update public.patient_exams pe
   set status = 'pendente',
       queued_at = null,
       called_at = null,
       started_at = null,
       -- Mesma regra do `elsif` da funcao: sala escolhida a mao fica; sala
       -- herdada da chamada anterior sai, para a fila repartir de novo.
       room_id = case when pe.sala_escolhida_a_mao then pe.room_id else null end
  from public.attendances a
 where pe.attendance_id = a.id
   and a.stage_code in ('aguardando_exames','em_exames')
   and a.finished_at is null
   and a.cancelled_at is null
   and a.absent_at is null
   and a.deleted_at is null
   and pe.status = 'cancelado'
   -- `nao_realizado` entra na lista.
   --
   -- E o status de "o paciente nao fez": recusou, foi embora, foi tirado da
   -- fila. Sem ele aqui, um atendimento com UM exame nao realizado e os
   -- outros cancelados a mao satisfazia o `not exists`, e todos os
   -- cancelados voltavam para a fila — exames que a clinica decidiu nao
   -- fazer reaparecendo nas salas.
   --
   -- Qualquer sinal de que alguem mexeu nos exames deste atendimento manda
   -- deixar como esta. Os sete valores do enum sao: pendente, em_fila,
   -- chamado, em_andamento, concluido, nao_realizado, cancelado — e so o
   -- ultimo fica de fora desta lista, que e justamente o que se conserta.
   and not exists (
     select 1 from public.patient_exams outro
      where outro.attendance_id = a.id
        and outro.status in (
          'pendente','em_fila','chamado','em_andamento','concluido',
          'nao_realizado'));


do $$
declare v_devolvidos int;
begin
  select count(*) into v_devolvidos
    from public.patient_exams pe
    join public.attendances a on a.id = pe.attendance_id
   where a.stage_code in ('aguardando_exames','em_exames')
     and pe.status = 'pendente';
  raise notice 'Exames em fila apos a devolucao: %', v_devolvidos;
end$$;
