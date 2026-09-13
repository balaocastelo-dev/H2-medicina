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

-- Conferencia: telefone fixo, WhatsApp e o estado na chave certa.
select
  settings ->> 'telefone_fixo' as telefone_fixo,
  settings ->> 'whatsapp'      as whatsapp,
  settings ->> 'estado'        as estado,
  settings ? 'uf'              as ainda_tem_a_chave_errada
from public.tenant_settings
where group_key = 'contato';
