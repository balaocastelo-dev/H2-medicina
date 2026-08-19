-- =====================================================================
-- 0017 - Ajustes pedidos pela clinica
--
-- Triagem: sintomas, alertas e restricoes davam texto livre que ninguem
-- preenchia de forma consistente. Entram campos objetivos: acuidade visual
-- por olho e duas condicoes que mudam a conduta do exame ocupacional.
--
-- Prioridade: numa clinica ocupacional quase todo atendimento e de
-- trabalhador em horario marcado. Marcar todos como prioritarios esvaziou
-- a funcao. O campo continua no banco, sempre 'normal', para poder ser
-- religado sem refazer nada.
-- =====================================================================

alter table public.triages
  add column if not exists acuidade_od     text,
  add column if not exists acuidade_oe     text,
  add column if not exists diabetes        boolean,
  add column if not exists hipertenso      boolean;

comment on column public.triages.acuidade_od is 'Acuidade visual do olho direito, como anotada na triagem (ex.: 20/20).';
comment on column public.triages.acuidade_oe is 'Acuidade visual do olho esquerdo.';
comment on column public.triages.diabetes    is 'Marcado na triagem; entra na ficha clinica e no laudo.';
comment on column public.triages.hipertenso  is 'Marcado na triagem; entra na ficha clinica e no laudo.';

-- Os campos antigos continuam existindo para nao perder historico ja
-- registrado, mas saem das telas.
comment on column public.triages.symptoms     is 'Descontinuado em 0017. Mantido apenas para consulta do historico.';
comment on column public.triages.alerts       is 'Descontinuado em 0017. Substituido por diabetes/hipertenso.';
comment on column public.triages.restrictions is 'Descontinuado em 0017. Substituido por diabetes/hipertenso.';
