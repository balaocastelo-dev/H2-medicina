-- =====================================================================
-- Paciente de teste: Thiago Gabriel
--
-- Cole no SQL Editor do projeto da H2 e clique em RUN.
-- Pode rodar mais de uma vez: se ja existir, ele so atualiza os dados.
--
-- No fim, a consulta mostra o que ficou gravado.
-- =====================================================================

-- ---------------------------------------------------------------------
-- EDITE AQUI, se quiser
--
-- `nascimento` importa de verdade: e a senha do portal do paciente. Para
-- entrar em /meu voce digita o CPF e ESTA data. Troque pela sua real antes
-- de rodar, senao o teste do portal vai usar a data de mentira abaixo.
-- ---------------------------------------------------------------------
do $$
declare
  v_nome       text := 'Thiago Gabriel';
  v_cpf        text := '22804243800';
  v_nascimento date := date '1990-01-15';   -- <<< TROQUE PELA SUA
  v_telefone   text := null;                -- opcional: '14999999999'
  v_cargo      text := 'Teste do sistema';
  v_tenant     uuid;
  v_id         uuid;
begin
  -- A clinica. Se houver mais de uma no banco, pega a do slug configurado.
  select id into v_tenant from public.tenants
   where slug = coalesce(current_setting('app.tenant_slug', true), 'h2')
   limit 1;
  if v_tenant is null then
    select id into v_tenant from public.tenants order by created_at limit 1;
  end if;
  if v_tenant is null then
    raise exception 'Nenhuma clinica cadastrada neste banco.';
  end if;

  insert into public.patients
    (tenant_id, full_name, cpf, birth_date, phone, whatsapp, job_title, gender, origin, notes)
  values
    (v_tenant, v_nome, v_cpf, v_nascimento, v_telefone, v_telefone, v_cargo,
     'nao_informado', 'manual',
     'Paciente de teste do sistema — pode ser apagado depois.')
  on conflict (tenant_id, cpf) do update
     set full_name  = excluded.full_name,
         birth_date = excluded.birth_date,
         phone      = coalesce(excluded.phone, public.patients.phone),
         whatsapp   = coalesce(excluded.whatsapp, public.patients.whatsapp),
         job_title  = excluded.job_title,
         deleted_at = null,
         updated_at = now()
  returning id into v_id;

  raise notice 'Paciente pronto: % (id %)', v_nome, v_id;
end$$;


-- Confere o que ficou gravado.
select p.full_name          as nome,
       p.cpf,
       p.birth_date         as nascimento_para_o_portal,
       p.phone              as telefone,
       c.trade_name         as empresa,
       t.trade_name         as clinica
  from public.patients p
  join public.tenants t on t.id = p.tenant_id
  left join public.companies c on c.id = p.company_id
 where p.cpf = '22804243800'
   and p.deleted_at is null;
