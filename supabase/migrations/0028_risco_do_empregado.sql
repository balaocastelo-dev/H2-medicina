-- =====================================================================
-- Risco ocupacional anotado no cadastro do empregado
--
-- "Na parte de cadastro do paciente deve existir um campo onde podemos
--  colocar o risco ocupacional do empregado da empresa. Esse risco
--  ocupacional deve aparecer no documento A.S.O." -- Isabella, 15/09.
--
-- Ate aqui o risco vinha so do perfil da empresa por cargo. Serve para a
-- maioria, mas nao para o empregado que faz algo diferente do resto do
-- cargo dele. Quando este campo esta preenchido, ele vence o perfil.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================

alter table public.patients
  add column if not exists occupational_risks text;

comment on column public.patients.occupational_risks is
  'Perigos e fatores de risco deste empregado, quando diferem do perfil do cargo. Sai impresso no A.S.O.';
