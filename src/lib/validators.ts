import { z } from 'zod';
import { onlyDigits } from './format';

/** Validacao real de CPF (mesma regra do banco). */
export function isValidCPF(value: string | null | undefined): boolean {
  const d = onlyDigits(value);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(d[i]) * (10 - i);
  let rest = (sum * 10) % 11;
  if (rest === 10) rest = 0;
  if (rest !== Number(d[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(d[i]) * (11 - i);
  rest = (sum * 10) % 11;
  if (rest === 10) rest = 0;
  return rest === Number(d[10]);
}

/** Validacao real de CNPJ (mesma regra do banco). */
export function isValidCNPJ(value: string | null | undefined): boolean {
  const d = onlyDigits(value);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (len: number) => {
    const weights =
      len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (weights[i] ?? 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

export const cpfSchema = z
  .string()
  .transform(onlyDigits)
  .refine((v) => v === '' || isValidCPF(v), 'CPF inválido');

export const cnpjSchema = z
  .string()
  .transform(onlyDigits)
  .refine((v) => v === '' || isValidCNPJ(v), 'CNPJ inválido');

export const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

/**
 * Sigla do conselho — CRM, CRO, COREN...
 *
 * Campo pequeno com consequencia grande: no A.S.O. esta sigla e o ROTULO da
 * linha do registro, entao um numero digitado aqui sai impresso como nome do
 * campo. Em 06/10 um A.S.O. saiu com "27786: 79775 / SP" por causa disso.
 *
 * O documento ja se protege (`siglaDoConselho`, em lib/conselho.ts), mas o
 * cadastro recusa na entrada: e aqui que da para avisar quem digitou. O
 * numero do registro tem campo proprio, ao lado.
 */
export const conselhoSchema = optionalText.refine(
  (v) => v === null || v === undefined || !/\d/.test(v),
  'O conselho é a sigla (CRM, CRO, COREN). O número vai no campo ao lado.',
);

export const emailSchema = z
  .string()
  .trim()
  .email('E-mail inválido')
  .or(z.literal(''))
  .transform((v) => (v === '' ? null : v.toLowerCase()));

export const ufSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, 'UF inválida')
  .or(z.literal(''))
  .transform((v) => (v === '' ? null : v));

export const patientSchema = z.object({
  full_name: z.string().trim().min(3, 'Informe o nome completo'),
  social_name: optionalText,
  cpf: cpfSchema.optional().nullable(),
  rg: optionalText,
  birth_date: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  gender: z.enum(['masculino', 'feminino', 'outro', 'nao_informado']).default('nao_informado'),
  phone: optionalText,
  whatsapp: optionalText,
  email: emailSchema.optional().nullable(),
  zip_code: optionalText,
  street: optionalText,
  number: optionalText,
  complement: optionalText,
  district: optionalText,
  city: optionalText,
  state: ufSchema.optional().nullable(),
  company_id: z.string().uuid().nullable().optional(),
  job_title: optionalText,
  department: optionalText,
  registration_number: optionalText,
  /** Perigos e fatores de risco deste empregado; sai impresso no A.S.O. */
  occupational_risks: optionalText,
  emergency_contact_name: optionalText,
  emergency_contact_phone: optionalText,
  notes: optionalText,
});
export type PatientInput = z.infer<typeof patientSchema>;

export const companySchema = z.object({
  legal_name: z.string().trim().min(3, 'Informe a razao social'),
  trade_name: optionalText,
  document: cnpjSchema.optional().nullable(),
  state_registration: optionalText,
  segment: optionalText,
  zip_code: optionalText,
  street: optionalText,
  number: optionalText,
  complement: optionalText,
  district: optionalText,
  city: optionalText,
  state: ufSchema.optional().nullable(),
  phone: optionalText,
  whatsapp: optionalText,
  website: optionalText,
  email: emailSchema.optional().nullable(),
  email_admin: emailSchema.optional().nullable(),
  email_financial: emailSchema.optional().nullable(),
  email_commercial: emailSchema.optional().nullable(),
  responsible_name: optionalText,
  responsible_role: optionalText,
  situation: z.enum(['ativa', 'inativa', 'prospect', 'bloqueada']).default('ativa'),
  legal_basis: optionalText,
  allow_marketing: z.boolean().default(false),
  emite_ficha_clinica: z.boolean().default(true),
  // Responsavel pelo PCMSO desta empresa, impresso no A.S.O.
  pcmso_doctor_name: optionalText,
  pcmso_doctor_council: conselhoSchema,
  pcmso_doctor_number: optionalText,
  pcmso_doctor_state: ufSchema.optional().nullable(),
  notes: optionalText,
});
export type CompanyInput = z.infer<typeof companySchema>;

export const appointmentSchema = z.object({
  patient_id: z.string().uuid('Selecione o paciente'),
  company_id: z.string().uuid().nullable().optional(),
  scheduled_at: z.string().min(10, 'Informe data e hora'),
  duration_minutes: z.coerce.number().int().min(5).max(480).default(30),
  attendance_kind: z.string().default('admissional'),
  priority: z.enum(['normal', 'prioritario', 'encaixe']).default('normal'),
  professional_id: z.string().uuid().nullable().optional(),
  exam_type_ids: z.array(z.string().uuid()).default([]),
  notes: optionalText,
});
export type AppointmentInput = z.infer<typeof appointmentSchema>;

/**
 * Faixa de valor na triagem: sem teto e sem piso clinico.
 *
 *     06/10 08:35 - Isa: sabe aqueles limites de valores da triagem?
 *                        precisa tirar esses limites
 *
 * A triagem ANOTA o que o aparelho mostrou — ela nao julga. Peso de 420 kg,
 * PA de 310, temperatura de 46: quem recusa isso nao protege ninguem, so
 * impede a enfermagem de registrar o que mediu, e o valor acaba indo para o
 * campo de observacoes, onde o medico nao procura e o laudo nao le.
 *
 * O que sobra e so o que o banco e a folha exigem: numero de verdade,
 * nao-negativo, e um teto absurdo (um milhao) para a linha nao estourar a
 * largura da coluna no papel nem o `numeric` da coluna.
 */
const valorDeTriagem = z.coerce
  .number()
  .min(0, 'Não pode ser negativo')
  .max(1_000_000, 'Valor fora de qualquer escala — confira o que foi digitado')
  .nullable()
  .optional();

/** Igual ao de cima, mas inteiro: batimentos, respiracoes, PA, SpO2. */
const inteiroDeTriagem = z.coerce
  .number()
  .int('Use um número inteiro')
  .min(0, 'Não pode ser negativo')
  .max(1_000_000, 'Valor fora de qualquer escala — confira o que foi digitado')
  .nullable()
  .optional();

export const triageSchema = z.object({
  attendance_id: z.string().uuid(),
  blood_pressure_systolic: inteiroDeTriagem,
  blood_pressure_diastolic: inteiroDeTriagem,
  temperature_c: valorDeTriagem,
  weight_kg: valorDeTriagem,
  height_cm: valorDeTriagem,
  heart_rate: inteiroDeTriagem,
  respiratory_rate: inteiroDeTriagem,
  oxygen_saturation: inteiroDeTriagem,
  // Acuidade visual anotada por olho, no formato usado na clinica (20/20).
  acuidade_od: optionalText,
  acuidade_oe: optionalText,
  // Condicoes que mudam a conduta do exame ocupacional.
  diabetes: z.boolean().nullable().optional(),
  hipertenso: z.boolean().nullable().optional(),
  observations: optionalText,
});

export type TriageInput = z.infer<typeof triageSchema>;

export const consultationSchema = z.object({
  attendance_id: z.string().uuid(),
  chief_complaint: optionalText,
  anamnesis: optionalText,
  clinical_history: optionalText,
  personal_history: optionalText,
  family_history: optionalText,
  medications: optionalText,
  allergies: optionalText,
  physical_exam: optionalText,
  diagnosis: optionalText,
  conclusion: optionalText,
  conduct: optionalText,
  recommendations: optionalText,
  verdict: z.enum(['apto', 'apto_com_restricoes', 'inapto', 'inconclusivo']).nullable().optional(),
  // Aptidoes adicionais, separadas da conclusao: NR-35 e NR-10 nao
  // substituem "apto para a funcao", somam-se a ela.
  apto_altura: z.boolean().default(false),
  apto_eletricidade: z.boolean().default(false),
  restrictions: optionalText,
  valid_until: z.string().nullable().optional(),
  observations: optionalText,
});
export type ConsultationInput = z.infer<typeof consultationSchema>;

export const productSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome'),
  slug: z.string().trim().min(2),
  kind: z.enum([
    'exame',
    'consulta',
    'pacote',
    'servico',
    'servico_empresarial',
    'avaliacao',
    'produto_fisico',
    'combo',
  ]),
  category_id: z.string().uuid().nullable().optional(),
  code: optionalText,
  sku: optionalText,
  short_description: optionalText,
  description: optionalText,
  price: z.coerce.number().min(0),
  promo_price: z.coerce.number().min(0).nullable().optional(),
  stock: z.coerce.number().int().nullable().optional(),
  duration_minutes: z.coerce.number().int().nullable().optional(),
  requires_scheduling: z.boolean().default(false),
  is_featured: z.boolean().default(false),
  is_active: z.boolean().default(true),
  exam_type_ids: z.array(z.string().uuid()).default([]),
});
export type ProductInput = z.infer<typeof productSchema>;

export const couponSchema = z.object({
  code: z.string().trim().min(3).toUpperCase(),
  description: optionalText,
  discount_kind: z.enum(['percentual', 'valor']),
  discount_value: z.coerce.number().min(0),
  minimum_amount: z.coerce.number().min(0).default(0),
  starts_at: z.string().nullable().optional(),
  ends_at: z.string().nullable().optional(),
  total_limit: z.coerce.number().int().nullable().optional(),
  per_buyer_limit: z.coerce.number().int().nullable().optional(),
  is_active: z.boolean().default(true),
});
export type CouponInput = z.infer<typeof couponSchema>;
