-- =====================================================================
-- 0047 - A consulta ocupacional ganha valor, e os repasses perdidos voltam
--
-- ---------------------------------------------------------------------
-- O contexto
-- ---------------------------------------------------------------------
-- A "Consulta ocupacional" estava com R$ 0,00 no catalogo de procedimentos
-- -- "os itens em zero aguardam o valor que ainda nao foi informado", diz o
-- proprio catalogo. Como ela e o procedimento de quase TODO atendimento, o
-- repasse de todos os medicos saia zerado.
--
-- Pior: o zero tambem impedia o conserto. A recuperacao de lancamentos da
-- 0041 so recria o que tem valor maior que zero, entao ela passou por cima
-- de todas as consultas ocupacionais ja assinadas.
--
-- E havia um segundo motivo, corrigido no codigo junto com esta migration:
-- `lancarRepasse` pedia `attendances.doctor_id`, coluna que so existe em
-- `medical_consultations`. O banco recusava a consulta inteira, o erro nao
-- era lido, e NENHUM repasse foi lancado desde que o sistema existe.
--
-- ---------------------------------------------------------------------
-- R$ 100,00 e um valor de PARTIDA
-- ---------------------------------------------------------------------
-- Nao e a tabela da clinica: e um numero para o sistema parar de contar
-- zero enquanto a clinica define o dela. Ajustavel em Financeiro >
-- Repasse, e o valor por medico (Usuarios > Repasse) continua ganhando
-- deste.
--
-- Por isso o update abaixo so toca em quem esta em ZERO: se alguem ja
-- informou um valor, ele fica.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================

update public.procedure_types
   set default_fee = 100
 where code = 'consulta_ocupacional'
   and coalesce(default_fee, 0) = 0;


-- ---------------------------------------------------------------------
-- Os lancamentos que nunca nasceram
--
-- Toda consulta assinada por um medico, sem lancamento de repasse. Agora
-- com valor, a recuperacao da 0041 finalmente alcanca as consultas
-- ocupacionais.
--
-- Sao contas a pagar de verdade: o medico atendeu e o sistema nao
-- registrou. Ficam marcadas na observacao, para a clinica saber de onde
-- vieram ao conferir o mes.
-- ---------------------------------------------------------------------
insert into public.fee_entries
  (tenant_id, profile_id, attendance_id, patient_id, company_id, procedure_type_id,
   procedure_code, procedure_name, fee, competencia, status, notes)
select mc.tenant_id,
       mc.doctor_id,
       mc.attendance_id,
       mc.patient_id,
       a.company_id,
       pt.id,
       pt.code,
       pt.name,
       coalesce(mf.fee, pt.default_fee),
       -- Mesma competencia que a aplicacao usa: o mes de ABERTURA do
       -- atendimento, em Sao Paulo. Usar outra regra aqui faria os
       -- lancamentos recuperados cairem em meses diferentes dos novos.
       date_trunc(
         'month',
         (a.checkin_at at time zone 'America/Sao_Paulo')
       )::date,
       'a_pagar',
       'Lancamento recuperado: a consulta foi assinada antes da correcao de 30/09.'
  from public.medical_consultations mc
  join public.attendances a on a.id = mc.attendance_id
  join public.procedure_types pt
    on pt.tenant_id = mc.tenant_id
   and pt.code = coalesce(a.procedure_code, 'consulta_ocupacional')
  left join public.medical_fees mf
    on mf.procedure_type_id = pt.id and mf.profile_id = mc.doctor_id
 where mc.finished_at is not null
   and mc.doctor_id is not null
   and coalesce(mf.fee, pt.default_fee) > 0
   -- O indice unico da tabela e por (atendimento, procedimento); a
   -- checagem segue o mesmo par, senao o insert aborta em vez de pular.
   and not exists (
     select 1 from public.fee_entries fe
      where fe.attendance_id = mc.attendance_id
        and fe.procedure_code = pt.code);


do $$
declare v_valor numeric; v_recuperados int; v_total int;
begin
  select default_fee into v_valor from public.procedure_types
   where code = 'consulta_ocupacional' limit 1;
  select count(*) into v_recuperados from public.fee_entries
   where notes like 'Lancamento recuperado%';
  select count(*) into v_total from public.fee_entries;
  raise notice 'Consulta ocupacional: R$ %; repasses recuperados: %; total de lancamentos: %',
    v_valor, v_recuperados, v_total;
end$$;
