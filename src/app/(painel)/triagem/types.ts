/** Tipos compartilhados entre a pagina (servidor) e os componentes client. */
import type { Triage } from '@/types/entities';
import type { Embutido } from '@/lib/embed';

export interface TriageRow {
  id: string;
  stage_code: string;
  priority: string;
  checkin_at: string;
  patients: { id: string; full_name: string; birth_date: string | null } | null;
  companies: { trade_name: string | null; legal_name: string } | null;
  queue_tickets: { code: string }[];
  // Uma por atendimento: o PostgREST entrega como objeto, nao como lista.
  triages: Embutido<Triage>;
}

/**
 * Exame de bancada, feito na propria sala de triagem.
 *
 * Acuidade, Ishihara e fadiga sao feitos ali mesmo, com o paciente sentado
 * na frente de quem fez os sinais vitais. Ate 15/09 eles apareciam na tela
 * de Filas e salas, e o paciente tinha que sair da triagem, entrar na fila
 * e voltar. "O cliente/usuario nao deve sair da recepcao e ir para triagem,
 * filas e salas e depois voltar para triagem."
 */
export interface ExameDeBancada {
  id: string;
  status: string;
  attendance_id: string;
  exam_types: { name: string; code: string } | null;
  exam_results: { values: Record<string, string>; conclusion: string | null }[];
}
