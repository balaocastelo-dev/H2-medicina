-- =====================================================================
-- Sala que diz estar ocupada sem ninguem dentro
--
-- Cole no SQL Editor da H2. A PARTE 1 so mostra; nada muda.
-- A PARTE 2 destrava. Rode a 1 primeiro para ver o que aparece.
-- =====================================================================


-- ---------------------------------------------------------------------
-- PARTE 1 -- O QUE ESTA SEGURANDO CADA SALA
--
-- A coluna `visivel_na_tela` e a chave: quando ela vem `nao`, o exame
-- esta travando a sala e NAO aparece no quadro de Filas. E o caso sem
-- saida — a tela mostra a sala livre e o botao recusa.
-- ---------------------------------------------------------------------
select r.name                                   as sala,
       r.status                                 as status_da_sala,
       pe.status                                as status_do_exame,
       et.name                                  as exame,
       p.full_name                              as paciente,
       a.stage_code                             as etapa_do_atendimento,
       a.checkin_at::date                        as dia_da_chegada,
       case
         when a.finished_at is not null then 'nao — atendimento encerrado'
         when a.cancelled_at is not null then 'nao — atendimento cancelado'
         when a.deleted_at is not null then 'nao — atendimento apagado'
         when a.stage_code not in ('aguardando_exames','em_exames')
           then 'nao — paciente esta em ' || a.stage_code
         else 'sim'
       end                                      as visivel_na_tela
  from public.patient_exams pe
  join public.rooms r        on r.id = pe.room_id
  join public.exam_types et  on et.id = pe.exam_type_id
  join public.attendances a  on a.id = pe.attendance_id
  left join public.patients p on p.id = a.patient_id
 where pe.status in ('chamado','em_andamento')
 order by r.name, a.checkin_at;


-- ---------------------------------------------------------------------
-- PARTE 2 -- DESTRAVA
--
-- Devolve a fila todo exame que ficou preso em `chamado` sem ninguem para
-- conclui-lo, e solta as salas correspondentes.
--
-- O criterio e conservador: so mexe no exame cujo atendimento JA ACABOU,
-- foi cancelado, ou saiu das etapas de exame. Paciente que esta de fato
-- dentro da sala agora nao e tocado.
-- ---------------------------------------------------------------------
with presos as (
  select pe.id,
         pe.room_id,
         -- Atendimento acabou de vez? Entao o exame nao vai mais ser feito.
         -- Se o paciente so mudou de etapa, o exame volta para a fila.
         (a.finished_at is not null
          or a.cancelled_at is not null
          or a.deleted_at is not null) as acabou
    from public.patient_exams pe
    join public.attendances a on a.id = pe.attendance_id
   where pe.status in ('chamado','em_andamento')
     and (
       a.finished_at is not null
       or a.cancelled_at is not null
       or a.deleted_at is not null
       or a.stage_code not in ('aguardando_exames','em_exames')
     )
),
devolvidos as (
  update public.patient_exams pe
     -- O `::exam_execution_status` e obrigatorio: a coluna e enum, e o
     -- `case` devolve texto.
     set status = (case when x.acabou then 'nao_realizado' else 'pendente' end)
                    ::public.exam_execution_status,
         called_at = null,
         started_at = null,
         queued_at = null,
         room_id = case when pe.sala_escolhida_a_mao then pe.room_id else null end,
         not_performed_reason = case
           when x.acabou
           then 'Exame ficou chamado sem conclusao; atendimento ja encerrado'
           else null
         end
    from presos x
   where pe.id = x.id
  returning pe.id, x.room_id
)
update public.rooms r
   set status = 'disponivel',
       current_attendance_id = null
 where r.id in (select room_id from devolvidos where room_id is not null);


-- ---------------------------------------------------------------------
-- Sala marcada como ocupada apontando para atendimento que ja acabou.
--
-- Independente dos exames: e o outro jeito de a sala ficar presa, e e o
-- que impede de desativa-la no cadastro.
-- ---------------------------------------------------------------------
update public.rooms r
   set status = 'disponivel', current_attendance_id = null
  from public.attendances a
 where a.id = r.current_attendance_id
   and (a.finished_at is not null or a.cancelled_at is not null or a.deleted_at is not null);


-- ---------------------------------------------------------------------
-- Confere: tem de voltar vazio (ou so com quem esta de fato na sala).
-- ---------------------------------------------------------------------
select r.name as sala, r.status, p.full_name as paciente, a.stage_code as etapa
  from public.rooms r
  left join public.attendances a on a.id = r.current_attendance_id
  left join public.patients p on p.id = a.patient_id
 where r.status = 'ocupada'
    or exists (select 1 from public.patient_exams pe
                where pe.room_id = r.id and pe.status in ('chamado','em_andamento'))
 order by r.name;
