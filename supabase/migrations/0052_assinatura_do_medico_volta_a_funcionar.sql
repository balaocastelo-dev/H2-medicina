-- =====================================================================
-- 0052 - O medico volta a conseguir guardar e usar a propria assinatura
--
-- ---------------------------------------------------------------------
-- O defeito
-- ---------------------------------------------------------------------
-- A politica do bucket `signatures` da 0014 tem o comentario:
--
--     "Assinaturas: somente admin de usuarios e o proprio profissional"
--
-- ...e implementa so a primeira metade. A condicao e
-- `can_access(..., 'usuarios.administrar')` nas duas direcoes, e o papel
-- `medico_examinador` NAO tem essa permissao — ela e de administracao de
-- usuarios, e o medico nao administra usuario nenhum.
--
-- Resultado em cadeia:
--
--   1. GRAVAR: o medico abre o perfil, desenha a assinatura, salva. O
--      upload e recusado pela RLS e ele ve um erro de storage sem
--      explicacao.
--
--   2. LER: pior, porque e silencioso. `carregarSignatario` chama
--      `createSignedUrl` com o cliente do USUARIO. A RLS recusa, a
--      chamada devolve `{ data: null, error }` sem lancar excecao, e o
--      codigo so testa `if (data?.signedUrl)`. O A.S.O. sai com "Assinado
--      eletronicamente" e uma linha em branco.
--
-- Ou seja: a captura da assinatura de cada medico, que a clinica pediu e
-- que existe implementada na tela, nunca funcionou em producao — e o
-- documento saia sem assinatura sem avisar ninguem.
--
-- ---------------------------------------------------------------------
-- A politica nova, nas tres frentes
-- ---------------------------------------------------------------------
-- O caminho do arquivo e `<tenant>/profissionais/<user_id>.png`
-- (`medicos-actions.ts`), entao da para reconhecer o dono pelo nome.
--
--   ESCREVER e APAGAR -> o proprio dono, ou quem administra usuarios
--                        (para o caso do medico que nao usa o sistema e
--                        entrega a assinatura digitalizada no balcao).
--
--   LER -> os dois acima, mais quem emite documento.
--
-- A leitura e mais larga de proposito: quem emite o A.S.O. pela aba
-- Documentos e muitas vezes a recepcao, e sem poder ler a imagem ela
-- emitiria o documento do medico sem a assinatura dele. Vale registrar o
-- que isso significa: quem emite documento consegue baixar a imagem da
-- assinatura dos profissionais da propria clinica. E a mesma confianca
-- que a clinica ja deposita em quem imprime e entrega o A.S.O. assinado —
-- e, por isso mesmo, a imagem nao substitui assinatura digital ICP-Brasil
-- para fins do CFM 2.299/2021.
--
-- Pode ser executada mais de uma vez sem efeito colateral.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Dono do arquivo de assinatura.
--
-- `storage.foldername(name)` devolve as pastas; o arquivo e
-- `<tenant>/profissionais/<uuid>.png`, entao o dono esta no nome do
-- arquivo, nao na pasta. Funcao propria para a politica ficar legivel e
-- para o formato do caminho viver em UM lugar.
-- ---------------------------------------------------------------------
create or replace function public.assinatura_e_minha(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
     and p_name = public.current_tenant_id()::text
              || '/profissionais/'
              || auth.uid()::text
              || '.png';
$$;

comment on function public.assinatura_e_minha(text) is
  'Verdadeiro quando o caminho no bucket signatures e o arquivo de assinatura do proprio usuario logado.';


drop policy if exists wl_signatures on storage.objects;
drop policy if exists wl_signatures_ler on storage.objects;
drop policy if exists wl_signatures_gravar on storage.objects;
drop policy if exists wl_signatures_trocar on storage.objects;
drop policy if exists wl_signatures_apagar on storage.objects;

-- Ler: o dono, quem administra usuarios, ou quem emite documento.
create policy wl_signatures_ler on storage.objects for select to authenticated
  using (
    bucket_id = 'signatures'
    and (
      public.assinatura_e_minha(name)
      or public.can_access(public.storage_tenant(name), 'usuarios.administrar')
      or public.can_access(public.storage_tenant(name), 'documentos.emitir')
    )
  );

-- Gravar: so o dono ou quem administra usuarios.
create policy wl_signatures_gravar on storage.objects for insert to authenticated
  with check (
    bucket_id = 'signatures'
    and (
      public.assinatura_e_minha(name)
      or public.can_access(public.storage_tenant(name), 'usuarios.administrar')
    )
  );

-- Trocar (o upsert da tela de perfil passa por aqui).
create policy wl_signatures_trocar on storage.objects for update to authenticated
  using (
    bucket_id = 'signatures'
    and (
      public.assinatura_e_minha(name)
      or public.can_access(public.storage_tenant(name), 'usuarios.administrar')
    )
  )
  with check (
    bucket_id = 'signatures'
    and (
      public.assinatura_e_minha(name)
      or public.can_access(public.storage_tenant(name), 'usuarios.administrar')
    )
  );

-- Apagar.
create policy wl_signatures_apagar on storage.objects for delete to authenticated
  using (
    bucket_id = 'signatures'
    and (
      public.assinatura_e_minha(name)
      or public.can_access(public.storage_tenant(name), 'usuarios.administrar')
    )
  );


do $$
declare v_politicas int;
begin
  select count(*) into v_politicas from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname like 'wl_signatures%';
  raise notice 'Politicas do bucket de assinaturas: % (esperado 4)', v_politicas;
end$$;
