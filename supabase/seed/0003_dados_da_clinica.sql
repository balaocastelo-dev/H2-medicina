-- =====================================================================
-- SEED 0003 - Dados cadastrais reais da clinica
--
-- "Documentos: todos os documentos gerados, dados da clinica estao
--  errados (cabecalho e rodape)"
--
-- O banco ainda tinha o endereco de exemplo (Praca da Se, Sao Paulo) que
-- veio do cadastro inicial, e era ele que saia impresso em todo A.S.O.,
-- atestado e comprovante.
--
-- Os dados corretos vieram do proprio modelo de ficha clinica da clinica
-- e das mensagens da recepcao.
--
-- A troca so acontece se o valor ainda for o de exemplo ou estiver vazio:
-- rodar de novo nao desfaz o que a clinica editar em Configuracoes.
-- =====================================================================

do $$
declare
  v_tenant uuid;
  v_contato jsonb;
begin
  select id into v_tenant from public.tenants where slug = 'h2';
  if v_tenant is null then
    raise notice 'Tenant h2 nao encontrado; nada a corrigir.';
    return;
  end if;

  select settings into v_contato
    from public.tenant_settings
   where tenant_id = v_tenant and group_key = 'contato';

  -- Endereco: so mexe se ainda for o exemplo ou estiver em branco.
  if v_contato is null
     or coalesce(v_contato->>'logradouro', '') in ('', 'Praça da Sé')
  then
    update public.tenant_settings
       set settings = settings || jsonb_build_object(
             'telefone',    '(19) 3235-3599',
             'whatsapp',    '(19) 99956-3599',
             'cep',         '13023-185',
             'logradouro',  'Rua Sacramento',
             'numero',      '908',
             'complemento', 'Próximo ao Clube Fonte São Paulo',
             'bairro',      'Vila Itapura',
             'cidade',      'Campinas',
             'estado',      'SP')
     where tenant_id = v_tenant and group_key = 'contato';

    -- O e-mail de exemplo era o da empresa que desenvolveu o sistema.
    update public.tenant_settings
       set settings = settings || jsonb_build_object('email', null)
     where tenant_id = v_tenant
       and group_key = 'contato'
       and settings->>'email' = 'contato@balaodainformatica.com.br';

    raise notice 'Endereco e telefones da clinica corrigidos.';
  else
    raise notice 'Endereco ja preenchido pela clinica; mantido como esta.';
  end if;

  -- Razao social e nome fantasia completos, como saem nos documentos.
  update public.tenants
     set legal_name = 'H2 MEDICINA OCUPACIONAL LTDA',
         trade_name = 'H2 Medicina Ocupacional e Segurança do Trabalho'
   where id = v_tenant and legal_name = 'H2 Medicina Ocupacional';

  update public.tenant_settings
     set settings = settings || jsonb_build_object(
           'razao_social',  'H2 MEDICINA OCUPACIONAL LTDA',
           'nome_fantasia', 'H2 MEDICINA OCUPACIONAL E SEGURANÇA DO TRABALHO')
   where tenant_id = v_tenant
     and group_key = 'empresa'
     and settings->>'razao_social' = 'H2 Medicina Ocupacional';

  -- Cabecalho e rodape dos PDFs, que estavam vazios.
  update public.tenant_settings
     set settings = settings || jsonb_build_object(
           'cabecalho', 'H2 MEDICINA OCUPACIONAL E SEGURANÇA DO TRABALHO',
           'rodape',    'Rua Sacramento, 908 - Vila Itapura - Campinas/SP - CEP 13023-185'
                        || ' - Tel. (19) 3235-3599 - WhatsApp (19) 99956-3599')
   where tenant_id = v_tenant
     and group_key = 'documentos'
     and coalesce(settings->>'cabecalho', '') = '';

  -- Responsavel tecnico: o registro estava sem numero.
  update public.tenant_settings
     set settings = settings || jsonb_build_object(
           'nome', 'Dra. Wania Sanches Picasso',
           'conselho', 'CRM', 'numero', '79775', 'uf', 'SP')
   where tenant_id = v_tenant
     and group_key = 'responsavel_tecnico'
     and coalesce(settings->>'numero', '') = '';
end$$;
