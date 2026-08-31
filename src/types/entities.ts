/**
 * Tipos de dominio compartilhados entre frontend e backend.
 * Espelham o modelo de dados em supabase/migrations.
 */

export type UUID = string;
export type ISODate = string;

export type Gender = 'masculino' | 'feminino' | 'outro' | 'nao_informado';
export type Priority = 'normal' | 'prioritario' | 'encaixe';
export type AppointmentStatus =
  | 'agendado'
  | 'confirmado'
  | 'checkin'
  | 'em_atendimento'
  | 'realizado'
  | 'cancelado'
  | 'ausente'
  | 'remarcado';
export type ExamStatus =
  'pendente' | 'em_fila' | 'chamado' | 'em_andamento' | 'concluido' | 'nao_realizado' | 'cancelado';
export type RoomStatus = 'disponivel' | 'ocupada' | 'pausada' | 'inativa';
export type PaymentMethod =
  'pix' | 'cartao' | 'dinheiro' | 'link' | 'faturamento' | 'manual' | 'cortesia' | 'cupom';
export type PaymentStatus =
  'pendente' | 'em_analise' | 'pago' | 'cancelado' | 'estornado' | 'falhou';
export type OrderStatus =
  | 'carrinho'
  | 'aguardando_pagamento'
  | 'pago'
  | 'em_analise'
  | 'agendamento_pendente'
  | 'agendado'
  | 'em_atendimento'
  | 'concluido'
  | 'cancelado'
  | 'reembolsado'
  | 'pagamento_recusado';
export type DataOrigin =
  | 'manual'
  | 'importacao_excel'
  | 'importacao_csv'
  | 'scraper'
  | 'ecommerce'
  | 'totem'
  | 'api'
  | 'seed';
export type MedicalVerdict = 'apto' | 'apto_com_restricoes' | 'inapto' | 'inconclusivo';
export type ScraperRunStatus =
  'pendente' | 'executando' | 'concluido' | 'concluido_com_erros' | 'erro' | 'cancelado';
export type ImportReviewStatus =
  'pendente' | 'aprovado' | 'ignorado' | 'conflito' | 'erro' | 'importado';
export type CampaignStatus =
  | 'rascunho'
  | 'aguardando_aprovacao'
  | 'aprovada'
  | 'agendada'
  | 'enviando'
  | 'enviada'
  | 'cancelada';
export type ProductKind =
  | 'exame'
  | 'consulta'
  | 'pacote'
  | 'servico'
  | 'servico_empresarial'
  | 'avaliacao'
  | 'produto_fisico'
  | 'combo';
export type DocumentKind =
  | 'resumo_atendimento'
  | 'ficha_clinica'
  | 'relacao_exames'
  | 'resultado_exame'
  | 'recibo'
  | 'comprovante_comparecimento'
  | 'atestado_comparecimento'
  | 'documento_final'
  | 'comprovante_compra'
  | 'resumo_pedido'
  | 'relatorio_empresarial'
  | 'autorizacao_envio_resultados'
  | 'comprovante_agendamento'
  | 'contrato_empresa';

/** Procedencia do paciente: P (particular), E (estado), S (SISPER), I (ingresso). */
export type PatientOriginKind = 'particular' | 'estado' | 'sisper' | 'ingresso';

export interface Tenant {
  id: UUID;
  slug: string;
  legal_name: string;
  trade_name: string;
  document: string | null;
  is_active: boolean;
  primary_domain: string | null;
  timezone: string;
  locale: string;
  currency: string;
}

export interface TenantBranding {
  tenant_id: UUID;
  system_name: string;
  logo_url: string | null;
  logo_compact_url: string | null;
  favicon_url: string | null;
  color_primary: string;
  color_secondary: string;
  color_accent: string;
  color_sidebar: string;
  footer_text: string | null;
  pdf_header_html: string | null;
  pdf_footer_html: string | null;
  login_background_url: string | null;
  status_colors: Record<string, string>;
}

export interface TenantSetting {
  id: UUID;
  tenant_id: UUID;
  group_key: string;
  settings: Record<string, unknown>;
}

export interface TenantModule {
  tenant_id: UUID;
  module_key: string;
  is_enabled: boolean;
  config: Record<string, unknown>;
}

export interface Profile {
  id: UUID;
  tenant_id: UUID | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  job_title: string | null;
  council_type: string | null;
  council_number: string | null;
  council_state: string | null;
  signature_url: string | null;
  is_active: boolean;
  is_platform_admin: boolean;
  blocked_at: string | null;
  last_sign_in_at: string | null;
  must_change_password: boolean;
}

export interface Role {
  id: UUID;
  tenant_id: UUID | null;
  code: string;
  name: string;
  description: string | null;
  is_system: boolean;
}

export interface PermissionDef {
  code: string;
  module: string;
  name: string;
  description: string | null;
  is_sensitive: boolean;
}

export interface Company {
  id: UUID;
  tenant_id: UUID;
  legal_name: string;
  trade_name: string | null;
  document: string | null;
  segment: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  email_admin: string | null;
  email_commercial: string | null;
  responsible_name: string | null;
  responsible_role: string | null;
  situation: string;
  /** Falso dispensa a ficha clinica: sai apenas o A.S.O. e os laudos. */
  emite_ficha_clinica: boolean;
  allow_marketing: boolean;
  legal_basis: string | null;
  last_campaign_at: string | null;
  last_attendance_at: string | null;
  employees_served: number;
  notes: string | null;
  origin: DataOrigin;
  created_at: string;
}

export interface Patient {
  id: UUID;
  tenant_id: UUID;
  full_name: string;
  social_name: string | null;
  cpf: string | null;
  rg: string | null;
  external_document: string | null;
  birth_date: string | null;
  gender: Gender;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  zip_code: string | null;
  street: string | null;
  number: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  company_id: UUID | null;
  job_title: string | null;
  department: string | null;
  registration_number: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  notes: string | null;
  origin: DataOrigin;
  needs_review: boolean;
  created_at: string;
  updated_at: string;
}

export interface ExamType {
  id: UUID;
  tenant_id: UUID;
  code: string;
  name: string;
  description: string | null;
  average_minutes: number;
  default_room_id: UUID | null;
  instructions: string | null;
  preparation: string | null;
  sort_order: number;
  price: number | null;
  available_online: boolean;
  requires_result_document: boolean;
  is_active: boolean;
}

export interface Room {
  id: UUID;
  tenant_id: UUID;
  code: string;
  name: string;
  kind: string;
  capacity: number;
  status: RoomStatus;
  responsible_id: UUID | null;
  current_attendance_id: UUID | null;
  is_active: boolean;
  sort_order: number;
}

export interface Appointment {
  id: UUID;
  tenant_id: UUID;
  patient_id: UUID;
  company_id: UUID | null;
  order_id: UUID | null;
  scheduled_at: string;
  scheduled_date: string;
  duration_minutes: number;
  attendance_kind: string;
  priority: Priority;
  status: AppointmentStatus;
  professional_id: UUID | null;
  room_id: UUID | null;
  origin: DataOrigin;
  external_id: string | null;
  notes: string | null;
}

export interface Attendance {
  id: UUID;
  tenant_id: UUID;
  appointment_id: UUID | null;
  patient_id: UUID;
  company_id: UUID | null;
  order_id: UUID | null;
  attendance_number: number | null;
  stage_code: string;
  priority: Priority;
  needs_triage: boolean;
  checkin_at: string;
  reception_started_at: string | null;
  triage_started_at: string | null;
  triage_finished_at: string | null;
  exams_started_at: string | null;
  exams_finished_at: string | null;
  consultation_started_at: string | null;
  consultation_finished_at: string | null;
  finished_at: string | null;
  exit_at: string | null;
  cancelled_at: string | null;
  absent_at: string | null;
  current_room_id: UUID | null;
  in_service: boolean;
  payment_status: PaymentStatus;
  stage_changed_at: string;
  notes: string | null;
}

export interface QueueTicket {
  id: UUID;
  tenant_id: UUID;
  attendance_id: UUID | null;
  patient_id: UUID | null;
  prefix: string;
  sequence: number;
  code: string;
  ticket_type: Priority;
  service_date: string;
  issued_at: string;
}

export interface PatientExam {
  id: UUID;
  tenant_id: UUID;
  attendance_id: UUID;
  patient_id: UUID;
  exam_type_id: UUID;
  room_id: UUID | null;
  professional_id: UUID | null;
  status: ExamStatus;
  priority: Priority;
  queued_at: string | null;
  called_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_seconds: number | null;
  not_performed_reason: string | null;
  sort_order: number;
  notes: string | null;
}

export interface Triage {
  id: UUID;
  tenant_id: UUID;
  attendance_id: UUID;
  patient_id: UUID;
  professional_id: UUID | null;
  blood_pressure_systolic: number | null;
  blood_pressure_diastolic: number | null;
  temperature_c: number | null;
  weight_kg: number | null;
  height_cm: number | null;
  bmi: number | null;
  heart_rate: number | null;
  respiratory_rate: number | null;
  oxygen_saturation: number | null;
  /** Campos descontinuados; mantidos para leitura do historico. */
  symptoms: string | null;
  alerts: string | null;
  restrictions: string | null;
  /** Acuidade visual por olho, anotada na triagem. */
  acuidade_od: string | null;
  acuidade_oe: string | null;
  diabetes: boolean | null;
  hipertenso: boolean | null;
  observations: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface MedicalConsultation {
  id: UUID;
  tenant_id: UUID;
  attendance_id: UUID;
  patient_id: UUID;
  doctor_id: UUID | null;
  chief_complaint: string | null;
  anamnesis: string | null;
  clinical_history: string | null;
  personal_history: string | null;
  family_history: string | null;
  medications: string | null;
  allergies: string | null;
  physical_exam: string | null;
  diagnosis: string | null;
  conclusion: string | null;
  conduct: string | null;
  recommendations: string | null;
  verdict: MedicalVerdict | null;
  restrictions: string | null;
  valid_until: string | null;
  observations: string | null;
  /** Blocos de selecao da ficha clinica. */
  antecedentes_profissionais: Record<string, string> | null;
  antecedentes_pessoais: Record<string, string> | null;
  estilo_vida: Record<string, string> | null;
  exame_fisico: Record<string, string> | null;
  alteracoes_exame_fisico: string | null;
  /** Respostas do psicossocial; vazio quando o exame nao foi solicitado. */
  psicossocial: Record<string, string> | null;
  started_at: string;
  finished_at: string | null;
}

export interface Payment {
  id: UUID;
  tenant_id: UUID;
  attendance_id: UUID | null;
  order_id: UUID | null;
  patient_id: UUID | null;
  company_id: UUID | null;
  reference: string | null;
  description: string | null;
  amount: number;
  discount: number;
  net_amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  due_date: string | null;
  paid_at: string | null;
  refunded_at: string | null;
  refund_amount: number | null;
  provider: string;
  created_at: string;
}

export interface Product {
  id: UUID;
  tenant_id: UUID;
  category_id: UUID | null;
  kind: ProductKind;
  slug: string;
  code: string | null;
  sku: string | null;
  name: string;
  short_description: string | null;
  description: string | null;
  image_url: string | null;
  price: number;
  promo_price: number | null;
  promo_starts_at: string | null;
  promo_ends_at: string | null;
  stock: number | null;
  duration_minutes: number | null;
  requires_scheduling: boolean;
  unit: string;
  is_featured: boolean;
  sort_order: number;
  is_active: boolean;
}

export interface Order {
  id: UUID;
  tenant_id: UUID;
  order_number: string;
  status: OrderStatus;
  buyer_kind: string;
  buyer_name: string;
  buyer_document: string | null;
  buyer_email: string | null;
  buyer_phone: string | null;
  company_id: UUID | null;
  subtotal: number;
  discount: number;
  total: number;
  payment_method: PaymentMethod | null;
  payment_status: PaymentStatus;
  requires_scheduling: boolean;
  scheduling_done: boolean;
  created_at: string;
}

export interface OrderItem {
  id: UUID;
  tenant_id: UUID;
  order_id: UUID;
  product_id: UUID | null;
  patient_id: UUID | null;
  beneficiary_name: string | null;
  beneficiary_document: string | null;
  beneficiary_birth_date: string | null;
  product_name: string;
  product_kind: ProductKind;
  quantity: number;
  unit_price: number;
  discount: number;
  total: number;
  requires_scheduling: boolean;
  appointment_id: UUID | null;
  fulfillment_status: string;
}

export interface ScraperConnectorSafe {
  id: UUID;
  tenant_id: UUID;
  code: string;
  name: string;
  kind: string;
  base_url: string | null;
  agenda_url: string | null;
  auth_kind: string;
  username: string | null;
  has_password: boolean;
  extra_fields: Record<string, unknown>;
  navigation_rules: Record<string, unknown>;
  pagination_rules: Record<string, unknown>;
  date_filter_rules: Record<string, unknown>;
  timezone: string;
  schedule_cron: string | null;
  run_mode: string;
  auto_approve: boolean;
  authorization_confirmed: boolean;
  is_active: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
}

export interface ScraperRun {
  id: UUID;
  tenant_id: UUID;
  connector_id: UUID;
  status: ScraperRunStatus;
  trigger: string;
  reference_date: string | null;
  started_at: string | null;
  finished_at: string | null;
  collected_count: number;
  new_patients: number;
  updated_patients: number;
  new_companies: number;
  new_appointments: number;
  updated_appointments: number;
  duplicates_count: number;
  error_count: number;
  error_message: string | null;
  created_at: string;
}

export interface EmailCampaign {
  id: UUID;
  tenant_id: UUID;
  name: string;
  subject: string;
  body_html: string;
  body_text: string;
  status: CampaignStatus;
  mode: string;
  generated_by: string;
  scheduled_for: string | null;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  created_at: string;
}

export interface CrmStage {
  id: UUID;
  tenant_id: UUID;
  code: string;
  name: string;
  color: string;
  sort_order: number;
  is_terminal: boolean;
  is_active: boolean;
}

export interface AuditLog {
  id: number;
  tenant_id: UUID | null;
  user_id: UUID | null;
  user_name: string | null;
  action: string;
  entity: string;
  entity_id: UUID | null;
  description: string | null;
  origin: string;
  is_automatic: boolean;
  ip_address: string | null;
  created_at: string;
}
