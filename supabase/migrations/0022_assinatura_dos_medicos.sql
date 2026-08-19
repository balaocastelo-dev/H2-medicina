-- =====================================================================
-- Assinatura manuscrita de cada medico
--
-- Os documentos de saida (A.S.O., resultado de exame, atestado) saem com
-- a assinatura do medico responsavel. A imagem fica no bucket privado
-- 'signatures'; aqui guardamos so o caminho.
--
-- A captura e sempre feita pelo proprio medico, e a data do consentimento
-- registra quando ele autorizou o uso da assinatura nos documentos.
-- =====================================================================

alter table public.profiles
  add column if not exists signature_path       text,
  add column if not exists signature_updated_at timestamptz,
  add column if not exists signature_consent_at timestamptz,
  add column if not exists rqe                  text;

comment on column public.profiles.signature_path is
  'Caminho da assinatura no bucket signatures. A imagem nunca fica no banco.';
comment on column public.profiles.signature_consent_at is
  'Quando o profissional autorizou o uso da assinatura nos documentos emitidos.';
comment on column public.profiles.rqe is
  'Registro de Qualificacao de Especialista, quando houver.';

-- Quem assinou cada documento emitido.
alter table public.documents
  add column if not exists signed_by         uuid references public.profiles(id) on delete set null,
  add column if not exists signer_name       text,
  add column if not exists signer_council    text;

comment on column public.documents.signer_name is
  'Nome e registro gravados no momento da emissao: o documento nao muda se o cadastro mudar depois.';

create index if not exists idx_documents_signer
  on public.documents (tenant_id, signed_by) where deleted_at is null;
