/** Tipos compartilhados entre a pagina (servidor) e os componentes client. */
export interface ReceptionRow {
  id: string;
  stage_code: string;
  priority: string;
  checkin_at: string;
  needs_triage: boolean;
  payment_status: string;
  notes: string | null;
  order_id: string | null;
  origin_kind: string;
  origin_kind_set_at: string | null;
  company_id: string | null;
  patients: {
    id: string;
    full_name: string;
    cpf: string | null;
    rg: string | null;
    job_title: string | null;
    default_origin_kind: string | null;
  } | null;
  companies: { trade_name: string | null; legal_name: string } | null;
  queue_tickets: { code: string }[];
  patient_exams: { id: string; exam_type_id: string; status: string }[];
  patient_signatures: {
    id: string;
    purpose: string;
    method: string;
    status: string;
    signed_at: string | null;
  }[];
}
