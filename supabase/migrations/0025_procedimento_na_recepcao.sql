-- =====================================================================
-- 0025 - Procedimento definido na recepcao
--
-- "ao inves de ter que selecionar na ficha clinica na area do medico o que
--  e (Pericia, junta medica, entre outros), colocar essa opc na area da
--  recepcao qnd for direcionar para quais exames"
--
-- Alem de tirar a escolha das costas do medico, isso e o que torna
-- possivel a outra regra que a clinica pediu: so da para nao emitir ficha
-- clinica numa pericia se o sistema souber que aquilo e uma pericia antes
-- de chegar no medico.
-- =====================================================================

alter table public.attendances
  add column if not exists procedure_code text;

comment on column public.attendances.procedure_code is
  'Procedimento escolhido pela recepcao ao liberar o paciente. Alimenta o '
  'repasse ao medico e decide se o atendimento emite ficha clinica.';

create index if not exists idx_attendances_procedimento
  on public.attendances (tenant_id, procedure_code) where deleted_at is null;

-- ---------------------------------------------------------------------
-- Quais procedimentos dispensam a ficha clinica
--
-- "emitir ficha clinica exceto para pericia, acl, sisper e empresa agape"
--
-- Vira uma marca no catalogo, e nao uma lista de codigos escrita no
-- codigo da aplicacao: a clinica citou ACL, que ainda nao existe no
-- cadastro, e outros vao aparecer. Quem cadastrar o procedimento decide.
-- ---------------------------------------------------------------------
alter table public.procedure_types
  add column if not exists emite_ficha_clinica boolean not null default true;

comment on column public.procedure_types.emite_ficha_clinica is
  'Quando falso, o atendimento com este procedimento nao oferece ficha '
  'clinica: sai apenas o A.S.O., o laudo dos exames e o comprovante.';

-- Pericia e junta medica sao avaliacoes, nao consulta ocupacional: nao ha
-- ficha clinica a emitir. Roda em todos os tenants que ja tenham o
-- catalogo, sem tocar em procedimento que a clinica tenha criado depois.
update public.procedure_types
   set emite_ficha_clinica = false
 where code in ('pericia', 'pericia_domiciliar_50', 'pericia_domiciliar_100',
                'junta_pericia', 'junta_medica', 'junta_auxiliar');
