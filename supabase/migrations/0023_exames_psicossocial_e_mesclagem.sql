-- =====================================================================
-- 0023 - Ajustes pedidos pela clinica entre 20/08 e 27/08
--
-- Cobre o que ainda faltava da lista da recepcao:
--   * bloco psicossocial na ficha clinica;
--   * fichas de exame preenchidas na sala (Romberg, fadiga, dinamometria,
--     Ishihara, acuidade);
--   * laudos que chegam dias depois, anexados ao cadastro do paciente;
--   * unificacao de cadastros duplicados do mesmo paciente.
--
-- Nada aqui e especifico de um cliente: os exames entram por seed e as
-- perguntas ficam no codigo, como os demais blocos da ficha.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. AVALIACAO PSICOSSOCIAL
-- "incluir perguntas de exame psicossocial, caso essa opcao tenha sido
--  flegada na aba recepcao"
--
-- Segue o mesmo formato dos outros blocos da ficha: um jsonb por bloco.
-- ---------------------------------------------------------------------
alter table public.medical_consultations
  add column if not exists psicossocial jsonb not null default '{}'::jsonb;

comment on column public.medical_consultations.psicossocial is
  'Respostas do questionario de fatores de risco psicossocial. So e '
  'preenchido quando a recepcao marca o exame para o paciente.';

-- ---------------------------------------------------------------------
-- 2. EXAMES EXECUTADOS FORA DA CLINICA E COM DESCRICAO LIVRE
-- "Raio x nao tera sala, devera ser emitido uma guia no final do
--  atendimento encaminhando para exame"
-- "exames laboratoriais deve ter uma aba para descrever qual analise
--  deve ser feita"
-- ---------------------------------------------------------------------
alter table public.exam_types
  add column if not exists is_external          boolean not null default false,
  add column if not exists requires_description boolean not null default false;

comment on column public.exam_types.is_external is
  'Exame feito fora da clinica: nao entra em fila de sala e sai como guia.';
comment on column public.exam_types.requires_description is
  'A recepcao precisa descrever o que foi solicitado (analises, incidencias).';

-- ---------------------------------------------------------------------
-- 3. LAUDOS QUE CHEGAM DEPOIS
-- "alguns exames sao laudados depois de alguns dias, ter a opcao de
--  anexar exames no cadastro do paciente"
--
-- A tabela patient_attachments ja existia sem uso; ganha aqui o vinculo
-- com o tipo de exame para o laudo aparecer junto do exame certo.
-- ---------------------------------------------------------------------
alter table public.patient_attachments
  add column if not exists exam_type_id    uuid references public.exam_types(id) on delete set null,
  add column if not exists patient_exam_id uuid references public.patient_exams(id) on delete set null,
  add column if not exists kind            text not null default 'exame';

create index if not exists idx_patient_attachments_paciente
  on public.patient_attachments (tenant_id, patient_id, created_at desc)
  where deleted_at is null;

-- ---------------------------------------------------------------------
-- 4. UNIFICAR CADASTROS DO MESMO PACIENTE
-- "criar opc de mesclar clientes" / "Unificar cadastros de pacientes"
--
-- Move todo o historico para o cadastro de destino e arquiva o de origem.
-- Nada e apagado: o cadastro antigo continua consultavel na auditoria.
-- ---------------------------------------------------------------------
create or replace function public.merge_patients(p_source uuid, p_target uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_source_name text;
  v_target_name text;
begin
  if p_source = p_target then
    raise exception 'Origem e destino nao podem ser o mesmo cadastro'
      using errcode = '22023';
  end if;

  select tenant_id, full_name into v_tenant, v_source_name
    from public.patients where id = p_source and deleted_at is null;
  if v_tenant is null then
    raise exception 'Cadastro de origem nao encontrado' using errcode = 'P0002';
  end if;

  select full_name into v_target_name
    from public.patients
   where id = p_target and tenant_id = v_tenant and deleted_at is null;
  if v_target_name is null then
    raise exception 'Cadastro de destino nao encontrado' using errcode = 'P0002';
  end if;

  if not public.can_access(v_tenant, 'pacientes.editar') then
    raise exception 'Sem permissao para unificar cadastros' using errcode = '42501';
  end if;

  update public.appointments          set patient_id = p_target where patient_id = p_source;
  update public.attendances           set patient_id = p_target where patient_id = p_source;
  update public.patient_exams         set patient_id = p_target where patient_id = p_source;
  update public.exam_results          set patient_id = p_target where patient_id = p_source;
  update public.triages               set patient_id = p_target where patient_id = p_source;
  update public.medical_consultations set patient_id = p_target where patient_id = p_source;
  update public.medical_notes         set patient_id = p_target where patient_id = p_source;
  update public.patient_attachments   set patient_id = p_target where patient_id = p_source;
  update public.patient_employments   set patient_id = p_target where patient_id = p_source;
  update public.patient_consents      set patient_id = p_target where patient_id = p_source;
  update public.documents             set patient_id = p_target where patient_id = p_source;
  update public.payments              set patient_id = p_target where patient_id = p_source;
  update public.queue_tickets         set patient_id = p_target where patient_id = p_source;
  update public.order_items           set patient_id = p_target where patient_id = p_source;

  -- Completa no destino apenas os campos que estiverem vazios: o cadastro
  -- escolhido pela recepcao continua sendo a versao boa.
  update public.patients t set
    cpf                 = coalesce(t.cpf, s.cpf),
    rg                  = coalesce(t.rg, s.rg),
    birth_date          = coalesce(t.birth_date, s.birth_date),
    phone               = coalesce(t.phone, s.phone),
    whatsapp            = coalesce(t.whatsapp, s.whatsapp),
    email               = coalesce(t.email, s.email),
    zip_code            = coalesce(t.zip_code, s.zip_code),
    street              = coalesce(t.street, s.street),
    number              = coalesce(t.number, s.number),
    district            = coalesce(t.district, s.district),
    city                = coalesce(t.city, s.city),
    state               = coalesce(t.state, s.state),
    company_id          = coalesce(t.company_id, s.company_id),
    job_title           = coalesce(t.job_title, s.job_title),
    department          = coalesce(t.department, s.department),
    registration_number = coalesce(t.registration_number, s.registration_number),
    needs_review        = false,
    updated_at          = now()
    from public.patients s
   where t.id = p_target and s.id = p_source;

  update public.patients
     set deleted_at = now(),
         needs_review = false,
         notes = concat_ws(chr(10), notes,
                 format('Cadastro unificado em %s no paciente %s.', now()::date, v_target_name))
   where id = p_source;

  insert into public.audit_logs
    (tenant_id, user_id, action, entity, entity_id, patient_id, description, origin, is_automatic)
  values
    (v_tenant, auth.uid(), 'update', 'patients', p_target, p_target,
     format('Cadastro de %s unificado em %s', v_source_name, v_target_name), 'sistema', false);

  return jsonb_build_object(
    'source', p_source, 'source_name', v_source_name,
    'target', p_target, 'target_name', v_target_name);
end$$;

comment on function public.merge_patients is
  'Unifica dois cadastros do mesmo paciente, movendo todo o historico para o destino.';

grant execute on function public.merge_patients(uuid, uuid) to authenticated;
