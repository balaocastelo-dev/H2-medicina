-- =====================================================================
-- 0054 - O indice da recepcao para de barrar a cobranca do Financeiro
--
-- ---------------------------------------------------------------------
-- O defeito, que era meu e desta noite
-- ---------------------------------------------------------------------
-- A 0050 criou um indice unico para impedir a cobranca dupla que duas
-- recepcionistas produziam. Ela escolheu `provider = 'pix_manual'` como
-- marca da cobranca da recepcao, e escreveu, no proprio comentario, que o
-- indice tinha de ser parcial para NAO barrar a cobranca a mais que a tela
-- de Financeiro lanca de proposito (exame incluido depois, acerto de
-- diferenca).
--
-- Só que a cobranca do Financeiro grava o MESMO provider:
--
--     createCharge:  provider: method === 'pix' ? 'pix_manual' : 'manual'
--
-- Entao o indice barrava exatamente o caso que ele dizia preservar, com o
-- erro 23505 chegando na tela como "Registro duplicado." — sem nenhuma
-- pista de que era o Pix da recepcao que estava no caminho.
--
-- ---------------------------------------------------------------------
-- A correcao: dizer o que a coisa e, em vez de adivinhar pelo provedor
-- ---------------------------------------------------------------------
-- `provider` responde "por onde o dinheiro entra"; nao serve para responder
-- "quem gerou esta cobranca". A coluna nova responde a segunda pergunta, e
-- e ela que o indice passa a usar.
--
-- Cobranca antiga fica com `false` e sai do indice. Sao cobrancas ja
-- resolvidas, e a 0050 ja recolheu as duplicadas que existiam.
--
-- Pode ser executada mais de uma vez sem efeito colateral.
-- =====================================================================

alter table public.payments
  add column if not exists gerada_na_recepcao boolean not null default false;

comment on column public.payments.gerada_na_recepcao is
  'Verdadeiro para a cobranca que a tela da recepcao gera ao liberar o paciente. O indice unico de cobranca em aberto olha esta coluna, e nao o provedor: a cobranca extra lancada no Financeiro usa o mesmo provedor e nao pode ser barrada.';


-- ---------------------------------------------------------------------
-- Retroage no que a recepcao gerou antes desta coluna existir.
--
-- Criterio conservador: cobranca em aberto, do provedor que a recepcao
-- usava, com descricao no formato que so ela escreve ("Exames: ..."). Errar
-- para menos aqui e seguro — cobranca que ficar de fora do indice apenas
-- deixa de ter a protecao, sem barrar nada.
-- ---------------------------------------------------------------------
update public.payments
   set gerada_na_recepcao = true
 where gerada_na_recepcao = false
   and attendance_id is not null
   and provider = 'pix_manual'
   and description like 'Exames:%'
   and status in ('pendente', 'em_analise')
   and deleted_at is null;


drop index if exists public.uq_cobranca_aberta_da_recepcao;

create unique index if not exists uq_cobranca_aberta_da_recepcao
  on public.payments (tenant_id, attendance_id)
  where attendance_id is not null
    and gerada_na_recepcao
    and status in ('pendente', 'em_analise')
    and deleted_at is null;

comment on index public.uq_cobranca_aberta_da_recepcao is
  'Uma cobranca DA RECEPCAO em aberto por atendimento. Impede a cobranca dupla quando duas telas geram ao mesmo tempo, e nao alcanca a cobranca lancada no Financeiro.';


do $$
declare v_marcadas int;
begin
  select count(*) into v_marcadas from public.payments where gerada_na_recepcao;
  raise notice 'Cobrancas marcadas como geradas na recepcao: %', v_marcadas;
end$$;
