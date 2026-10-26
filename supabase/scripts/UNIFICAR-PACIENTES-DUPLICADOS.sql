-- =====================================================================
-- Unificar os pacientes duplicados pela lista do eSisla
--
-- "vi agora que ele ainda esta duplicando os pacientes quando cadastra de
--  forma automatica" -- Isa, 26/10.
--
-- PRE-REQUISITO: a migration 0056 (merge_patients_core e chave_nome).
--
-- Como usar, no SQL Editor do projeto da H2:
--   1. Rode so a PARTE 1. Ela lista o que seria unificado e o que fica
--      para a recepcao decidir. Nada muda no banco.
--   2. Conferiu? Rode a PARTE 2. Ela unifica os grupos seguros e mostra o
--      resultado.
--
-- Um grupo e "seguro" quando TODAS estas condicoes valem:
--   * mesmo nome (sem acento, sem caixa, sem pontuacao) com 3 palavras ou
--     mais -- nome curto e comum demais para juntar sem olhar;
--   * pelo menos um dos cadastros esta sem CPF (o caso do eSisla);
--   * no maximo UM CPF distinto no grupo;
--   * no maximo UMA data de nascimento distinta;
--   * no maximo UMA matricula distinta.
-- Fica o cadastro com CPF; sem CPF em nenhum, o que tem mais atendimentos;
-- empatou, o mais antigo.
--
-- O resto (CPFs ou datas que nao batem, nome curto) aparece na PARTE 1
-- como "conferir", para a recepcao resolver em Pacientes -> Unificar.
-- =====================================================================


-- =====================================================================
-- PARTE 1 — PREVIA (nao altera nada)
-- =====================================================================
with base as (
  select p.id, p.tenant_id, p.full_name, p.cpf, p.birth_date, p.registration_number,
         p.created_at, public.chave_nome(p.full_name) as chave,
         (select count(*) from public.attendances a where a.patient_id = p.id) as atendimentos
    from public.patients p
   where p.deleted_at is null
),
grupos as (
  select tenant_id, chave,
         count(*)                               as cadastros,
         count(*) filter (where cpf is null)    as sem_cpf,
         count(distinct cpf)                    as cpfs,
         count(distinct birth_date)             as nascimentos,
         count(distinct registration_number)    as matriculas,
         array_length(regexp_split_to_array(chave, ' '), 1) as palavras
    from base
   where chave <> ''
   group by tenant_id, chave
  having count(*) > 1 and count(*) filter (where cpf is null) > 0
)
select g.chave as nome,
       g.cadastros,
       case when g.palavras >= 3 and g.cpfs <= 1 and g.nascimentos <= 1 and g.matriculas <= 1
            then 'unificar' else 'conferir' end as decisao,
       case when g.palavras < 3 then 'nome curto'
            when g.cpfs > 1 then 'CPFs diferentes'
            when g.nascimentos > 1 then 'nascimentos diferentes'
            when g.matriculas > 1 then 'matriculas diferentes'
       end as motivo,
       string_agg(
         format('%s (%s, cadastro %s, %s atend.)', b.full_name, coalesce(b.cpf, 'sem CPF'),
                to_char(b.created_at, 'DD/MM/YYYY'), b.atendimentos),
         ' | ' order by b.cpf nulls last, b.atendimentos desc, b.created_at) as cadastros_do_grupo
  from grupos g
  join base b on b.tenant_id = g.tenant_id and b.chave = g.chave
 group by g.tenant_id, g.chave, g.cadastros, g.palavras, g.cpfs, g.nascimentos, g.matriculas
 order by decisao desc, g.chave;


-- =====================================================================
-- PARTE 2 — UNIFICAR OS GRUPOS SEGUROS
-- (rode depois de conferir a PARTE 1)
-- =====================================================================
/*
do $$
declare
  v_grupo record;
  v_destino uuid;
  v_origem record;
  v_unificados int := 0;
  v_falhas int := 0;
begin
  for v_grupo in
    select tenant_id, public.chave_nome(full_name) as chave
      from public.patients
     where deleted_at is null and public.chave_nome(full_name) <> ''
     group by tenant_id, public.chave_nome(full_name)
    having count(*) > 1
       and count(*) filter (where cpf is null) > 0
       and count(distinct cpf) <= 1
       and count(distinct birth_date) <= 1
       and count(distinct registration_number) <= 1
       and array_length(regexp_split_to_array(public.chave_nome(full_name), ' '), 1) >= 3
  loop
    select p.id into v_destino
      from public.patients p
     where p.tenant_id = v_grupo.tenant_id and p.deleted_at is null
       and public.chave_nome(p.full_name) = v_grupo.chave
     order by (p.cpf is null),
              (select count(*) from public.attendances a where a.patient_id = p.id) desc,
              p.created_at
     limit 1;

    for v_origem in
      select p.id, p.full_name from public.patients p
       where p.tenant_id = v_grupo.tenant_id and p.deleted_at is null
         and public.chave_nome(p.full_name) = v_grupo.chave
         and p.id <> v_destino
    loop
      begin
        perform public.merge_patients_core(v_origem.id, v_destino);
        v_unificados := v_unificados + 1;
      exception when others then
        v_falhas := v_falhas + 1;
        raise notice 'Nao unificou % : %', v_origem.full_name, sqlerrm;
      end;
    end loop;
  end loop;

  raise notice 'Cadastros unificados: %. Falhas: %.', v_unificados, v_falhas;
end$$;

-- Confere: o que ainda sobrou com o selo "revisar".
select full_name, cpf, review_reason, to_char(created_at, 'DD/MM/YYYY') as cadastro
  from public.patients
 where deleted_at is null and needs_review
 order by full_name;
*/
