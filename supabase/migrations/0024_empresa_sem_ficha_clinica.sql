-- =====================================================================
-- 0024 - Empresa dispensada da ficha clinica
--
-- "Documentos: emitir ficha clinica exceto para pericia, acl, sisper e
--  empresa agape"
--
-- Pericia, ACL e SISPER sao caracteristicas do atendimento e ja sao
-- resolvidas por procedencia e procedimento. A Agape e o unico caso ligado
-- ao contrato da empresa, e por isso vira uma marca no cadastro dela — e
-- nao um nome escrito no codigo. Amanha entra outra empresa na mesma
-- regra sem precisar de deploy.
-- =====================================================================

alter table public.companies
  add column if not exists emite_ficha_clinica boolean not null default true;

comment on column public.companies.emite_ficha_clinica is
  'Quando falso, o atendimento do colaborador nao oferece ficha clinica: '
  'sai apenas o A.S.O. e os laudos dos exames.';
