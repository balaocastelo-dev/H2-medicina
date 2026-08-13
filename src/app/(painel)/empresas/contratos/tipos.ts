/** Tipos compartilhados entre a pagina (servidor) e o painel (client). */

export interface ItemDoContratoNaLista {
  id: string;
  kind: string;
  name: string;
  exam_type_id: string | null;
  quantity_included: number;
  quantity_used: number;
  unit_price: number | null;
  extra_price: number | null;
}

export interface ContratoNaLista {
  id: string;
  name: string;
  code: string | null;
  kind: string;
  status: string;
  starts_on: string | null;
  ends_on: string | null;
  signed_on: string | null;
  pcmso_valid_until: string | null;
  employees_count: number | null;
  monthly_amount: number | null;
  amount: number | null;
  billing_day: number | null;
  readjustment_index: string | null;
  auto_renew: boolean;
  esocial_enabled: boolean;
  coordinator_name: string | null;
  coordinator_crm: string | null;
  schedule_email: string | null;
  billing_email: string | null;
  technical_hour_rate: number | null;
  late_fee_percent: number | null;
  late_interest_percent: number | null;
  credits_total: number | null;
  credits_used: number;
  notes: string | null;
  company_id: string;
  document_path: string | null;
  companies: { legal_name: string; trade_name: string | null } | null;
  company_contract_items: ItemDoContratoNaLista[];
}
