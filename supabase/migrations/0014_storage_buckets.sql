-- =====================================================================
-- 0014 - Buckets de storage e politicas de acesso por tenant
-- Convencao de caminho: <tenant_id>/<subpasta>/<arquivo>
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('branding',           'branding',           true,  5242880,   array['image/png','image/jpeg','image/webp','image/svg+xml','image/x-icon']),
  ('ecommerce',          'ecommerce',          true,  10485760,  array['image/png','image/jpeg','image/webp','image/avif']),
  ('clinical-documents', 'clinical-documents', false, 26214400,  null),
  ('exam-results',       'exam-results',       false, 52428800,  null),
  ('signatures',         'signatures',         false, 2097152,   array['image/png','image/jpeg','image/webp']),
  ('imports',            'imports',            false, 52428800,  null),
  ('scraper-evidence',   'scraper-evidence',   false, 26214400,  array['image/png','image/jpeg','text/plain','application/json']),
  ('attachments',        'attachments',        false, 52428800,  null)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Helper: primeiro segmento do caminho = tenant_id
create or replace function public.storage_tenant(object_name text)
returns uuid
language plpgsql
immutable
as $$
declare v text;
begin
  v := split_part(object_name, '/', 1);
  if v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return v::uuid;
  end if;
  return null;
end$$;

do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects'
           and policyname like 'wl_%' loop
    execute format('drop policy if exists %I on storage.objects;', r.policyname);
  end loop;
end$$;

-- Leitura publica dos buckets de marca e loja
create policy wl_public_read on storage.objects for select to public
  using (bucket_id in ('branding','ecommerce'));

-- Escrita nos buckets publicos exige permissao de configuracao/produtos
create policy wl_branding_write on storage.objects for all to authenticated
  using (bucket_id = 'branding' and public.can_access(public.storage_tenant(name), 'whitelabel.configurar'))
  with check (bucket_id = 'branding' and public.can_access(public.storage_tenant(name), 'whitelabel.configurar'));

create policy wl_ecommerce_write on storage.objects for all to authenticated
  using (bucket_id = 'ecommerce' and public.can_access(public.storage_tenant(name), 'produtos.administrar'))
  with check (bucket_id = 'ecommerce' and public.can_access(public.storage_tenant(name), 'produtos.administrar'));

-- Documentos clinicos: privados, somente com permissao clinica/documental
create policy wl_clinical_read on storage.objects for select to authenticated
  using (bucket_id in ('clinical-documents','exam-results','attachments')
         and (public.can_access(public.storage_tenant(name), 'clinico.ver')
              or public.can_access(public.storage_tenant(name), 'documentos.emitir')));

create policy wl_clinical_write on storage.objects for insert to authenticated
  with check (bucket_id in ('clinical-documents','exam-results','attachments')
              and (public.can_access(public.storage_tenant(name), 'exames.preencher')
                   or public.can_access(public.storage_tenant(name), 'documentos.emitir')));

create policy wl_clinical_update on storage.objects for update to authenticated
  using (bucket_id in ('clinical-documents','exam-results','attachments')
         and public.can_access(public.storage_tenant(name), 'documentos.emitir'));

create policy wl_clinical_delete on storage.objects for delete to authenticated
  using (bucket_id in ('clinical-documents','exam-results','attachments')
         and public.can_access(public.storage_tenant(name), 'documentos.emitir'));

-- Assinaturas: somente admin de usuarios e o proprio profissional
create policy wl_signatures on storage.objects for all to authenticated
  using (bucket_id = 'signatures' and public.can_access(public.storage_tenant(name), 'usuarios.administrar'))
  with check (bucket_id = 'signatures' and public.can_access(public.storage_tenant(name), 'usuarios.administrar'));

-- Importacoes e evidencias tecnicas
create policy wl_imports on storage.objects for all to authenticated
  using (bucket_id = 'imports' and public.can_access(public.storage_tenant(name), 'importacoes.executar'))
  with check (bucket_id = 'imports' and public.can_access(public.storage_tenant(name), 'importacoes.executar'));

create policy wl_scraper_evidence on storage.objects for all to authenticated
  using (bucket_id = 'scraper-evidence' and public.can_access(public.storage_tenant(name), 'scraper.administrar'))
  with check (bucket_id = 'scraper-evidence' and public.can_access(public.storage_tenant(name), 'scraper.administrar'));
