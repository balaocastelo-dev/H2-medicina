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

-- Conferencia: preco e sala de cada exame, e o que ficou sem.
select
  et.code                        as codigo,
  et.name                        as exame,
  et.default_price               as preco,
  coalesce(r.name, '— sem sala') as sala
from public.exam_types et
left join public.rooms r on r.id = et.default_room_id
where et.is_active
  and et.deleted_at is null
order by (et.default_room_id is null), r.name, et.name;
