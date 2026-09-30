-- =====================================================================
-- 0046 - A sala atribuida a mao, a etapa do caixa e quem sai do terminal
--
-- Tres achados da varredura de 52 rotas e da auditoria da maquina de
-- estados. Os tres sao alcancaveis pela tela, hoje.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. "Enviar exame para a sala X" gravava e nao fazia nada
--
-- `atribuirSalaAoExame` escreve `patient_exams.room_id`. E
-- `call_next_for_room` NUNCA leu essa coluna: ela decide quem pode ser
-- chamado por `room_exam_types` ou por `exam_types.default_room_id`, e so.
--
-- Ou seja: o botao existia para resgatar um exame que ficou sem sala --
-- diz isso no proprio comentario dele -- e a sala escolhida continuava sem
-- conseguir chamar o paciente. O exame seguia pendente para sempre.
--
-- Por que nao basta aceitar `pe.room_id = p_room`:
--
--   Os exames nascem com `room_id` copiado da sala padrao do tipo. Se a
--   clinica trocar a sala padrao depois -- que e o que a tela de Salas e
--   exames faz --, os exames ja pedidos continuam carregando a sala
--   ANTIGA. Aceitar `pe.room_id` sem distinguir faria a sala antiga voltar
--   a chamar, que foi exatamente o defeito da dinamometria em 21/09.
--
-- Entao a atribuicao manual passa a ser explicita: uma coluna que diz
-- "alguem escolheu esta sala para ESTE exame". Copia de padrao nao marca.
-- ---------------------------------------------------------------------
alter table public.patient_exams
  add column if not exists sala_escolhida_a_mao boolean not null default false;

comment on column public.patient_exams.sala_escolhida_a_mao is
  'Verdadeiro quando alguem enviou este exame para uma sala especifica pela tela de Filas. Distingue a escolha manual da copia da sala padrao, que fica desatualizada quando a clinica remaneja o equipamento.';


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
       -- Escolha manual para ESTE exame ganha de tudo.
       (pe.sala_escolhida_a_mao and pe.room_id = p_room)
       or exists (select 1 from public.room_exam_types ret
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
       (pe.sala_escolhida_a_mao and pe.room_id = p_room)
       or exists (select 1 from public.room_exam_types ret
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
-- 2. O caixa nao existia no catalogo de etapas
--
-- `aguardando_pagamento` e gravada por sete pontos do sistema e NAO estava
-- entre as etapas cadastradas. Consequencias, todas reais:
--
--   - `move_attendance_stage` recusa a etapa com "Estagio invalido":
--     ninguem consegue devolver um paciente ao caixa pelo CRM;
--   - o CRM monta as colunas a partir do catalogo, entao quem esta no
--     caixa NAO TEM COLUNA e nao pode ser arrastado de la;
--   - o grafico "por etapa" do painel monta as fatias do catalogo: quem
--     esta no caixa sumia do grafico, e as fatias nao somavam o total.
-- ---------------------------------------------------------------------
insert into public.crm_stages (tenant_id, code, name, color, sort_order, is_terminal)
select t.id, 'aguardando_pagamento', 'Aguardando pagamento', '#F59E0B', 105, false
  from public.tenants t
 where not exists (
   select 1 from public.crm_stages s
    where s.tenant_id = t.id and s.code = 'aguardando_pagamento')
on conflict (tenant_id, code) do nothing;

-- A ordem: entre "aguardando documentos" (11) e "finalizado" (12). Como os
-- numeros ja estao ocupados, o caixa entra depois dos exames e antes dos
-- documentos, que e a ordem da esteira.
update public.crm_stages
   set sort_order = 105
 where code = 'aguardando_pagamento' and sort_order is distinct from 105;


-- ---------------------------------------------------------------------
-- 3. Sair de uma etapa terminal deixava a data de encerramento para tras
--
-- `move_attendance_stage` limpa `in_service` e `current_room_id` ao ENTRAR
-- numa etapa terminal, e nunca limpava `finished_at`, `cancelled_at` ou
-- `absent_at` ao SAIR dela.
--
-- Trazer um cartao de Finalizado de volta ao fluxo deixava `finished_at`
-- preenchido -- e recepcao, triagem, modulo medico e pagamentos TODOS
-- filtram por `finished_at is null`. O paciente voltava para uma etapa
-- ativa e ficava invisivel nas quatro telas.
--
-- Havia compensacao na aplicacao (`limparEstadoTerminal`), mas a RPC pode
-- ser chamada direto, e a garantia precisa estar onde a etapa muda.
-- ---------------------------------------------------------------------
-- Mesma assinatura e mesmo retorno da versao de 0033, de proposito: a
-- unica mudanca e limpar as datas de encerramento ao SAIR de uma etapa
-- terminal. Reescrever o resto perderia o `app.manual_move`, o registro do
-- motivo em `notes` e a checagem de etapa ativa.
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
         -- Entrando numa etapa terminal, marca a data. SAINDO de uma,
         -- limpa as tres -- e esta e a linha nova.
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
    if p_stage in ('cancelado','ausente') then
      update public.patient_exams
         set status = 'cancelado', updated_by = auth.uid()
       where attendance_id = p_attendance
         and status in ('pendente','em_fila','chamado','em_andamento');
    end if;
  end if;
end$$;

comment on function public.move_attendance_stage(uuid, text, text) is
  'Move o atendimento de etapa. Ao ENTRAR numa etapa terminal solta paciente, sala e exames; ao SAIR de uma, limpa as datas de encerramento -- senao o paciente volta ao fluxo invisivel para as telas, que filtram por atendimento em aberto.';

grant execute on function public.move_attendance_stage(uuid, text, text) to authenticated;


-- ---------------------------------------------------------------------
-- 4. Conserta o que ja esta gravado
-- ---------------------------------------------------------------------

-- Atendimento em etapa ativa com data de encerramento pendurada.
update public.attendances a
   set finished_at = null, cancelled_at = null, absent_at = null, exit_at = null
  from public.crm_stages s
 where s.tenant_id = a.tenant_id and s.code = a.stage_code
   and not coalesce(s.is_terminal, false)
   and a.stage_code <> 'aguardando_pagamento'
   and (a.finished_at is not null or a.cancelled_at is not null or a.absent_at is not null);


do $$
declare v_caixa int; v_soltos int;
begin
  select count(*) into v_caixa from public.crm_stages where code = 'aguardando_pagamento';
  select count(*) into v_soltos from public.patient_exams where sala_escolhida_a_mao;
  raise notice 'Etapa do caixa cadastrada em % clinica(s); exames com sala escolhida a mao: %', v_caixa, v_soltos;
end$$;
