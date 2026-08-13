-- =====================================================================
-- 0018 - Guia de uso: memoria do que cada pessoa ja viu
--
-- O guia roda sozinho na primeira vez que alguem abre cada tela. Guardar
-- isso no banco, e nao no navegador, faz a memoria seguir a pessoa entre
-- o computador da recepcao, o do consultorio e o de casa.
-- =====================================================================

create table if not exists public.user_guide_progress (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  guide_key    text not null,               -- recepcao | triagem | filas | medico | ...
  last_step    int  not null default 0,
  completed_at timestamptz,
  skipped_at   timestamptz,
  seen_count   int  not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, guide_key)
);
create index if not exists idx_user_guide_progress_user
  on public.user_guide_progress (user_id);

-- ---------------------------------------------------------------------
-- RLS: cada pessoa enxerga e escreve apenas o proprio progresso.
--
-- Nao ha motivo para um usuario ver o que o colega ja aprendeu, e menos
-- ainda para poder reiniciar o guia dele.
-- ---------------------------------------------------------------------
alter table public.user_guide_progress enable row level security;
alter table public.user_guide_progress force row level security;

drop policy if exists guide_select_self on public.user_guide_progress;
create policy guide_select_self on public.user_guide_progress for select to authenticated
  using (user_id = auth.uid());

drop policy if exists guide_insert_self on public.user_guide_progress;
create policy guide_insert_self on public.user_guide_progress for insert to authenticated
  with check (user_id = auth.uid() and public.belongs_to_tenant(tenant_id));

drop policy if exists guide_update_self on public.user_guide_progress;
create policy guide_update_self on public.user_guide_progress for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists guide_delete_self on public.user_guide_progress;
create policy guide_delete_self on public.user_guide_progress for delete to authenticated
  using (user_id = auth.uid());

drop trigger if exists set_updated_at on public.user_guide_progress;
create trigger set_updated_at before update on public.user_guide_progress
for each row execute function public.tg_set_updated_at();
