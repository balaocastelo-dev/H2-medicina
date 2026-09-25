-- =====================================================================
-- 0040 - Aptidao para trabalho em altura e com eletricidade
--
-- "no parecer do aso precisa incluir as opcs 'Apto para trabalho em
--  altura', 'Apto para trabalho com Eletricidade', entao precisa incluir
--  essas opcoes na caixa que o medico seleciona o parecer no modulo
--  medico"
--                                              -- Isabella, 23/09
--
-- Sao campos SEPARADOS da conclusao de aptidao, e nao mais duas opcoes da
-- mesma lista. O motivo e clinico: NR-35 (altura) e NR-10 (eletricidade)
-- sao aptidoes ADICIONAIS. Um trabalhador e apto para a funcao E, alem
-- disso, liberado para altura. Se virassem alternativas na mesma caixa, o
-- A.S.O. de quem trabalha em altura deixaria de dizer se a pessoa esta
-- apta para o proprio cargo -- que e a razao de o documento existir.
--
-- Nao marcado nao imprime nada, como hoje.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================

alter table public.medical_consultations
  add column if not exists apto_altura boolean not null default false,
  add column if not exists apto_eletricidade boolean not null default false;

comment on column public.medical_consultations.apto_altura is
  'Liberado para trabalho em altura (NR-35). Sai como linha marcada no parecer do A.S.O.';
comment on column public.medical_consultations.apto_eletricidade is
  'Liberado para trabalho com eletricidade (NR-10). Sai como linha marcada no parecer do A.S.O.';
