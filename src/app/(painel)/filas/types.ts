/** Tipos compartilhados entre a pagina (servidor) e os componentes client. */
export interface QueueExam {
  id: string;
  status: string;
  priority: string;
  queued_at: string | null;
  called_at: string | null;
  started_at: string | null;
  room_id: string | null;
  exam_type_id: string;
  attendance_id: string;
  exam_types: { name: string; code: string; default_room_id: string | null } | null;
  attendances: {
    id: string;
    checkin_at: string;
    stage_code: string;
    patients: { full_name: string } | null;
    queue_tickets: { code: string }[];
  } | null;
}

export interface RoomInfo {
  id: string;
  name: string;
  code: string;
  kind: string;
  status: string;
  current_attendance_id: string | null;
}
