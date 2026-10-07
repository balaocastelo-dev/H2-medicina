-- ===========================================================================
-- 0055 — A triagem aceita o valor que foi medido
-- ===========================================================================
--
--     06/10/2026 08:35 - Isa: sabe aqueles limites de valores da triagem?
--                             precisa tirar esses limites
--
-- Os limites estavam em TRES camadas, e tirar so a de cima (o zod da tela)
-- trocaria a mensagem no campo por um erro cru do Postgres — pior do que
-- antes. As tres:
--
--   1. validators.ts, no formulario           -> tirado no mesmo commit
--   2. `triages_bp_sane` e `triages_saturation_sane`, constraints de CHECK
--   3. a precisao das colunas: `numeric(4,1)` recusa temperatura >= 1000,
--      `numeric(5,2)` recusa IMC >= 1000
--
-- A triagem ANOTA o que o aparelho mostrou; ela nao julga o valor. PA de
-- 310, SpO2 de 25, peso de 420 kg: recusar isso nao protege ninguem, so
-- empurra o numero para o campo de observacoes, onde o medico nao procura e
-- o laudo nao le. Quem julga o valor e o medico, na tela dele, com o numero
-- na frente.
--
-- O que fica de limite e so o que o banco precisa para nao estourar: as
-- colunas ganham folga e o IMC derivado passa a ser nulo — em vez de
-- estourar a coluna — quando o par peso/altura nao fecha em kg e cm (altura
-- digitada em metros, por exemplo: 1,75 daria IMC 254.693).
--
-- Idempotente: pode rodar duas vezes.
-- ===========================================================================

-- 1. As constraints de faixa saem ------------------------------------------
alter table public.triages drop constraint if exists triages_bp_sane;
alter table public.triages drop constraint if exists triages_saturation_sane;

-- 2. O IMC derivado para de estourar a coluna ------------------------------
--
-- `calc_bmi` e usada so pela coluna gerada `triages.bmi`. Acima de 9999.99 o
-- resultado nao e um IMC de ninguem: e sinal de que a altura nao veio em
-- centimetros. Guardar nulo preserva o peso e a altura exatamente como foram
-- digitados e deixa a tela mostrar "—" no IMC, em vez de recusar a triagem
-- inteira por causa de um campo derivado.
create or replace function public.calc_bmi(weight_kg numeric, height_cm numeric)
returns numeric
language sql
immutable
as $$
  select case
    when weight_kg is null or height_cm is null or height_cm <= 0 then null
    when round(weight_kg / power(height_cm / 100.0, 2), 2) > 9999.99 then null
    else round(weight_kg / power(height_cm / 100.0, 2), 2)
  end;
$$;

-- 3. As colunas ganham folga -----------------------------------------------
--
-- A coluna gerada `bmi` depende de peso e altura, e o Postgres nao deixa
-- alterar o tipo das colunas de origem enquanto ela existe. Como `bmi` e
-- derivada, derrubar e recriar nao perde dado nenhum: ela e recalculada a
-- partir das linhas que ja estao gravadas.
alter table public.triages drop column if exists bmi;

alter table public.triages
  alter column temperature_c type numeric(9,1),
  alter column weight_kg     type numeric(9,2),
  alter column height_cm     type numeric(9,1),
  alter column glucose       type numeric(9,2);

alter table public.triages
  add column if not exists bmi numeric(9,2)
  generated always as (public.calc_bmi(weight_kg, height_cm)) stored;
