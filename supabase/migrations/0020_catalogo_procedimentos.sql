-- ---------------------------------------------------------------------
-- Catalogo inicial de procedimentos que geram repasse ao medico.
--
-- Os valores vieram da tabela da clinica e ficam editaveis na tela.
-- A insercao percorre os tenants existentes: nada aqui e especifico de um
-- cliente, e um tenant novo comeca vazio ate clicar em "restaurar catalogo".
-- ---------------------------------------------------------------------

insert into public.procedure_types (tenant_id, code, name, default_fee, sort_order)
select t.id, c.code, c.name, c.fee, c.ordem
from public.tenants t
cross join (values
  ('cps',                    'C.P.S.',                      20.00,  10),
  ('seduc',                  'SEDUC',                       18.00,  20),
  ('ingresso',               'Ingresso',                    44.00,  30),
  ('pericia',                'Perícia',                     30.00,  40),
  ('pericia_domiciliar_50',  'Perícia domiciliar (50 km)',    0.00,  50),
  ('pericia_domiciliar_100', 'Perícia domiciliar (100 km)',   0.00,  60),
  ('junta_pericia',          'Junta Médica Perícia',        130.00,  70),
  ('junta_medica',           'Junta Médica',                 64.00,  80),
  ('junta_auxiliar',         'Junta Médica auxiliar',         0.00,  90),
  ('consulta_ocupacional',   'Consulta ocupacional',          0.00, 100)
) as c(code, name, fee, ordem)
on conflict (tenant_id, code) do nothing;

-- Procedimento padrao do atendimento clinico, usado quando a consulta e
-- finalizada sem procedimento escolhido na tela.
insert into public.tenant_settings (tenant_id, group_key, settings)
select t.id, 'repasse', jsonb_build_object('procedimento_padrao', 'consulta_ocupacional')
from public.tenants t
on conflict (tenant_id, group_key) do nothing;
