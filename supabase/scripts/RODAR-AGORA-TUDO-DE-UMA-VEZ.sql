-- =====================================================================
-- RODAR AGORA -- H2 Medicina Ocupacional
--
-- Migrations 0041 a 0052, na ordem, num arquivo so.
--
-- COMO USAR
--   1. Supabase > SQL Editor > New query
--   2. Cole este arquivo inteiro
--   3. RUN
--
-- Pode rodar mais de uma vez: tudo aqui e idempotente. Se ficar em
-- duvida se funcionou, rode de novo -- nao duplica nada.
--
-- O QUE ENTRA
--   0041  medico consegue chamar paciente; permissoes de papel
--   0042  Romberg vira exame do medico
--   0043  consulta assinada de uma vez
--   0044  quem chama o paciente consegue liberar a sala
--   0045  trilha de acesso clinico e consentimento gravados
--   0046  sala do exame escolhida a mao; etapa do caixa no CRM
--   0047  consulta ocupacional com valor; repasses perdidos recuperados
--   0048  portal do paciente sem forca bruta; documento clinico fora dele
--   0049  senha do dia sem colisao entre dois totens
--   0050  uma cobranca da recepcao em aberto por atendimento
--   0051  reabrir atendimento devolve os exames dele
--   0052  medico volta a guardar e usar a propria assinatura
-- =====================================================================



-- #####################################################################
-- 0041_medico_consegue_chamar_paciente.sql
-- #####################################################################

-- =====================================================================
-- 0041 - Cada papel consegue fazer o trabalho dele
--
-- "login do dr antonio nao esta chamando pacientes no modulo medico" /
-- "todos os logins de outros medicos aparece isso quando tenta chamar"
--                                              -- Isabella, 28/09
--
-- A tela dizia "Outro consultorio chamou este paciente agora" com ZERO
-- pacientes em consulta. Nao havia outro consultorio. A gravacao era
-- barrada pelo RLS, afetava zero linhas, e o codigo interpretava zero
-- linhas como "alguem chegou primeiro".
--
-- Esse e o jeito mais traicoeiro de uma permissao faltar: UPDATE barrado
-- por RLS nao levanta erro, so nao encontra a linha. Nao aparece em log
-- nem em teste que roda como administrador -- e os testes rodavam como
-- administrador.
--
-- A politica de escrita de `attendances` exigia `recepcao.operar`, que o
-- papel de medico nao tem. O mesmo vale para `rooms`, que exigia
-- `salas.administrar`, e para `fee_entries`, que exigia
-- `financeiro.registrar` -- ou seja, o medico tambem nunca conseguiu
-- gravar o proprio repasse ao finalizar uma consulta.
--
-- Por que so apareceu agora: ate a 0039, quase todo paciente chegava ao
-- consultorio pela funcao `call_next_for_room`, que roda com privilegio
-- proprio e passa por cima do RLS. A 0039 fez pericia, SISPER e ingresso
-- caírem direto em `aguardando_medico`, e esse caminho usa a gravacao
-- direta. A permissao ja faltava; a 0039 tornou o caminho o principal.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Uma permissao entre varias
--
-- Uma tabela operacional e escrita por mais de um papel: o atendimento
-- move o paciente na recepcao, a triagem move na triagem, o medico move
-- no consultorio. Uma permissao unica por tabela nao descreve isso.
-- ---------------------------------------------------------------------
create or replace function public.can_access_any(p_tenant uuid, p_perms text[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from unnest(p_perms) as perm
     where public.can_access(p_tenant, perm)
  );
$$;

comment on function public.can_access_any(uuid, text[]) is
  'Verdadeiro quando o usuario tem QUALQUER uma das permissoes no tenant. Tabela operacional costuma ser escrita por mais de um papel.';

grant execute on function public.can_access_any(uuid, text[]) to authenticated;


-- ---------------------------------------------------------------------
-- 2. Atendimento: quem opera o fluxo pode mover o paciente
--
-- Mover o paciente de etapa E a operacao. A recepcao libera para a fila,
-- a triagem encaminha, o medico chama e finaliza, o totem faz o
-- check-in. Todos escrevem nesta tabela.
-- ---------------------------------------------------------------------
drop policy if exists tenant_write on public.attendances;
create policy tenant_write on public.attendances for all to authenticated
  using (
    public.can_access_any(tenant_id, array[
      'recepcao.operar','totem.operar','filas.operar','triagem.preencher','medico.atender'
    ])
  )
  with check (
    public.can_access_any(tenant_id, array[
      'recepcao.operar','totem.operar','filas.operar','triagem.preencher','medico.atender'
    ])
  );


-- ---------------------------------------------------------------------
-- 3. Salas: ocupar e liberar e operacao, nao administracao
--
-- A tabela `rooms` guarda duas coisas diferentes: o CADASTRO da sala
-- (nome, tipo, ordem) e o ESTADO dela (ocupada, por quem). O estado muda
-- a cada chamada de paciente, o dia inteiro, por quem opera as filas.
--
-- O cadastro continua protegido onde as demais regras finas moram: a tela
-- de Salas e exames exige `salas.administrar` antes de gravar. O RLS aqui
-- garante o isolamento entre clinicas e a capacidade geral; nao e ele que
-- separa renomear de ocupar.
-- ---------------------------------------------------------------------
drop policy if exists tenant_write on public.rooms;
create policy tenant_write on public.rooms for all to authenticated
  using (
    public.can_access_any(tenant_id, array[
      'salas.administrar','filas.operar','triagem.preencher','medico.atender'
    ])
  )
  with check (
    public.can_access_any(tenant_id, array[
      'salas.administrar','filas.operar','triagem.preencher','medico.atender'
    ])
  );


-- ---------------------------------------------------------------------
-- 4. Repasse: o medico lanca o proprio, e so o proprio
--
-- Ao finalizar a consulta o sistema lanca o recebivel do medico. Isso
-- roda com o login dele, e a politica exigia `financeiro.registrar`:
-- nenhuma consulta finalizada por medico de verdade gerou lancamento.
--
-- A permissao nova nao abre o financeiro da clinica: ela deixa o medico
-- lancar uma linha cujo `profile_id` e ele mesmo. Quem cuida do
-- financeiro continua podendo tudo.
-- ---------------------------------------------------------------------
drop policy if exists tenant_write on public.fee_entries;
create policy tenant_write on public.fee_entries for all to authenticated
  using (
    public.can_access(tenant_id, 'financeiro.registrar')
    or (public.can_access(tenant_id, 'medico.atender') and profile_id = auth.uid())
  )
  with check (
    public.can_access(tenant_id, 'financeiro.registrar')
    or (public.can_access(tenant_id, 'medico.atender') and profile_id = auth.uid())
  );


-- ---------------------------------------------------------------------
-- 5. Tabela de procedimentos: o medico precisa ler para lancar
--
-- O valor do repasse sai daqui. Sem leitura, o lancamento falhava antes
-- mesmo de tentar gravar, com "Procedimento de repasse nao cadastrado" --
-- uma mensagem que nao chegava a lugar nenhum.
--
-- Continua sendo leitura: mexer na tabela de precos segue com o
-- financeiro.
-- ---------------------------------------------------------------------
drop policy if exists tenant_select on public.procedure_types;
create policy tenant_select on public.procedure_types for select to authenticated
  using (public.can_access_any(tenant_id, array['financeiro.ver','medico.atender']));

drop policy if exists tenant_select on public.medical_fees;
create policy tenant_select on public.medical_fees for select to authenticated
  using (
    public.can_access(tenant_id, 'financeiro.ver')
    or (public.can_access(tenant_id, 'medico.atender') and profile_id = auth.uid())
  );


-- ---------------------------------------------------------------------
-- 6. Lancamentos que se perderam
--
-- Consulta finalizada por medico de verdade nao gerou repasse. Recriar
-- esses lancamentos e conta a pagar: cada consulta assinada, com o valor
-- do medico ou o padrao do procedimento.
--
-- So consultas assinadas, so sem lancamento previo, e so quando ha
-- procedimento cadastrado. O indice unico da tabela impede duplicata se
-- este script rodar de novo.
-- ---------------------------------------------------------------------
insert into public.fee_entries
  (tenant_id, profile_id, attendance_id, patient_id, company_id, procedure_type_id,
   procedure_code, procedure_name, fee, competencia, status, notes)
select mc.tenant_id,
       mc.doctor_id,
       mc.attendance_id,
       mc.patient_id,
       a.company_id,
       pt.id,
       pt.code,
       pt.name,
       coalesce(mf.fee, pt.default_fee),
       date_trunc('month', mc.finished_at)::date,
       'a_pagar',
       'Lancamento recuperado: a consulta foi finalizada antes da correcao de permissao de 29/09.'
  from public.medical_consultations mc
  join public.attendances a on a.id = mc.attendance_id
  join public.procedure_types pt
    on pt.tenant_id = mc.tenant_id
   and pt.code = coalesce(a.procedure_code, 'consulta_ocupacional')
  left join public.medical_fees mf
    on mf.procedure_type_id = pt.id and mf.profile_id = mc.doctor_id
 where mc.finished_at is not null
   and mc.doctor_id is not null
   and coalesce(mf.fee, pt.default_fee) > 0
   and not exists (
     select 1 from public.fee_entries fe
      where fe.attendance_id = mc.attendance_id and fe.profile_id = mc.doctor_id);


do $$
declare v_recuperados int;
begin
  select count(*) into v_recuperados from public.fee_entries
   where notes like 'Lancamento recuperado%';
  raise notice 'Repasses recuperados: %', v_recuperados;
end$$;


-- #####################################################################
-- 0042_romberg_e_do_medico.sql
-- #####################################################################

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


-- #####################################################################
-- 0043_consulta_assinada_de_uma_vez.sql
-- #####################################################################

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


-- #####################################################################
-- 0044_quem_chama_consegue_liberar.sql
-- #####################################################################

-- =====================================================================
-- 0044 - Quem pode chamar precisa poder liberar
--
-- Encontrado pela matriz de papeis do simulador, rodando cada tela com o
-- papel de quem a usa de verdade.
--
-- ---------------------------------------------------------------------
-- O que estava acontecendo
-- ---------------------------------------------------------------------
-- O papel `atendimento` tem `filas.operar`: ele opera o quadro de Filas e
-- salas, e o botao "Chamar proximo" funciona. Mas NAO tem
-- `exames.concluir` -- entao o botao de concluir o exame e recusado.
--
-- O resultado e uma armadilha: o paciente entra na sala, a sala fica
-- marcada como ocupada, e quem o chamou nao consegue solta-lo. A sala
-- segue "ocupada" com alguem que ja saiu, e o proximo paciente da fila
-- nunca e chamado.
--
-- "nao esta chamando paciente" + "Erro inesperado. Tente novamente."
--                                          -- Isabella, 29/09 11:50,
-- com um paciente esperando ha 28 horas no quadro.
--
-- Um papel que pode prender e nao pode soltar nao e uma restricao de
-- seguranca: e um jeito de perder o dia. Mover a fila e operacao, e quem
-- opera a fila precisa das duas metades.
--
-- ---------------------------------------------------------------------
-- O que NAO muda
-- ---------------------------------------------------------------------
-- `exames.preencher` continua fora: preencher a ficha do exame e ato
-- clinico, e o resultado vai para o prontuario e para o laudo. A recepcao
-- passa a poder encerrar um exame e devolver a sala; quem registra o que
-- foi medido continua sendo quem faz o exame.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================

insert into public.role_permissions (role_id, permission_code)
select r.id, 'exames.concluir'
  from public.roles r
 where r.code = 'atendimento'
   and exists (select 1 from public.role_permissions rp
                where rp.role_id = r.id and rp.permission_code = 'filas.operar')
on conflict do nothing;


-- ---------------------------------------------------------------------
-- Salas presas a quem ja foi embora
--
-- Enquanto a permissao faltava, cada exame chamado e nao concluido deixou
-- a sala ocupada. Soltar so as que apontam para atendimento encerrado,
-- cancelado ou ausente: sala com paciente de verdade dentro nao se mexe.
-- ---------------------------------------------------------------------
update public.rooms r
   set status = 'disponivel', current_attendance_id = null
  from public.attendances a
 where a.id = r.current_attendance_id
   and (a.finished_at is not null or a.cancelled_at is not null or a.absent_at is not null
        or a.stage_code in ('finalizado','cancelado','ausente'));

-- Sala apontando para um atendimento que nao existe mais.
update public.rooms r
   set status = 'disponivel', current_attendance_id = null
 where r.current_attendance_id is not null
   and not exists (select 1 from public.attendances a where a.id = r.current_attendance_id);


do $$
declare v_presas int;
begin
  select count(*) into v_presas from public.rooms where current_attendance_id is not null;
  raise notice 'Salas ainda ocupadas (com paciente de verdade dentro): %', v_presas;
end$$;


-- #####################################################################
-- 0045_registros_que_nunca_eram_gravados.sql
-- #####################################################################

-- =====================================================================
-- 0045 - Registros que nunca chegavam a ser gravados
--
-- Encontrados por uma auditoria independente das politicas de RLS cruzadas
-- com os papeis do seed. Os tres achados tem a mesma forma: a acao exige
-- uma permissao, passa, e depois grava numa tabela que exige OUTRA -- e o
-- resultado da gravacao nunca e conferido.
--
-- INSERT barrado pelo RLS levanta erro. Mas quando o erro nao e lido, ele
-- some dentro de um `catch` que so escreve no console do servidor. Para
-- quem usa o sistema, a acao deu certo.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. A trilha de acesso a prontuario (LGPD) estava vazia desde sempre
--
-- `clinical_access_logs` exige `logs.ver` para LER e para ESCREVER. Ler e
-- certo: essa trilha e material de auditoria. Escrever, nao -- quem escreve
-- e justamente quem abriu o prontuario, e nenhum papel clinico tem
-- `logs.ver`. Entao toda gravacao era barrada.
--
-- O efeito e o pior possivel para o que a tabela existe: ela nao registrou
-- nenhum acesso, e e ela que responde "quem abriu o prontuario deste
-- paciente" quando o titular pergunta.
--
-- A resposta nao e dar `logs.ver` a todo mundo -- isso deixaria qualquer um
-- LER a trilha. E uma funcao que so sabe ESCREVER, e que grava sempre em
-- nome de quem esta logado.
-- ---------------------------------------------------------------------
create or replace function public.registrar_acesso_clinico(
  p_tenant uuid,
  p_patient uuid,
  p_context text,
  p_reference uuid default null,
  p_ip text default null,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Sem sessao nao ha acesso a registrar.
  if auth.uid() is null then return; end if;

  -- So registra acesso dentro da propria clinica: a funcao passa por cima
  -- do RLS, entao a checagem de tenant precisa estar escrita aqui.
  if not public.belongs_to_tenant(p_tenant) then return; end if;

  -- `ip_address` e do tipo `inet`, e o endereco chega como texto vindo do
  -- cabecalho `x-forwarded-for`. O cast e explicito porque o Postgres nao
  -- converte texto para inet sozinho neste contexto -- e um endereco mal
  -- formado nao pode derrubar o registro do acesso, que e o que importa
  -- aqui: por isso a conversao acontece dentro de um bloco que, falhando,
  -- grava o acesso sem o IP.
  begin
    insert into public.clinical_access_logs
      (tenant_id, user_id, patient_id, context, reference_id, ip_address, user_agent)
    values (p_tenant, auth.uid(), p_patient, p_context, p_reference,
            nullif(trim(coalesce(p_ip, '')), '')::inet, p_user_agent);
  exception when others then
    insert into public.clinical_access_logs
      (tenant_id, user_id, patient_id, context, reference_id, ip_address, user_agent)
    values (p_tenant, auth.uid(), p_patient, p_context, p_reference, null, p_user_agent);
  end;
end$$;

comment on function public.registrar_acesso_clinico(uuid, uuid, text, uuid, text, text) is
  'Grava um acesso a dado clinico em nome de quem esta logado. Escreve sem poder ler: a trilha continua visivel so para quem tem logs.ver.';

grant execute on function public.registrar_acesso_clinico(uuid, uuid, text, uuid, text, text) to authenticated;


-- ---------------------------------------------------------------------
-- 2. O consentimento LGPD se perdia quando quem emitia o termo era o medico
--
-- `patient_consents` exige `pacientes.editar` para gravar. Quem emite o
-- termo de autorizacao tem `documentos.emitir` -- o medico tem uma e nao a
-- outra. Pela recepcao funcionava, o que escondia o defeito: o termo saia,
-- a assinatura era gravada, e o registro de consentimento -- o que se
-- procura quando o titular pergunta o que autorizou -- nao existia.
--
-- Emitir o termo E o ato que cria o consentimento. Quem pode emitir precisa
-- poder registrar.
-- ---------------------------------------------------------------------
drop policy if exists tenant_write on public.patient_consents;
create policy tenant_write on public.patient_consents for all to authenticated
  using (
    public.can_access_any(tenant_id, array['pacientes.editar','documentos.emitir'])
  )
  with check (
    public.can_access_any(tenant_id, array['pacientes.editar','documentos.emitir'])
  );


-- ---------------------------------------------------------------------
-- 3. Anexos de exame: nenhum papel conseguia anexar E ver
--
-- `patient_attachments` exige `clinico.ver` para ler e `exames.preencher`
-- para gravar. A acao exigia `pacientes.editar`, que e de outro eixo:
--
--   - `atendimento` tem `pacientes.editar`, passa na acao, e entao NAO
--     consegue gravar nem enxergar o que anexou. O upload subia para o
--     balde e o registro nao entrava: arquivo orfao;
--   - `medico_examinador` tem `clinico.ver` e `exames.preencher`, ou seja,
--     tudo que o RLS pede -- e era barrado na porta, pela acao.
--
-- Anexar resultado de exame e ato clinico. A acao passa a exigir
-- `exames.preencher`, que e o que o RLS ja exigia, e os dois lados voltam a
-- falar a mesma lingua. Nada muda aqui no banco; o conserto e na aplicacao,
-- e esta anotado para quem for ler esta migration procurando o par.
-- ---------------------------------------------------------------------


do $$
declare v_logs int;
begin
  select count(*) into v_logs from public.clinical_access_logs;
  raise notice 'Acessos clinicos registrados ate agora: % (esperado zero antes desta correcao)', v_logs;
end$$;


-- #####################################################################
-- 0046_sala_do_exame_e_etapa_do_caixa.sql
-- #####################################################################

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


-- #####################################################################
-- 0047_valor_da_consulta_e_repasses_perdidos.sql
-- #####################################################################

-- =====================================================================
-- 0047 - A consulta ocupacional ganha valor, e os repasses perdidos voltam
--
-- ---------------------------------------------------------------------
-- O contexto
-- ---------------------------------------------------------------------
-- A "Consulta ocupacional" estava com R$ 0,00 no catalogo de procedimentos
-- -- "os itens em zero aguardam o valor que ainda nao foi informado", diz o
-- proprio catalogo. Como ela e o procedimento de quase TODO atendimento, o
-- repasse de todos os medicos saia zerado.
--
-- Pior: o zero tambem impedia o conserto. A recuperacao de lancamentos da
-- 0041 so recria o que tem valor maior que zero, entao ela passou por cima
-- de todas as consultas ocupacionais ja assinadas.
--
-- E havia um segundo motivo, corrigido no codigo junto com esta migration:
-- `lancarRepasse` pedia `attendances.doctor_id`, coluna que so existe em
-- `medical_consultations`. O banco recusava a consulta inteira, o erro nao
-- era lido, e NENHUM repasse foi lancado desde que o sistema existe.
--
-- ---------------------------------------------------------------------
-- R$ 100,00 e um valor de PARTIDA
-- ---------------------------------------------------------------------
-- Nao e a tabela da clinica: e um numero para o sistema parar de contar
-- zero enquanto a clinica define o dela. Ajustavel em Financeiro >
-- Repasse, e o valor por medico (Usuarios > Repasse) continua ganhando
-- deste.
--
-- Por isso o update abaixo so toca em quem esta em ZERO: se alguem ja
-- informou um valor, ele fica.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================

update public.procedure_types
   set default_fee = 100
 where code = 'consulta_ocupacional'
   and coalesce(default_fee, 0) = 0;


-- ---------------------------------------------------------------------
-- Os lancamentos que nunca nasceram
--
-- Toda consulta assinada por um medico, sem lancamento de repasse. Agora
-- com valor, a recuperacao da 0041 finalmente alcanca as consultas
-- ocupacionais.
--
-- Sao contas a pagar de verdade: o medico atendeu e o sistema nao
-- registrou. Ficam marcadas na observacao, para a clinica saber de onde
-- vieram ao conferir o mes.
-- ---------------------------------------------------------------------
insert into public.fee_entries
  (tenant_id, profile_id, attendance_id, patient_id, company_id, procedure_type_id,
   procedure_code, procedure_name, fee, competencia, status, notes)
select mc.tenant_id,
       mc.doctor_id,
       mc.attendance_id,
       mc.patient_id,
       a.company_id,
       pt.id,
       pt.code,
       pt.name,
       coalesce(mf.fee, pt.default_fee),
       -- Mesma competencia que a aplicacao usa: o mes de ABERTURA do
       -- atendimento, em Sao Paulo. Usar outra regra aqui faria os
       -- lancamentos recuperados cairem em meses diferentes dos novos.
       date_trunc(
         'month',
         (a.checkin_at at time zone 'America/Sao_Paulo')
       )::date,
       'a_pagar',
       'Lancamento recuperado: a consulta foi assinada antes da correcao de 30/09.'
  from public.medical_consultations mc
  join public.attendances a on a.id = mc.attendance_id
  join public.procedure_types pt
    on pt.tenant_id = mc.tenant_id
   and pt.code = coalesce(a.procedure_code, 'consulta_ocupacional')
  left join public.medical_fees mf
    on mf.procedure_type_id = pt.id and mf.profile_id = mc.doctor_id
 where mc.finished_at is not null
   and mc.doctor_id is not null
   and coalesce(mf.fee, pt.default_fee) > 0
   -- O indice unico da tabela e por (atendimento, procedimento); a
   -- checagem segue o mesmo par, senao o insert aborta em vez de pular.
   and not exists (
     select 1 from public.fee_entries fe
      where fe.attendance_id = mc.attendance_id
        and fe.procedure_code = pt.code);


do $$
declare v_valor numeric; v_recuperados int; v_total int;
begin
  select default_fee into v_valor from public.procedure_types
   where code = 'consulta_ocupacional' limit 1;
  select count(*) into v_recuperados from public.fee_entries
   where notes like 'Lancamento recuperado%';
  select count(*) into v_total from public.fee_entries;
  raise notice 'Consulta ocupacional: R$ %; repasses recuperados: %; total de lancamentos: %',
    v_valor, v_recuperados, v_total;
end$$;


-- #####################################################################
-- 0048_portal_do_paciente_sem_forca_bruta.sql
-- #####################################################################

-- =====================================================================
-- 0048 - O portal do paciente para de entregar o prontuario
--
-- ---------------------------------------------------------------------
-- O que a auditoria encontrou
-- ---------------------------------------------------------------------
-- O portal (`/meu`) autentica com CPF + data de nascimento. Sem senha,
-- sem token, sem limite de tentativas.
--
-- No Brasil o CPF nao e segredo. Sobra adivinhar a data de nascimento:
-- uma janela de trinta anos sao ~11 mil tentativas, e nada no sistema
-- contava tentativa nenhuma.
--
-- E o que se alcancava depois de entrar era tudo: todo gerador de
-- documento gravava `is_patient_visible = true` fixo, entao a ficha
-- clinica (pressao, IMC, glicemia, antecedentes, estilo de vida) e a
-- avaliacao psicossocial vinham em PDF junto com o recibo.
--
-- Pior detalhe: CPF e data de nascimento sao os dois campos impressos no
-- A.S.O. que a clinica entrega ao RH da empresa. Quem recebia aquele
-- papel tinha, em maos, a credencial do portal.
--
-- Esta migration faz as duas metades do banco. A outra metade esta no
-- codigo: cada gerador passou a decidir a visibilidade por tipo de
-- documento (`src/modules/documents/visivel-ao-paciente.ts`).
--
-- Pode ser executada mais de uma vez sem efeito colateral.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Documento clinico sai do portal — inclusive o que ja foi emitido
--
-- Retroativo de proposito: o estrago nao esta nos documentos de amanha,
-- esta nos que ja estao gravados com `true`.
--
-- A lista de tipos que FICAM e a mesma do codigo. Todos sao papel de
-- balcao: comprovam presenca, pagamento, agendamento, ou devolvem ao
-- paciente algo que ele proprio assinou.
-- ---------------------------------------------------------------------
update public.documents
   set is_patient_visible = false
 where is_patient_visible = true
   and kind::text not in (
     'recibo',
     'comprovante_comparecimento',
     'atestado_comparecimento',
     'comprovante_agendamento',
     'comprovante_compra',
     'resumo_pedido',
     'guia_exame',
     'autorizacao_envio_resultados'
   );


-- ---------------------------------------------------------------------
-- 2. Trava de tentativas
--
-- Guarda a tentativa, nao a credencial: o CPF entra como digest SHA-256,
-- que serve para contar tentativas do mesmo CPF e nao serve para montar
-- lista de CPF nenhum. A data de nascimento nao e guardada.
--
-- A contagem e por CPF porque e assim que o ataque acontece: mesmo CPF,
-- muitas datas.
-- ---------------------------------------------------------------------
create table if not exists public.portal_login_attempts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  cpf_digest  text not null,
  succeeded   boolean not null default false,
  attempted_at timestamptz not null default now()
);

create index if not exists portal_login_attempts_janela
  on public.portal_login_attempts (tenant_id, cpf_digest, attempted_at desc);

alter table public.portal_login_attempts enable row level security;
alter table public.portal_login_attempts force row level security;

-- Ninguem le esta tabela pela API: ela existe para a funcao abaixo, que e
-- SECURITY DEFINER. Sem policy de select, `anon` e `authenticated` nao
-- alcancam o historico de tentativas.
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'portal_login_attempts'
       and policyname = 'portal_attempts_admin_read'
  ) then
    create policy portal_attempts_admin_read
      on public.portal_login_attempts
      for select
      using (public.can_access(tenant_id, 'usuarios.administrar'));
  end if;
end$$;


-- ---------------------------------------------------------------------
-- Conta a tentativa e diz se ainda pode tentar.
--
-- Cinco falhas em quinze minutos fecham a porta para aquele CPF. Acerto
-- limpa o historico — quem entrou nao esta atacando ninguem.
--
-- Registra ANTES de responder, para que a propria chamada bloqueada
-- conte: senao bastaria insistir para nunca passar do quinto.
-- ---------------------------------------------------------------------
create or replace function public.portal_registrar_tentativa(
  p_tenant uuid,
  p_cpf    text,
  p_ok     boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_digest text;
  v_falhas int;
begin
  if p_tenant is null or coalesce(p_cpf, '') = '' then
    return false;
  end if;

  v_digest := encode(digest(p_cpf, 'sha256'), 'hex');

  if p_ok then
    -- Entrou: o contador dele zera.
    delete from public.portal_login_attempts
     where tenant_id = p_tenant and cpf_digest = v_digest;
    insert into public.portal_login_attempts (tenant_id, cpf_digest, succeeded)
    values (p_tenant, v_digest, true);
    return true;
  end if;

  insert into public.portal_login_attempts (tenant_id, cpf_digest, succeeded)
  values (p_tenant, v_digest, false);

  select count(*) into v_falhas
    from public.portal_login_attempts
   where tenant_id = p_tenant
     and cpf_digest = v_digest
     and succeeded = false
     and attempted_at > now() - interval '15 minutes';

  return v_falhas < 5;
end$$;

comment on function public.portal_registrar_tentativa(uuid, text, boolean) is
  'Conta tentativa de acesso ao portal do paciente e devolve false quando o CPF passou de cinco falhas em quinze minutos.';


-- ---------------------------------------------------------------------
-- Diz se aquele CPF esta cumprindo trava, sem contar tentativa nova.
--
-- Chamada ANTES de conferir CPF e nascimento: bloqueado nao chega ao
-- banco de pacientes.
-- ---------------------------------------------------------------------
create or replace function public.portal_pode_tentar(
  p_tenant uuid,
  p_cpf    text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_falhas int;
begin
  if p_tenant is null or coalesce(p_cpf, '') = '' then
    return false;
  end if;

  select count(*) into v_falhas
    from public.portal_login_attempts
   where tenant_id = p_tenant
     and cpf_digest = encode(digest(p_cpf, 'sha256'), 'hex')
     and succeeded = false
     and attempted_at > now() - interval '15 minutes';

  return v_falhas < 5;
end$$;

comment on function public.portal_pode_tentar(uuid, text) is
  'Consulta a trava do portal do paciente sem registrar tentativa.';


-- ---------------------------------------------------------------------
-- 3. /verificar passa a olhar a clinica
--
-- A pagina publica de verificacao consultava `documents` so pelo codigo,
-- com a chave de servico e sem filtro de tenant: o codigo de OUTRA
-- clinica era apresentado como documento autentico sob o nome desta. A
-- correcao esta no codigo (`src/app/verificar/page.tsx`); o indice abaixo
-- so faz a consulta com os dois campos ficar barata.
-- ---------------------------------------------------------------------
create index if not exists documents_verificacao_por_clinica
  on public.documents (tenant_id, verification_code)
  where verification_code is not null;


do $$
declare v_fechados int; v_abertos int;
begin
  select count(*) into v_fechados from public.documents where is_patient_visible = false;
  select count(*) into v_abertos  from public.documents where is_patient_visible = true;
  raise notice 'Portal do paciente: % documentos fora do portal, % mantidos (administrativos).',
    v_fechados, v_abertos;
end$$;


-- #####################################################################
-- 0049_senha_do_dia_sem_colisao.sql
-- #####################################################################

-- =====================================================================
-- 0049 - Dois totens ao mesmo tempo param de perder o check-in
--
-- ---------------------------------------------------------------------
-- O defeito
-- ---------------------------------------------------------------------
-- `next_ticket_sequence` fazia:
--
--     select coalesce(max(sequence), 0) + 1 from queue_tickets where ...
--
-- Sem lock. Dois check-ins no mesmo instante — dois totens, ou totem e
-- recepcao juntos — leem o mesmo `max` e devolvem a MESMA senha. A tabela
-- tem `unique (tenant_id, service_date, prefix, sequence)`, entao o
-- segundo insert viola a unica DENTRO de `checkin_patient`.
--
-- E como a excecao nao era tratada, a transacao inteira voltava atras: o
-- atendimento que acabara de ser criado desaparecia junto com a senha. O
-- paciente ve "erro" no totem e volta para a fila do balcao. Nas manhas de
-- movimento, que e quando dois totens sao usados ao mesmo tempo, e
-- exatamente quando falha.
--
-- ---------------------------------------------------------------------
-- A correcao: lock consultivo por fila do dia
-- ---------------------------------------------------------------------
-- `pg_advisory_xact_lock` serializa apenas quem esta tirando senha da
-- MESMA fila do MESMO dia da MESMA clinica. Quem tira senha de outra fila
-- nao espera nada, e o lock cai sozinho no fim da transacao — nao ha o que
-- vazar se algo falhar no meio.
--
-- Nao virou `sequence` do Postgres porque a numeracao reinicia todo dia e
-- e por prefixo: seriam N sequences por dia, criadas em tempo de execucao.
--
-- Pode ser executada mais de uma vez sem efeito colateral.
-- =====================================================================

create or replace function public.next_ticket_sequence(p_tenant uuid, p_date date, p_prefix text)
returns int
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare nxt int;
begin
  -- Uma chave por (clinica, dia, prefixo). `hashtextextended` devolve
  -- bigint, que e o que a versao de um argumento do lock aceita.
  perform pg_advisory_xact_lock(
    hashtextextended(p_tenant::text || '|' || p_date::text || '|' || coalesce(p_prefix, ''), 0)
  );

  select coalesce(max(sequence), 0) + 1 into nxt
  from public.queue_tickets
  where tenant_id = p_tenant and service_date = p_date and prefix = p_prefix;

  return nxt;
end$$;

comment on function public.next_ticket_sequence(uuid, date, text) is
  'Proxima senha do dia para a fila. Serializa por (clinica, dia, prefixo) com lock consultivo: dois totens simultaneos nao tiram a mesma senha.';


-- ---------------------------------------------------------------------
-- Por que o lock basta, e nao ha retry
-- ---------------------------------------------------------------------
-- `checkin_patient` e a UNICA coisa em todo o sistema que insere senha
-- (verificado: um `insert into queue_tickets` no repo, na 0013). Ela roda
-- como uma chamada, logo uma transacao.
--
-- Com o lock tomado dentro de `next_ticket_sequence` e mantido ate o fim
-- da transacao, o segundo check-in espera o primeiro COMMITAR antes de
-- calcular o `max` — e ai ja ve a senha do primeiro. A colisao nao
-- acontece, entao nao ha o que repetir.
--
-- Escrever um retry aqui seria codigo que nunca executa. Se algum dia
-- outro caminho passar a inserir senha, ele tem de chamar esta funcao.
-- ---------------------------------------------------------------------


-- #####################################################################
-- 0050_uma_cobranca_por_atendimento_na_recepcao.sql
-- #####################################################################

-- =====================================================================
-- 0050 - Duas recepcionistas param de cobrar o mesmo atendimento duas vezes
--
-- ---------------------------------------------------------------------
-- O defeito
-- ---------------------------------------------------------------------
-- `gerarCobrancaRecepcao` evita cobranca dupla LENDO antes de escrever:
-- procura uma cobranca pendente do atendimento e reaproveita. Leitura
-- seguida de escrita, sem trava nenhuma.
--
-- Duas recepcionistas na mesma ficha — ou dois cliques rapidos no mesmo
-- botao — leem "nao existe" ao mesmo tempo e as duas inserem. O atendimento
-- fica com dois Pix abertos, e a receita aparece DOBRADA no fluxo de caixa,
-- no relatorio do contador e no painel.
--
-- `payments` nao tinha nenhum indice unico. O de-dupe existia so em codigo,
-- e codigo nao resolve corrida.
--
-- ---------------------------------------------------------------------
-- Por que o indice e parcial, e nao em (tenant_id, attendance_id)
-- ---------------------------------------------------------------------
-- Uma cobranca unica por atendimento seria errado: a tela de Financeiro
-- deixa a clinica lancar uma cobranca a mais no mesmo atendimento de
-- proposito (exame incluido depois, acerto de diferenca), e um indice
-- amplo passaria a recusar isso com erro de banco.
--
-- Entao o indice cobre exatamente o que a corrida produz: a cobranca que a
-- RECEPCAO gera (`provider = 'pix_manual'`), enquanto esta em aberto. Duas
-- dessas ao mesmo tempo nunca sao intencionais — o proprio codigo cancela
-- a anterior quando o valor muda. Cobranca paga, cancelada ou estornada sai
-- do indice, e a recepcao pode gerar a proxima.
--
-- Pode ser executada mais de uma vez sem efeito colateral.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Antes do indice, limpar o que a corrida ja deixou: cobrancas abertas
-- repetidas do mesmo atendimento. Fica a mais antiga (e a que tem o Pix
-- que o paciente pode ter recebido); as outras sao canceladas com motivo.
--
-- Sem esta limpeza a criacao do indice falharia em qualquer banco que ja
-- tenha sofrido o defeito.
-- ---------------------------------------------------------------------
with repetidas as (
  select id,
         row_number() over (
           partition by tenant_id, attendance_id
           order by created_at
         ) as ordem
    from public.payments
   where attendance_id is not null
     and provider = 'pix_manual'
     and status in ('pendente', 'em_analise')
     and deleted_at is null
)
update public.payments p
   set status = 'cancelado',
       cancelled_at = now()
  from repetidas r
 where p.id = r.id
   and r.ordem > 1;

create unique index if not exists uq_cobranca_aberta_da_recepcao
  on public.payments (tenant_id, attendance_id)
  where attendance_id is not null
    and provider = 'pix_manual'
    and status in ('pendente', 'em_analise')
    and deleted_at is null;

comment on index public.uq_cobranca_aberta_da_recepcao is
  'Uma cobranca da recepcao em aberto por atendimento. Impede a cobranca dupla quando duas telas geram ao mesmo tempo.';


do $$
declare v_canceladas int;
begin
  select count(*) into v_canceladas
    from public.payments
   where cancelled_at is not null and provider = 'pix_manual';
  raise notice 'Cobrancas da recepcao canceladas (inclui as duplicadas recolhidas agora): %', v_canceladas;
end$$;


-- #####################################################################
-- 0051_reabrir_atendimento_devolve_os_exames.sql
-- #####################################################################

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
       started_at = null
  from public.attendances a
 where pe.attendance_id = a.id
   and a.stage_code in ('aguardando_exames','em_exames')
   and a.finished_at is null
   and a.cancelled_at is null
   and a.absent_at is null
   and a.deleted_at is null
   and pe.status = 'cancelado'
   and not exists (
     select 1 from public.patient_exams outro
      where outro.attendance_id = a.id
        and outro.status in ('pendente','em_fila','chamado','em_andamento','concluido'));


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


-- #####################################################################
-- 0052_assinatura_do_medico_volta_a_funcionar.sql
-- #####################################################################

-- =====================================================================
-- 0052 - O medico volta a conseguir guardar e usar a propria assinatura
--
-- ---------------------------------------------------------------------
-- O defeito
-- ---------------------------------------------------------------------
-- A politica do bucket `signatures` da 0014 tem o comentario:
--
--     "Assinaturas: somente admin de usuarios e o proprio profissional"
--
-- ...e implementa so a primeira metade. A condicao e
-- `can_access(..., 'usuarios.administrar')` nas duas direcoes, e o papel
-- `medico_examinador` NAO tem essa permissao — ela e de administracao de
-- usuarios, e o medico nao administra usuario nenhum.
--
-- Resultado em cadeia:
--
--   1. GRAVAR: o medico abre o perfil, desenha a assinatura, salva. O
--      upload e recusado pela RLS e ele ve um erro de storage sem
--      explicacao.
--
--   2. LER: pior, porque e silencioso. `carregarSignatario` chama
--      `createSignedUrl` com o cliente do USUARIO. A RLS recusa, a
--      chamada devolve `{ data: null, error }` sem lancar excecao, e o
--      codigo so testa `if (data?.signedUrl)`. O A.S.O. sai com "Assinado
--      eletronicamente" e uma linha em branco.
--
-- Ou seja: a captura da assinatura de cada medico, que a clinica pediu e
-- que existe implementada na tela, nunca funcionou em producao — e o
-- documento saia sem assinatura sem avisar ninguem.
--
-- ---------------------------------------------------------------------
-- A politica nova, nas tres frentes
-- ---------------------------------------------------------------------
-- O caminho do arquivo e `<tenant>/profissionais/<user_id>.png`
-- (`medicos-actions.ts`), entao da para reconhecer o dono pelo nome.
--
--   ESCREVER e APAGAR -> o proprio dono, ou quem administra usuarios
--                        (para o caso do medico que nao usa o sistema e
--                        entrega a assinatura digitalizada no balcao).
--
--   LER -> os dois acima, mais quem emite documento.
--
-- A leitura e mais larga de proposito: quem emite o A.S.O. pela aba
-- Documentos e muitas vezes a recepcao, e sem poder ler a imagem ela
-- emitiria o documento do medico sem a assinatura dele. Vale registrar o
-- que isso significa: quem emite documento consegue baixar a imagem da
-- assinatura dos profissionais da propria clinica. E a mesma confianca
-- que a clinica ja deposita em quem imprime e entrega o A.S.O. assinado —
-- e, por isso mesmo, a imagem nao substitui assinatura digital ICP-Brasil
-- para fins do CFM 2.299/2021.
--
-- Pode ser executada mais de uma vez sem efeito colateral.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Dono do arquivo de assinatura.
--
-- `storage.foldername(name)` devolve as pastas; o arquivo e
-- `<tenant>/profissionais/<uuid>.png`, entao o dono esta no nome do
-- arquivo, nao na pasta. Funcao propria para a politica ficar legivel e
-- para o formato do caminho viver em UM lugar.
-- ---------------------------------------------------------------------
create or replace function public.assinatura_e_minha(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
     and p_name = public.current_tenant_id()::text
              || '/profissionais/'
              || auth.uid()::text
              || '.png';
$$;

comment on function public.assinatura_e_minha(text) is
  'Verdadeiro quando o caminho no bucket signatures e o arquivo de assinatura do proprio usuario logado.';


drop policy if exists wl_signatures on storage.objects;
drop policy if exists wl_signatures_ler on storage.objects;
drop policy if exists wl_signatures_gravar on storage.objects;
drop policy if exists wl_signatures_trocar on storage.objects;
drop policy if exists wl_signatures_apagar on storage.objects;

-- Ler: o dono, quem administra usuarios, ou quem emite documento.
create policy wl_signatures_ler on storage.objects for select to authenticated
  using (
    bucket_id = 'signatures'
    and (
      public.assinatura_e_minha(name)
      or public.can_access(public.storage_tenant(name), 'usuarios.administrar')
      or public.can_access(public.storage_tenant(name), 'documentos.emitir')
    )
  );

-- Gravar: so o dono ou quem administra usuarios.
create policy wl_signatures_gravar on storage.objects for insert to authenticated
  with check (
    bucket_id = 'signatures'
    and (
      public.assinatura_e_minha(name)
      or public.can_access(public.storage_tenant(name), 'usuarios.administrar')
    )
  );

-- Trocar (o upsert da tela de perfil passa por aqui).
create policy wl_signatures_trocar on storage.objects for update to authenticated
  using (
    bucket_id = 'signatures'
    and (
      public.assinatura_e_minha(name)
      or public.can_access(public.storage_tenant(name), 'usuarios.administrar')
    )
  )
  with check (
    bucket_id = 'signatures'
    and (
      public.assinatura_e_minha(name)
      or public.can_access(public.storage_tenant(name), 'usuarios.administrar')
    )
  );

-- Apagar.
create policy wl_signatures_apagar on storage.objects for delete to authenticated
  using (
    bucket_id = 'signatures'
    and (
      public.assinatura_e_minha(name)
      or public.can_access(public.storage_tenant(name), 'usuarios.administrar')
    )
  );


do $$
declare v_politicas int;
begin
  select count(*) into v_politicas from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname like 'wl_signatures%';
  raise notice 'Politicas do bucket de assinaturas: % (esperado 4)', v_politicas;
end$$;
