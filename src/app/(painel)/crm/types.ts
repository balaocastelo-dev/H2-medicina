/** Tipos compartilhados entre a pagina (servidor) e os componentes client. */
export interface CrmCard {
  id: string;
  stage_code: string;
  priority: string;
  checkin_at: string;
  stage_changed_at: string;
  payment_status: string;
  order_id: string | null;
  notes: string | null;
  patients: { id: string; full_name: string } | null;
  companies: { trade_name: string | null; legal_name: string } | null;
  queue_tickets: { code: string }[];
  patient_exams: { id: string; status: string }[];
}
