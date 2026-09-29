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
