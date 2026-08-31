-- =====================================================================
-- SEED 0002 - Exames realizados na clinica
--
-- Lista enviada pela recepcao em 27/08:
--   "exames realizados na clinica que devem ser inclusos nas opcoes de
--    agendamento tanto de cliente, quanto interno e incluso nas filas,
--    juntamente com as fichas em cada area: Acuidade, audiometria,
--    clinico, psicossocial, eletrocardiograma, eletroencefalograma,
--    espirometria, Exames laboratoriais, teste ishihara (cores), teste de
--    romberg, raiox, dinamometria escapular, lombar e palmar"
--
-- Continua sendo SEED: o catalogo e editavel na tela de exames e um
-- tenant novo comeca com o que estiver aqui, sem nada fixado em codigo.
-- =====================================================================

do $$
declare
  v_tenant uuid;
  v_sala_acuidade uuid;
  v_sala_psico uuid;
  v_sala_dinamo uuid;
begin
  for v_tenant in select id from public.tenants loop

    -- ----------------------------------------------------------------
    -- Passo do relogio na agenda
    -- "Mudar os horarios de agendamento para de 5 em 5 minutos" (21/08)
    -- "opcao de agendamento a cada 10 minutos" (27/08 — vale a ultima)
    -- ----------------------------------------------------------------
    insert into public.tenant_settings (tenant_id, group_key, settings)
    values (v_tenant, 'agenda', jsonb_build_object('intervalo_minutos', 10))
    on conflict (tenant_id, group_key) do nothing;

    -- ----------------------------------------------------------------
    -- Salas que faltavam para os exames novos
    -- ----------------------------------------------------------------
    insert into public.rooms (tenant_id, code, name, kind, sort_order) values
      (v_tenant,'ACU','Sala de Acuidade Visual','exame',10),
      (v_tenant,'PSI','Sala de Avaliacao Psicossocial','exame',11)
    on conflict (tenant_id, code) do nothing;

    select id into v_sala_acuidade from public.rooms where tenant_id=v_tenant and code='ACU';
    select id into v_sala_psico    from public.rooms where tenant_id=v_tenant and code='PSI';
    select id into v_sala_dinamo   from public.rooms where tenant_id=v_tenant and code='DIN';

    -- ----------------------------------------------------------------
    -- Exames novos
    --
    -- O raio X nao tem sala: "devera ser emitido uma guia no final do
    -- atendimento encaminhando para exame".
    -- ----------------------------------------------------------------
    insert into public.exam_types
      (tenant_id, code, name, description, average_minutes, default_room_id, sort_order,
       price, available_online, requires_result_document, is_external, requires_description)
    values
      (v_tenant,'ACUIDADE','Acuidade visual','Avaliacao de acuidade visual',
       10, v_sala_acuidade,  8, 45.00, true, true, false, false),
      (v_tenant,'ISHIHARA','Teste de Ishihara (cores)','Avaliacao da visao de cores',
       10, v_sala_acuidade,  9, 45.00, true, true, false, false),
      (v_tenant,'PSICO','Avaliacao psicossocial','Questionario de fatores de risco psicossocial',
       15, v_sala_psico,    10, 80.00, true, true, false, false),
      (v_tenant,'ROMBERG','Teste de Romberg','Avaliacao de equilibrio',
       10, v_sala_psico,    11, 45.00, true, true, false, false),
      (v_tenant,'FADIGA','Teste de fadiga','Questionario de sintomas de fadiga',
       10, v_sala_psico,    12, 45.00, true, true, false, false),
      (v_tenant,'DINAMO_PAL','Dinamometria palmar','Forca de preensao palmar direita e esquerda',
       10, v_sala_dinamo,   13, 45.00, true, true, false, false),
      (v_tenant,'DINAMO_ESC','Dinamometria escapular','Forca escapular',
       10, v_sala_dinamo,   14, 45.00, true, true, false, false),
      (v_tenant,'DINAMO_LOM','Dinamometria lombar','Forca lombar',
       10, v_sala_dinamo,   15, 45.00, true, true, false, false),
      (v_tenant,'RAIOX','Raio X','Encaminhamento externo: a guia sai no fim do atendimento',
       0,  null,            16,  0.00, false, true, true, true)
    on conflict (tenant_id, code) do update
      set name                     = excluded.name,
          description              = excluded.description,
          average_minutes          = excluded.average_minutes,
          default_room_id          = excluded.default_room_id,
          sort_order               = excluded.sort_order,
          is_external              = excluded.is_external,
          requires_description     = excluded.requires_description,
          requires_result_document = excluded.requires_result_document,
          is_active                = true;

    -- Exames laboratoriais precisam da descricao da analise solicitada.
    update public.exam_types
       set requires_description = true
     where tenant_id = v_tenant and code = 'LAB';

    -- A dinamometria generica foi separada em palmar, escapular e lombar.
    update public.exam_types
       set is_active = false
     where tenant_id = v_tenant and code = 'DINAMO';

    insert into public.room_exam_types (tenant_id, room_id, exam_type_id)
    select v_tenant, et.default_room_id, et.id
      from public.exam_types et
     where et.tenant_id = v_tenant
       and et.default_room_id is not null
       and et.is_active
    on conflict do nothing;

  end loop;
end$$;
