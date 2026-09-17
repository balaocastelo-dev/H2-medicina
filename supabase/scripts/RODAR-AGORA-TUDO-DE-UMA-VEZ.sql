-- =====================================================================
-- RODAR AGORA -- tudo o que falta no banco, de uma vez so
--
-- Cole isto inteiro no SQL Editor do Supabase (projeto da H2) e execute.
-- Nao apaga nada. Pode rodar mais de uma vez sem efeito colateral.
--
-- Reune, na ordem certa:
--   1. Valores por empresa e preco padrao do exame   (era o 8-VALORES)
--   2. Risco ocupacional no cadastro do paciente     (migration 0028)
--   3. Precos e sala de cada exame                   (era o 10-PRECOS)
--   4. Telefones e endereco corrigidos               (era o 9-CONTATO)
--
-- A ordem importa: o passo 3 precisa da coluna que o passo 1 cria.
--
-- NAO inclui o ZERAR-PARA-O-PRIMEIRO-DIA.sql. Aquele apaga dado de
-- paciente e fica separado de proposito -- rode depois, com backup feito.
--
-- No fim aparece uma tabela de conferencia. Leia a ultima consulta.
-- =====================================================================

-- =====================================================================
-- PASSO 1 de 4 -- Valores por empresa e preco padrao
-- =====================================================================

-- =====================================================================
-- Valor de cada exame negociado com a empresa
--
-- "cada empresa tem um valor para exame, entao vincular o valor ao
-- contrato da empresa" — o preco do mesmo exame muda de contrato para
-- contrato, e hoje a recepcao cobra de cabeca.
--
-- O valor fica na empresa, nao no contrato: o contrato vence e e renovado,
-- e o preco negociado sobrevive a renovacao. Quando um contrato precisar de
-- preco proprio, basta apontar contract_id.
-- =====================================================================

create table if not exists public.company_exam_prices (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  company_id    uuid not null references public.companies(id) on delete cascade,
  exam_type_id  uuid not null references public.exam_types(id) on delete cascade,
  -- Opcional: preco especifico de um contrato, quando houver mais de um.
  contract_id   uuid references public.company_contracts(id) on delete set null,
  price         numeric(12,2) not null check (price >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid,
  deleted_at    timestamptz
);

comment on table public.company_exam_prices is
  'Preco de cada exame negociado com a empresa. Sem linha aqui, vale o preco de tabela do exame.';

create unique index if not exists uq_exam_price_empresa
  on public.company_exam_prices (company_id, exam_type_id, coalesce(contract_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where deleted_at is null;

create index if not exists idx_exam_price_empresa
  on public.company_exam_prices (tenant_id, company_id) where deleted_at is null;

-- ---------------------------------------------------------------------
-- Preco de tabela do exame, usado quando a empresa nao negociou o seu
-- ---------------------------------------------------------------------
alter table public.exam_types
  add column if not exists default_price numeric(12,2) not null default 0;

comment on column public.exam_types.default_price is
  'Preco padrao do exame, usado para particular e para empresa sem valor negociado.';

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.company_exam_prices enable row level security;
alter table public.company_exam_prices force row level security;

drop policy if exists tenant_select on public.company_exam_prices;
drop policy if exists tenant_write  on public.company_exam_prices;

-- Quem atende precisa ver o preco para cobrar na recepcao.
create policy tenant_select on public.company_exam_prices for select to authenticated
  using (public.belongs_to_tenant(tenant_id));

create policy tenant_write on public.company_exam_prices for all to authenticated
  using (public.can_access(tenant_id, 'empresas.administrar'))
  with check (public.can_access(tenant_id, 'empresas.administrar'));

drop trigger if exists set_updated_at on public.company_exam_prices;
create trigger set_updated_at before update on public.company_exam_prices
  for each row execute function public.tg_set_updated_at();


-- =====================================================================
-- PASSO 2 de 4 -- Risco ocupacional do empregado
-- =====================================================================

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


-- =====================================================================
-- PASSO 3 de 4 -- Precos e sala de cada exame
-- =====================================================================

-- =====================================================================
-- Precos de tabela e sala de cada exame
--
-- Lista enviada pela clinica em 15/09/2026. Responde de uma vez duas
-- pendencias antigas: quanto custa cada exame, e em que sala ele e feito
-- -- que era a causa do "exame esperando sem sala" na tela de filas.
--
-- Raio X fica com preco zero de proposito: "Raio X apenas guia". Ele nao
-- e feito na clinica, entao nao entra em fila nem em sala; a recepcao
-- imprime a guia e o paciente leva ao laboratorio.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================

do $$
declare
  v_tenant uuid;
  v_faltando text;
begin
  select id into v_tenant from public.tenants order by created_at limit 1;
  if v_tenant is null then
    raise exception 'Nenhum tenant cadastrado.';
  end if;

  if to_regclass('public.exam_types') is null then
    raise exception 'Tabela exam_types nao existe.';
  end if;

  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='exam_types'
                   and column_name='default_price') then
    raise exception 'Coluna default_price nao existe. Rode antes o RODAR-NO-SUPABASE-8-VALORES.sql.';
  end if;

  -- -------------------------------------------------------------------
  -- Preco de tabela
  -- -------------------------------------------------------------------
  update public.exam_types et
     set default_price = v.preco,
         updated_at    = now()
    from (values
      ('AUDIO',       90.00),
      ('ECG',        110.00),
      ('EEG',        220.00),
      ('ESPIRO',     120.00),
      ('LAB',         80.00),
      ('CLINICO',    150.00),
      ('ACUIDADE',    45.00),
      ('ISHIHARA',    45.00),
      ('PSICO',       80.00),
      ('ROMBERG',     45.00),
      ('FADIGA',      45.00),
      ('DINAMO_PAL',  45.00),
      ('DINAMO_ESC',  45.00),
      ('DINAMO_LOM',  45.00),
      ('RAIOX',        0.00)
    ) as v(codigo, preco)
   where et.tenant_id = v_tenant
     and et.code = v.codigo;

  -- -------------------------------------------------------------------
  -- Sala padrao de cada exame
  --
  -- Sem isto o exame entra na fila sem pertencer a sala nenhuma: some de
  -- todos os cartoes da tela e o paciente fica esperando sem que ninguem
  -- consiga chama-lo. Foi o que a clinica viu em 13/09.
  --
  -- Consulta e psicossocial ficam sem sala aqui: sao atendidos nos
  -- consultorios (3, 8 e 9), pela fila do modulo medico, que e uma so.
  -- Raio X tambem fica sem sala: nao e feito aqui.
  -- -------------------------------------------------------------------
  update public.exam_types et
     set default_room_id = r.id,
         updated_at      = now()
    from (values
      ('AUDIO',       'Sala 6'),
      ('ECG',         'Sala 7'),
      ('EEG',         'Sala 4'),
      ('ESPIRO',      'Sala 7'),
      ('LAB',         'Sala 5'),
      ('ROMBERG',     'Sala 7'),
      ('DINAMO_PAL',  'Sala 7'),
      ('DINAMO_ESC',  'Sala 7'),
      ('DINAMO_LOM',  'Sala 7'),
      ('ACUIDADE',    'Sala 1'),
      ('ISHIHARA',    'Sala 1'),
      ('FADIGA',      'Sala 1')
    ) as v(codigo, sala)
    join public.rooms r
      on r.tenant_id = v_tenant
     and r.name like v.sala || '%'
     and r.is_active
     and r.deleted_at is null
   where et.tenant_id = v_tenant
     and et.code = v.codigo;

  -- -------------------------------------------------------------------
  -- Sala que nao existe com esse nome: avisa em vez de calar.
  --
  -- O casamento e por prefixo do nome ("Sala 6" pega "Sala 6 - Audiometria").
  -- Se a clinica renomear as salas, este UPDATE deixa de encontrar e nao
  -- altera nada -- silenciosamente. Entao a ausencia precisa aparecer.
  -- -------------------------------------------------------------------
  select string_agg(sala, ', ' order by sala) into v_faltando
    from (values
      ('Sala 1'),('Sala 4'),('Sala 5'),('Sala 6'),('Sala 7')
    ) as esperadas(sala)
   where not exists (
     select 1 from public.rooms r
      where r.tenant_id = v_tenant
        and r.name like esperadas.sala || '%'
        and r.is_active and r.deleted_at is null
   );

  if v_faltando is not null then
    raise notice 'ATENCAO: nao encontrei estas salas: %', v_faltando;
    raise notice 'Os exames delas ficaram SEM SALA e nao vao aparecer em nenhuma fila.';
    raise notice 'Confira os nomes na tela de Configuracoes > Salas.';
  end if;

  -- -------------------------------------------------------------------
  -- Avisa o exame que nao foi encontrado, em vez de fingir que deu certo
  -- -------------------------------------------------------------------
  select string_agg(codigo, ', ' order by codigo) into v_faltando
    from (values
      ('AUDIO'),('ECG'),('EEG'),('ESPIRO'),('LAB'),('CLINICO'),('ACUIDADE'),
      ('ISHIHARA'),('PSICO'),('ROMBERG'),('FADIGA'),
      ('DINAMO_PAL'),('DINAMO_ESC'),('DINAMO_LOM'),('RAIOX')
    ) as esperados(codigo)
   where not exists (
     select 1 from public.exam_types et
      where et.tenant_id = v_tenant and et.code = esperados.codigo
   );

  if v_faltando is not null then
    raise notice 'Exames da lista que NAO existem no catalogo: %', v_faltando;
    raise notice 'Confira o codigo deles na tela de Configuracoes.';
  end if;

  raise notice 'Precos e salas atualizados.';
end$$;


-- =====================================================================
-- PASSO 4 de 4 -- Telefones e endereco
-- =====================================================================

-- =====================================================================
-- Contato da clinica -- correcao de 13/09/2026
--
-- Respostas da Isabella (clinica H2) em 13/09:
--   "pode seguir com os numero que a magali enviou, sao do financeiro"
--   -> telefone fixo (19) 3235-3599, WhatsApp (19) 99935-3599.
--
-- Corrige tambem um erro do script anterior (o -6-DADOS-DA-CLINICA):
-- o estado foi gravado na chave `uf`, mas a tela de Configuracoes e os
-- documentos leem `estado`. Na pratica o endereco saia impresso sem o
-- "SP" -- em A.S.O., laudo, contrato e comprovante.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================

do $$
declare
  v_tenant uuid;
  v_contato jsonb;
begin
  select id into v_tenant from public.tenants order by created_at limit 1;
  if v_tenant is null then
    raise exception 'Nenhum tenant cadastrado.';
  end if;

  -- -------------------------------------------------------------------
  -- Telefones e endereco
  --
  -- `telefone_fixo` existe porque o comprovante de agendamento prefere o
  -- fixo quando ha um: e o numero que o paciente liga para remarcar.
  -- -------------------------------------------------------------------
  insert into public.tenant_settings (tenant_id, group_key, settings)
  values (
    v_tenant,
    'contato',
    jsonb_build_object(
      'telefone',      '(19) 3235-3599',
      'telefone_fixo', '(19) 3235-3599',
      'whatsapp',      '(19) 99935-3599',
      'logradouro',    'R. Sacramento',
      'numero',        '908',
      'bairro',        'Vila Itapura',
      'cidade',        'Campinas',
      'estado',        'SP',
      'cep',           '13010210'
    )
  )
  on conflict (tenant_id, group_key) do update
    set settings = public.tenant_settings.settings || excluded.settings;

  -- A chave errada sai de cena depois que `estado` esta gravado, para nao
  -- deixar duas verdades no mesmo lugar.
  select settings into v_contato
    from public.tenant_settings
   where tenant_id = v_tenant and group_key = 'contato';

  if v_contato ? 'estado' and v_contato ? 'uf' then
    update public.tenant_settings
       set settings = settings - 'uf'
     where tenant_id = v_tenant and group_key = 'contato';
  end if;

  -- -------------------------------------------------------------------
  -- Rodape dos PDFs, com o telefone certo
  -- -------------------------------------------------------------------
  insert into public.tenant_settings (tenant_id, group_key, settings)
  values (
    v_tenant,
    'documentos',
    jsonb_build_object(
      'rodape',
      'H2 Medicina Ocupacional Ltda · CNPJ 52.830.198/0001-34 · ' ||
      'R. Sacramento, 908 — Vila Itapura, Campinas/SP · CEP 13010-210 · ' ||
      'Tel. (19) 3235-3599 · WhatsApp (19) 99935-3599'
    )
  )
  on conflict (tenant_id, group_key) do update
    set settings = public.tenant_settings.settings || excluded.settings;

  -- -------------------------------------------------------------------
  -- Remove a configuracao `guia_exame` gravada em 13/09.
  --
  -- Ela guardava o endereco do laboratorio (Rua Tiradentes, 164), mas
  -- nenhuma tela e nenhum documento le essa chave -- nao existe guia de
  -- exame com endereco no sistema. Configuracao que ninguem le so serve
  -- para alguem acreditar que o assunto foi resolvido.
  --
  -- O endereco do laboratorio esta registrado nas pendencias e volta
  -- quando a guia de exame externo for construida.
  -- -------------------------------------------------------------------
  delete from public.tenant_settings
   where tenant_id = v_tenant and group_key = 'guia_exame';

  raise notice 'Contato da clinica corrigido.';
end$$;

-- =====================================================================
-- CONFERENCIA FINAL -- leia esta tabela
--
-- Tudo "OK" = pode usar. Qualquer "FALTA" me avise.
-- =====================================================================

with checagem as (
  select 1 as ordem, 'Tabela de valores por empresa' as item,
         to_regclass('public.company_exam_prices') is not null as ok
  union all
  select 2, 'Preco padrao no exame',
         exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='exam_types'
                   and column_name='default_price')
  union all
  select 3, 'Campo de risco no paciente',
         exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='patients'
                   and column_name='occupational_risks')
  union all
  select 4, 'Precos preenchidos (15 exames)',
         (select count(*) from public.exam_types
           where default_price > 0 and deleted_at is null) >= 14
  union all
  select 5, 'Exames com sala definida',
         (select count(*) from public.exam_types
           where default_room_id is not null and is_active and deleted_at is null) >= 12
  union all
  select 6, 'Telefone fixo da clinica',
         exists (select 1 from public.tenant_settings
                 where group_key='contato'
                   and settings ->> 'telefone_fixo' = '(19) 3235-3599')
  union all
  select 7, 'Estado gravado na chave certa',
         exists (select 1 from public.tenant_settings
                 where group_key='contato' and settings ? 'estado')
         and not exists (select 1 from public.tenant_settings
                 where group_key='contato' and settings ? 'uf')
)
select case when ok then 'OK' else 'FALTA' end as situacao, item
from checagem order by ok, ordem;