-- Habilita publicacao realtime das tabelas usadas pelo painel e fluxos de fila.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'tv_calls'
    ) then
      execute 'alter publication supabase_realtime add table public.tv_calls';
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'attendances'
    ) then
      execute 'alter publication supabase_realtime add table public.attendances';
    end if;
  end if;
end $$;
