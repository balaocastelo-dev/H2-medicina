/** Conta a pagar da clinica, compartilhada entre a pagina e o client. */
export interface ContaRow {
  id: string;
  description: string;
  category: string;
  supplier: string | null;
  amount: number;
  due_date: string;
  status: string;
  is_recurring: boolean;
  notes: string | null;
}
