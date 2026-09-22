-- =====================================================================
-- 0037 - Medico responsavel pelo PCMSO fica na empresa
--
-- "aba empresa precisa ter um campo para incluir o medico do PCMSO, nome
--  e crm" / "assim no aso vai sair o nome do responsavel do PCMSO"
--                                              -- Isabella, 21/09
--
-- O A.S.O. traz o medico responsavel pelo PCMSO da EMPRESA do trabalhador,
-- nao o da clinica. Cada empresa contrata o seu, e o mesmo colaborador
-- pode aparecer em duas empresas com responsaveis diferentes.
--
-- Ate aqui esse nome saia de uma configuracao unica do sistema, o que
-- estava certo enquanto a clinica atendia uma empresa so.
--
-- A configuracao continua valendo como padrao: empresa sem responsavel
-- cadastrado cai nela, como antes.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================

alter table public.companies
  add column if not exists pcmso_doctor_name    text,
  add column if not exists pcmso_doctor_council text,
  add column if not exists pcmso_doctor_number  text,
  add column if not exists pcmso_doctor_state   char(2);

comment on column public.companies.pcmso_doctor_name is
  'Medico responsavel pelo PCMSO desta empresa; sai impresso no A.S.O.';
comment on column public.companies.pcmso_doctor_council is
  'Conselho do responsavel pelo PCMSO (CRM, CRO...). Vazio vale CRM.';

-- Sigla de conselho e UF em caixa alta, como saem no papel.
alter table public.companies
  drop constraint if exists companies_pcmso_state_valid;
alter table public.companies
  add constraint companies_pcmso_state_valid
  check (pcmso_doctor_state is null or pcmso_doctor_state ~ '^[A-Z]{2}$');
