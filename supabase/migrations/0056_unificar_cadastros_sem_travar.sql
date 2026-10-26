-- ===========================================================================
-- 0056 — Unificar cadastros sem travar, e o totem juntando o duplicado
-- ===========================================================================
--
--     26/10/2026 - Isa: "vi agora que ele ainda esta duplicando os pacientes
--                        quando cadastra de forma automatica"
--                       "o cpf nao esta ficando vinculado ao perfil da pessoa
--                        quando ela passa pelo totem e registra"
--
-- A lista do eSisla nao traz CPF. Quem ja tinha vindo antes ganhava um
-- segundo cadastro, sem CPF, a cada lista colada -- e o agendamento novo ia
-- para ele. No totem o CPF achava o cadastro antigo, sem agendamento hoje,
-- e a pessoa virava encaixe.
--
-- A ferramenta de unificar existia, mas travava justamente nesses casos:
--
--   1. Unificar com o cadastro SEM CPF como destino copiava o CPF da origem
--      antes de arquivar a origem. Por um instante havia dois cadastros
--      vivos com o mesmo CPF, e o indice unico `uq_patients_tenant_cpf`
--      recusava tudo.
--   2. Os dois cadastros com agendamento no mesmo dia: mover o agendamento
--      batia em `uq_appointments_patient_day`.
--   3. Vinculo atual com a mesma empresa nos dois: `uq_patient_employment_current`.
--
-- E nao seguia a regra combinada em 13/09 ("quando os dois cadastros tem
-- dados diferentes, vale o mais completo"): o destino era sempre o cadastro
-- aberto na tela, com ou sem CPF.
--
-- O que muda:
--
--   * `merge_patients_core` faz a unificacao, sem conferir permissao. Nao e
--     exposta a ninguem: so as funcoes abaixo e o script de limpeza a usam.
--   * `merge_patients` continua sendo a da tela: confere a permissao e chama
--     a de cima.
--   * `unificar_no_totem` e o caso estreito do totem: o CPF digitado e de um
--     cadastro sem agendamento hoje, e ha um cadastro SEM CPF, com o MESMO
--     nome, agendado para hoje. So nesse caso, e so esse par.
--
-- Idempotente: pode rodar duas vezes.
-- ===========================================================================


-- ---------------------------------------------------------------------
-- 1. Nome comparavel, igual ao do sistema (normalizarBusca)
-- ---------------------------------------------------------------------
create or replace function public.chave_nome(p_nome text)
returns text
language sql
immutable
as $$
  select btrim(regexp_replace(
           regexp_replace(coalesce(public.normalize_text(p_nome), ''), '[^a-z0-9 ]', ' ', 'g'),
           '\s+', ' ', 'g'));
$$;

comment on function public.chave_nome(text) is
  'Nome sem acento, sem caixa e sem pontuacao, para reconhecer a mesma pessoa escrita de jeitos diferentes.';


-- ---------------------------------------------------------------------
-- 2. A unificacao propriamente dita
-- ---------------------------------------------------------------------
create or replace function public.merge_patients_core(p_source uuid, p_target uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_src public.patients%rowtype;
  v_dst public.patients%rowtype;
  v_tmp public.patients%rowtype;
  v_cpf text;
  v_external text;
  v_ag record;
  v_rank_src int;
  v_rank_dst int;
begin
  if p_source = p_target then
    raise exception 'Origem e destino nao podem ser o mesmo cadastro' using errcode = '22023';
  end if;

  select * into v_src from public.patients where id = p_source and deleted_at is null;
  if v_src.id is null then
    raise exception 'Cadastro de origem nao encontrado' using errcode = 'P0002';
  end if;
  select * into v_dst from public.patients
   where id = p_target and tenant_id = v_src.tenant_id and deleted_at is null;
  if v_dst.id is null then
    raise exception 'Cadastro de destino nao encontrado' using errcode = 'P0002';
  end if;

  -- Dois CPFs diferentes sao duas pessoas. Duas datas de nascimento
  -- diferentes, tambem -- ou um erro de digitacao que alguem precisa
  -- corrigir antes, olhando o documento.
  if v_src.cpf is not null and v_dst.cpf is not null and v_src.cpf <> v_dst.cpf then
    raise exception 'Os dois cadastros tem CPFs diferentes: nao sao a mesma pessoa'
      using errcode = '22023';
  end if;
  if v_src.birth_date is not null and v_dst.birth_date is not null
     and v_src.birth_date <> v_dst.birth_date then
    raise exception 'Os dois cadastros tem datas de nascimento diferentes. Corrija a data errada antes de unificar'
      using errcode = '22023';
  end if;

  -- Vale o mais completo: quem tem CPF fica, mesmo que a tela tenha sido
  -- aberta no outro.
  if v_src.cpf is not null and v_dst.cpf is null then
    v_tmp := v_src; v_src := v_dst; v_dst := v_tmp;
  end if;

  -- Agendamento dos dois no mesmo dia: fica o que andou mais.
  for v_ag in
    select a.id as src_id, a.status as src_status, b.id as dst_id, b.status as dst_status
      from public.appointments a
      join public.appointments b
        on b.patient_id = v_dst.id
       and b.tenant_id = a.tenant_id
       and b.scheduled_date = a.scheduled_date
       and b.deleted_at is null
       and b.status not in ('cancelado','remarcado')
     where a.patient_id = v_src.id
       and a.deleted_at is null
       and a.status not in ('cancelado','remarcado')
  loop
    v_rank_src := case v_ag.src_status::text
      when 'realizado' then 5 when 'em_atendimento' then 4 when 'checkin' then 3
      when 'confirmado' then 2 else 1 end;
    v_rank_dst := case v_ag.dst_status::text
      when 'realizado' then 5 when 'em_atendimento' then 4 when 'checkin' then 3
      when 'confirmado' then 2 else 1 end;
    update public.appointments
       set status = 'cancelado',
           notes = concat_ws(' · ', notes, 'Duplicado: cadastros unificados')
     where id = case when v_rank_src > v_rank_dst then v_ag.dst_id else v_ag.src_id end;
  end loop;

  -- Vinculo atual com a mesma empresa nos dois: o da origem vira historico.
  update public.patient_employments e
     set is_current = false
   where e.patient_id = v_src.id
     and e.is_current
     and exists (select 1 from public.patient_employments d
                  where d.patient_id = v_dst.id and d.is_current and d.company_id = e.company_id);

  -- O CPF sai da origem ANTES de entrar no destino: os dois vivos com o
  -- mesmo CPF, nem por um instante.
  v_cpf := coalesce(v_dst.cpf, v_src.cpf);
  v_external := coalesce(v_dst.external_id, v_src.external_id);
  update public.patients set cpf = null, external_id = null where id = v_src.id;

  update public.appointments          set patient_id = v_dst.id where patient_id = v_src.id;
  update public.attendances           set patient_id = v_dst.id where patient_id = v_src.id;
  update public.patient_exams         set patient_id = v_dst.id where patient_id = v_src.id;
  update public.exam_results          set patient_id = v_dst.id where patient_id = v_src.id;
  update public.triages               set patient_id = v_dst.id where patient_id = v_src.id;
  update public.medical_consultations set patient_id = v_dst.id where patient_id = v_src.id;
  update public.medical_notes         set patient_id = v_dst.id where patient_id = v_src.id;
  update public.patient_attachments   set patient_id = v_dst.id where patient_id = v_src.id;
  update public.patient_employments   set patient_id = v_dst.id where patient_id = v_src.id;
  update public.patient_consents      set patient_id = v_dst.id where patient_id = v_src.id;
  update public.documents             set patient_id = v_dst.id where patient_id = v_src.id;
  update public.payments              set patient_id = v_dst.id where patient_id = v_src.id;
  update public.queue_tickets         set patient_id = v_dst.id where patient_id = v_src.id;
  update public.order_items           set patient_id = v_dst.id where patient_id = v_src.id;

  -- Completa o destino com o que so a origem tinha.
  update public.patients t set
    cpf                     = v_cpf,
    external_id             = v_external,
    rg                      = coalesce(t.rg, v_src.rg),
    external_document       = coalesce(t.external_document, v_src.external_document),
    social_name             = coalesce(t.social_name, v_src.social_name),
    birth_date              = coalesce(t.birth_date, v_src.birth_date),
    gender                  = case when t.gender = 'nao_informado' then v_src.gender else t.gender end,
    mother_name             = coalesce(t.mother_name, v_src.mother_name),
    phone                   = coalesce(t.phone, v_src.phone),
    whatsapp                = coalesce(t.whatsapp, v_src.whatsapp),
    email                   = coalesce(t.email, v_src.email),
    zip_code                = coalesce(t.zip_code, v_src.zip_code),
    street                  = coalesce(t.street, v_src.street),
    number                  = coalesce(t.number, v_src.number),
    complement              = coalesce(t.complement, v_src.complement),
    district                = coalesce(t.district, v_src.district),
    city                    = coalesce(t.city, v_src.city),
    state                   = coalesce(t.state, v_src.state),
    company_id              = coalesce(t.company_id, v_src.company_id),
    job_title               = coalesce(t.job_title, v_src.job_title),
    department              = coalesce(t.department, v_src.department),
    registration_number     = coalesce(t.registration_number, v_src.registration_number),
    emergency_contact_name  = coalesce(t.emergency_contact_name, v_src.emergency_contact_name),
    emergency_contact_phone = coalesce(t.emergency_contact_phone, v_src.emergency_contact_phone),
    notes                   = case when v_src.notes is null or v_src.notes = t.notes then t.notes
                                   else concat_ws(chr(10), t.notes, v_src.notes) end,
    -- Sem CPF nos dois, o cadastro continua pedindo conferencia.
    needs_review            = (v_cpf is null),
    review_reason           = case when v_cpf is null then coalesce(t.review_reason, v_src.review_reason) end,
    updated_at              = now()
   where t.id = v_dst.id;

  update public.patients
     set deleted_at = now(),
         needs_review = false,
         notes = concat_ws(chr(10), notes,
                 format('Cadastro unificado em %s no paciente %s.', now()::date, v_dst.full_name))
   where id = v_src.id;

  insert into public.audit_logs
    (tenant_id, user_id, action, entity, entity_id, patient_id, description, origin, is_automatic)
  values
    (v_src.tenant_id, auth.uid(), 'update', 'patients', v_dst.id, v_dst.id,
     format('Cadastro de %s unificado em %s', v_src.full_name, v_dst.full_name), 'sistema',
     auth.uid() is null);

  return jsonb_build_object(
    'source', v_src.id, 'source_name', v_src.full_name,
    'target', v_dst.id, 'target_name', v_dst.full_name);
end$$;

revoke all on function public.merge_patients_core(uuid, uuid) from public;
revoke all on function public.merge_patients_core(uuid, uuid) from anon;
revoke all on function public.merge_patients_core(uuid, uuid) from authenticated;

comment on function public.merge_patients_core is
  'Unifica dois cadastros sem conferir permissao. Uso interno: merge_patients, unificar_no_totem e o script de limpeza.';


-- ---------------------------------------------------------------------
-- 3. A da tela: confere a permissao e unifica
-- ---------------------------------------------------------------------
create or replace function public.merge_patients(p_source uuid, p_target uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.patients where id = p_source and deleted_at is null;
  if v_tenant is null then
    raise exception 'Cadastro de origem nao encontrado' using errcode = 'P0002';
  end if;
  if not public.can_access(v_tenant, 'pacientes.editar') then
    raise exception 'Sem permissao para unificar cadastros' using errcode = '42501';
  end if;
  return public.merge_patients_core(p_source, p_target);
end$$;

comment on function public.merge_patients is
  'Unifica dois cadastros do mesmo paciente. O destino e o cadastro com CPF, quando so um deles tem.';

grant execute on function public.merge_patients(uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 4. O caso do totem
-- ---------------------------------------------------------------------
create or replace function public.unificar_no_totem(p_com_cpf uuid, p_sem_cpf uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_com public.patients%rowtype;
  v_sem public.patients%rowtype;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into v_com from public.patients where id = p_com_cpf and deleted_at is null;
  select * into v_sem from public.patients where id = p_sem_cpf and deleted_at is null;
  if v_com.id is null or v_sem.id is null or v_com.tenant_id <> v_sem.tenant_id then
    raise exception 'Cadastro nao encontrado' using errcode = 'P0002';
  end if;
  if not public.can_access(v_com.tenant_id, 'totem.operar') then
    raise exception 'Sem permissao' using errcode = '42501';
  end if;

  -- O totem fica em area publica: so junta o par exato que ele mesmo achou.
  if v_com.cpf is null or v_sem.cpf is not null then
    raise exception 'Este par nao pode ser unificado pelo totem' using errcode = '22023';
  end if;
  if public.chave_nome(v_com.full_name) <> public.chave_nome(v_sem.full_name)
     or public.chave_nome(v_com.full_name) = '' then
    raise exception 'Os nomes nao conferem' using errcode = '22023';
  end if;
  if v_com.birth_date is not null and v_sem.birth_date is not null
     and v_com.birth_date <> v_sem.birth_date then
    raise exception 'As datas de nascimento nao conferem' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.appointments
     where patient_id = v_sem.id and scheduled_date = v_hoje
       and deleted_at is null and status not in ('cancelado','remarcado')
  ) then
    raise exception 'O cadastro sem CPF nao tem agendamento hoje' using errcode = '22023';
  end if;

  return public.merge_patients_core(v_sem.id, v_com.id);
end$$;

comment on function public.unificar_no_totem is
  'Totem: junta ao cadastro do CPF digitado o cadastro sem CPF, de mesmo nome, agendado para hoje.';

grant execute on function public.unificar_no_totem(uuid, uuid) to authenticated;
