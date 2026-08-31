-- =====================================================================
-- 0026 - Salvar a consulta nao pode esvaziar a sala
--
-- Encontrado ao rodar o percurso completo de um paciente de teste.
--
-- `tg_consultation_progress` copiava `medical_consultations.room_id` para
-- `attendances.current_room_id` a cada gravacao. A tela do medico nunca
-- preencheu esse campo, entao a primeira vez que o medico salvava a
-- consulta o vinculo com o consultorio virava nulo.
--
-- O efeito aparecia depois: ao finalizar, o codigo que libera a sala nao
-- sabia mais de qual sala se tratava. A sala seguia "ocupada" pelo paciente
-- que ja tinha ido embora e o botao "chamar proximo" nunca voltava naquele
-- consultorio — com tres salas, a fila do medico travava inteira depois de
-- tres atendimentos.
--
-- A aplicacao passou a gravar o room_id na consulta. Este gatilho fica
-- defensivo: sem sala informada, mantem a que ja estava.
-- =====================================================================

create or replace function public.tg_consultation_progress()
returns trigger language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    update public.attendances
       set stage_code = 'em_consulta',
           consultation_started_at = coalesce(consultation_started_at, now()),
           in_service = true,
           -- coalesce: consulta sem sala informada nao desfaz a chamada que
           -- levou o paciente ate o consultorio.
           current_room_id = coalesce(new.room_id, current_room_id)
     where id = new.attendance_id;
  elsif new.finished_at is not null and old.finished_at is null then
    update public.attendances
       set stage_code = 'aguardando_documentos',
           consultation_finished_at = new.finished_at,
           in_service = false,
           current_room_id = null
     where id = new.attendance_id;
  end if;
  return new;
end$$;
