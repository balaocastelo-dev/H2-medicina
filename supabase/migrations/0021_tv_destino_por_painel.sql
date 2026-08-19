-- =====================================================================
-- Destino da chamada por tipo de sala
--
-- A clinica tem duas TVs em lugares diferentes. A da sala de espera so
-- deve mostrar quem foi chamado para a recepcao e para a triagem; a do
-- corredor interno mostra as salas de exame e os consultorios.
--
-- Ate aqui toda chamada era gravada como 'sala'. Agora o tipo da sala
-- decide o destino, e cada painel filtra o que e seu.
-- =====================================================================

create or replace function public.tv_destino_da_sala(p_kind text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_kind in ('recepcao', 'guiche') then 'recepcao'
    when p_kind = 'triagem'               then 'triagem'
    else 'sala'
  end;
$$;

comment on function public.tv_destino_da_sala(text) is
  'Painel de TV em que a chamada da sala aparece: recepcao | triagem | sala.';

-- Chamadas ja gravadas ganham o destino certo, olhando o nome da sala.
update public.tv_calls t
   set destination = public.tv_destino_da_sala(r.kind)
  from public.rooms r
 where r.tenant_id = t.tenant_id
   and r.name = t.room_name
   and coalesce(t.destination, 'sala') = 'sala'
   and public.tv_destino_da_sala(r.kind) <> 'sala';

create index if not exists idx_tv_calls_destino
  on public.tv_calls (tenant_id, destination, called_at desc);
