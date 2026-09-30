-- =====================================================================
-- 0049 - Dois totens ao mesmo tempo param de perder o check-in
--
-- ---------------------------------------------------------------------
-- O defeito
-- ---------------------------------------------------------------------
-- `next_ticket_sequence` fazia:
--
--     select coalesce(max(sequence), 0) + 1 from queue_tickets where ...
--
-- Sem lock. Dois check-ins no mesmo instante — dois totens, ou totem e
-- recepcao juntos — leem o mesmo `max` e devolvem a MESMA senha. A tabela
-- tem `unique (tenant_id, service_date, prefix, sequence)`, entao o
-- segundo insert viola a unica DENTRO de `checkin_patient`.
--
-- E como a excecao nao era tratada, a transacao inteira voltava atras: o
-- atendimento que acabara de ser criado desaparecia junto com a senha. O
-- paciente ve "erro" no totem e volta para a fila do balcao. Nas manhas de
-- movimento, que e quando dois totens sao usados ao mesmo tempo, e
-- exatamente quando falha.
--
-- ---------------------------------------------------------------------
-- A correcao: lock consultivo por fila do dia
-- ---------------------------------------------------------------------
-- `pg_advisory_xact_lock` serializa apenas quem esta tirando senha da
-- MESMA fila do MESMO dia da MESMA clinica. Quem tira senha de outra fila
-- nao espera nada, e o lock cai sozinho no fim da transacao — nao ha o que
-- vazar se algo falhar no meio.
--
-- Nao virou `sequence` do Postgres porque a numeracao reinicia todo dia e
-- e por prefixo: seriam N sequences por dia, criadas em tempo de execucao.
--
-- Pode ser executada mais de uma vez sem efeito colateral.
-- =====================================================================

create or replace function public.next_ticket_sequence(p_tenant uuid, p_date date, p_prefix text)
returns int
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare nxt int;
begin
  -- Uma chave por (clinica, dia, prefixo). `hashtextextended` devolve
  -- bigint, que e o que a versao de um argumento do lock aceita.
  perform pg_advisory_xact_lock(
    hashtextextended(p_tenant::text || '|' || p_date::text || '|' || coalesce(p_prefix, ''), 0)
  );

  select coalesce(max(sequence), 0) + 1 into nxt
  from public.queue_tickets
  where tenant_id = p_tenant and service_date = p_date and prefix = p_prefix;

  return nxt;
end$$;

comment on function public.next_ticket_sequence(uuid, date, text) is
  'Proxima senha do dia para a fila. Serializa por (clinica, dia, prefixo) com lock consultivo: dois totens simultaneos nao tiram a mesma senha.';


-- ---------------------------------------------------------------------
-- Por que o lock basta, e nao ha retry
-- ---------------------------------------------------------------------
-- `checkin_patient` e a UNICA coisa em todo o sistema que insere senha
-- (verificado: um `insert into queue_tickets` no repo, na 0013). Ela roda
-- como uma chamada, logo uma transacao.
--
-- Com o lock tomado dentro de `next_ticket_sequence` e mantido ate o fim
-- da transacao, o segundo check-in espera o primeiro COMMITAR antes de
-- calcular o `max` — e ai ja ve a senha do primeiro. A colisao nao
-- acontece, entao nao ha o que repetir.
--
-- Escrever um retry aqui seria codigo que nunca executa. Se algum dia
-- outro caminho passar a inserir senha, ele tem de chamar esta funcao.
-- ---------------------------------------------------------------------
