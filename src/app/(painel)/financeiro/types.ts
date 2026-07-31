/** Tipos compartilhados entre a pagina (servidor) e os componentes client. */
export interface PaymentRow {
  id: string;
  description: string | null;
  amount: number;
  discount: number;
  net_amount: number;
  method: string;
  status: string;
  due_date: string | null;
  paid_at: string | null;
  created_at: string;
  patients: { full_name: string } | null;
  companies: { trade_name: string | null; legal_name: string } | null;
  pix_charges: { payload: string; qrcode_data_url: string | null }[];
}
