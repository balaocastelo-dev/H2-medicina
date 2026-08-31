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
-- As salas NAO sao criadas aqui. Cada clinica organiza as suas do seu
-- jeito — a H2 numera de "Sala 1" a "Sala 9" — e inventar sala nova faz
-- aparecer um cartao vazio no quadro de filas que ninguem opera. Os
-- exames novos entram nas salas que a clinica ja usa para o exame
-- equivalente, e a tela de Salas permite remanejar depois.
-- =====================================================================

do $$
declare
  v_tenant uuid;
  v_sala_forca   uuid;  -- onde a clinica ja faz dinamometria
  v_sala_triagem uuid;  -- testes de bancada: acuidade, cores, questionarios
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
    -- De onde saem as salas dos exames novos
    --
    -- Forca: a sala em que a dinamometria generica ja era feita. Na H2 e
    -- a "Sala 5 — Coleta de exames"; num tenant novo e a sala DIN do seed
    -- inicial. Se nenhuma existir, cai na sala do laboratorio.
    -- ----------------------------------------------------------------
    select r.id into v_sala_forca
      from public.exam_types et
      join public.rooms r on r.id = et.default_room_id
     where et.tenant_id = v_tenant and et.code = 'DINAMO' and r.is_active
     limit 1;

    if v_sala_forca is null then
      select r.id into v_sala_forca
        from public.exam_types et
        join public.rooms r on r.id = et.default_room_id
       where et.tenant_id = v_tenant and et.code = 'LAB' and r.is_active
       limit 1;
    end if;

    -- Acuidade, visao de cores e os questionarios sao feitos na bancada da
    -- triagem — a propria ficha de triagem ja registra acuidade O.D./O.E.
    select id into v_sala_triagem
      from public.rooms
     where tenant_id = v_tenant and kind = 'triagem' and is_active and deleted_at is null
     order by sort_order
     limit 1;

    if v_sala_triagem is null then
      v_sala_triagem := v_sala_forca;
    end if;

    -- ----------------------------------------------------------------
    -- Exames novos
    --
    -- O raio X entra sem sala de proposito: "devera ser emitido uma guia
    -- no final do atendimento encaminhando para exame".
    -- ----------------------------------------------------------------
    insert into public.exam_types
      (tenant_id, code, name, description, average_minutes, default_room_id, sort_order,
       price, available_online, requires_result_document, is_external, requires_description)
    values
      (v_tenant,'ACUIDADE','Acuidade visual','Avaliacao de acuidade visual',
       10, v_sala_triagem,  8, 45.00, true, true, false, false),
      (v_tenant,'ISHIHARA','Teste de Ishihara (cores)','Avaliacao da visao de cores',
       10, v_sala_triagem,  9, 45.00, true, true, false, false),
      (v_tenant,'PSICO','Avaliacao psicossocial','Questionario de fatores de risco psicossocial',
       15, v_sala_triagem, 10, 80.00, true, true, false, false),
      (v_tenant,'ROMBERG','Teste de Romberg','Avaliacao de equilibrio',
       10, v_sala_triagem, 11, 45.00, true, true, false, false),
      (v_tenant,'FADIGA','Teste de fadiga','Questionario de sintomas de fadiga',
       10, v_sala_triagem, 12, 45.00, true, true, false, false),
      (v_tenant,'DINAMO_PAL','Dinamometria palmar','Forca de preensao palmar direita e esquerda',
       10, v_sala_forca,   13, 45.00, true, true, false, false),
      (v_tenant,'DINAMO_ESC','Dinamometria escapular','Forca escapular',
       10, v_sala_forca,   14, 45.00, true, true, false, false),
      (v_tenant,'DINAMO_LOM','Dinamometria lombar','Forca lombar',
       10, v_sala_forca,   15, 45.00, true, true, false, false),
      (v_tenant,'RAIOX','Raio X','Encaminhamento externo: a guia sai no fim do atendimento',
       0,  null,           16,  0.00, false, true, true, true)
    on conflict (tenant_id, code) do update
      set name                     = excluded.name,
          description              = excluded.description,
          average_minutes          = excluded.average_minutes,
          sort_order               = excluded.sort_order,
          is_external              = excluded.is_external,
          requires_description     = excluded.requires_description,
          requires_result_document = excluded.requires_result_document,
          is_active                = true,
          -- So preenche a sala se ainda nao houver uma ativa: se a clinica
          -- remanejou o exame, a escolha dela prevalece.
          default_room_id = case
            when excluded.default_room_id is null then public.exam_types.default_room_id
            when exists (
              select 1 from public.rooms r
               where r.id = public.exam_types.default_room_id and r.is_active
            ) then public.exam_types.default_room_id
            else excluded.default_room_id
          end;

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
