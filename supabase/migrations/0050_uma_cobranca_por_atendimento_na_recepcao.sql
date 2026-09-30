-- =====================================================================
-- 0050 - Duas recepcionistas param de cobrar o mesmo atendimento duas vezes
--
-- ---------------------------------------------------------------------
-- O defeito
-- ---------------------------------------------------------------------
-- `gerarCobrancaRecepcao` evita cobranca dupla LENDO antes de escrever:
-- procura uma cobranca pendente do atendimento e reaproveita. Leitura
-- seguida de escrita, sem trava nenhuma.
--
-- Duas recepcionistas na mesma ficha — ou dois cliques rapidos no mesmo
-- botao — leem "nao existe" ao mesmo tempo e as duas inserem. O atendimento
-- fica com dois Pix abertos, e a receita aparece DOBRADA no fluxo de caixa,
-- no relatorio do contador e no painel.
--
-- `payments` nao tinha nenhum indice unico. O de-dupe existia so em codigo,
-- e codigo nao resolve corrida.
--
-- ---------------------------------------------------------------------
-- Por que o indice e parcial, e nao em (tenant_id, attendance_id)
-- ---------------------------------------------------------------------
-- Uma cobranca unica por atendimento seria errado: a tela de Financeiro
-- deixa a clinica lancar uma cobranca a mais no mesmo atendimento de
-- proposito (exame incluido depois, acerto de diferenca), e um indice
-- amplo passaria a recusar isso com erro de banco.
--
-- Entao o indice cobre exatamente o que a corrida produz: a cobranca que a
-- RECEPCAO gera (`provider = 'pix_manual'`), enquanto esta em aberto. Duas
-- dessas ao mesmo tempo nunca sao intencionais — o proprio codigo cancela
-- a anterior quando o valor muda. Cobranca paga, cancelada ou estornada sai
-- do indice, e a recepcao pode gerar a proxima.
--
-- Pode ser executada mais de uma vez sem efeito colateral.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Antes do indice, limpar o que a corrida ja deixou: cobrancas abertas
-- repetidas do mesmo atendimento. Fica a mais antiga (e a que tem o Pix
-- que o paciente pode ter recebido); as outras sao canceladas.
--
-- Sem esta limpeza a criacao do indice falharia em qualquer banco que ja
-- tenha sofrido o defeito.
--
-- `payment_transactions` NAO recebe linha aqui, e e de proposito: estas
-- cobrancas nunca existiram como cobranca de verdade — sao o mesmo valor
-- lancado duas vezes pela corrida entre duas telas. Registrar um
-- "cancelamento" de cada uma no livro sugeriria movimento que nao houve. A
-- procedencia delas esta neste arquivo, e a `raise notice` do fim diz
-- quantas foram.
-- ---------------------------------------------------------------------
with repetidas as (
  select id,
         row_number() over (
           partition by tenant_id, attendance_id
           order by created_at
         ) as ordem
    from public.payments
   where attendance_id is not null
     and provider = 'pix_manual'
     and status in ('pendente', 'em_analise')
     and deleted_at is null
)
update public.payments p
   set status = 'cancelado',
       cancelled_at = now()
  from repetidas r
 where p.id = r.id
   and r.ordem > 1;

create unique index if not exists uq_cobranca_aberta_da_recepcao
  on public.payments (tenant_id, attendance_id)
  where attendance_id is not null
    and provider = 'pix_manual'
    and status in ('pendente', 'em_analise')
    and deleted_at is null;

comment on index public.uq_cobranca_aberta_da_recepcao is
  'Uma cobranca da recepcao em aberto por atendimento. Impede a cobranca dupla quando duas telas geram ao mesmo tempo.';


do $$
declare v_canceladas int;
begin
  select count(*) into v_canceladas
    from public.payments
   where cancelled_at is not null and provider = 'pix_manual';
  raise notice 'Cobrancas da recepcao canceladas (inclui as duplicadas recolhidas agora): %', v_canceladas;
end$$;
