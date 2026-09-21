-- =====================================================================
-- A sala em que o exame e chamado segue a sala padrao dele
--
-- "os exames de dinamometria (palmar, escapular e lombar) estao sendo
--  chamados na sala 5, eles devem ser chamados na sala 7"
--                                              -- Isabella, 21/09
--
-- Existem dois lugares que dizem em que sala um exame acontece:
--
--   exam_types.default_room_id  -- a sala do exame
--   room_exam_types             -- quais exames cada sala atende
--
-- A chamada do proximo paciente aceita os DOIS. Quando o script de
-- precos e salas moveu as dinamometrias para a Sala 7, ele mexeu so no
-- primeiro. O vinculo antigo com a Sala 5 -- criado pelo seed, porque a
-- dinamometria generica era feita la -- continuou valendo, e a Sala 5
-- seguiu chamando.
--
-- Duas verdades sobre a mesma coisa sempre divergem. Aqui os vinculos
-- passam a seguir a sala padrao, e um gatilho mantem isso de pe quando
-- alguem trocar a sala de um exame pela tela de Configuracoes.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tira o vinculo que contradiz a sala padrao
--
-- So mexe em exame que TEM sala padrao definida. Exame sem sala padrao
-- pode ser atendido por varias salas de proposito, e isso continua valendo.
-- ---------------------------------------------------------------------
delete from public.room_exam_types ret
 using public.exam_types et
 where et.id = ret.exam_type_id
   and et.default_room_id is not null
   and ret.room_id <> et.default_room_id;

-- ---------------------------------------------------------------------
-- 2. Garante o vinculo com a sala certa
-- ---------------------------------------------------------------------
insert into public.room_exam_types (tenant_id, room_id, exam_type_id)
select et.tenant_id, et.default_room_id, et.id
  from public.exam_types et
 where et.default_room_id is not null
   and et.is_active
   and et.deleted_at is null
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 3. Trocar a sala de um exame passa a arrastar o vinculo junto
--
-- Sem isto, a proxima vez que alguem remanejar um exame pela tela cria
-- exatamente o mesmo problema -- e ninguem vai lembrar de mexer nas duas
-- tabelas.
-- ---------------------------------------------------------------------
create or replace function public.tg_sincronizar_sala_do_exame()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.default_room_id is not distinct from old.default_room_id then
    return new;
  end if;

  delete from public.room_exam_types
   where exam_type_id = new.id
     and (new.default_room_id is null or room_id <> new.default_room_id);

  if new.default_room_id is not null then
    insert into public.room_exam_types (tenant_id, room_id, exam_type_id)
    values (new.tenant_id, new.default_room_id, new.id)
    on conflict do nothing;
  end if;

  return new;
end$$;

comment on function public.tg_sincronizar_sala_do_exame() is
  'Mantem room_exam_types alinhado com exam_types.default_room_id: duas verdades sobre a mesma sala sempre divergem.';

drop trigger if exists sincronizar_sala_do_exame on public.exam_types;
create trigger sincronizar_sala_do_exame
after update of default_room_id on public.exam_types
for each row execute function public.tg_sincronizar_sala_do_exame();
