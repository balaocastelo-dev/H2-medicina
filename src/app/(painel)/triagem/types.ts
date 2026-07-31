/** Tipos compartilhados entre a pagina (servidor) e os componentes client. */
import type { Triage } from '@/types/entities';

export interface TriageRow {
  id: string;
  stage_code: string;
  priority: string;
  checkin_at: string;
  patients: { id: string; full_name: string; birth_date: string | null } | null;
  companies: { trade_name: string | null; legal_name: string } | null;
  queue_tickets: { code: string }[];
  triages: Triage[];
}
