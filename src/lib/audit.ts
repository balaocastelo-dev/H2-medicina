import 'server-only';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import type { SessionContext } from '@/lib/auth';

export interface AuditInput {
  action:
    | 'create'
    | 'update'
    | 'delete'
    | 'view'
    | 'login'
    | 'logout'
    | 'export'
    | 'print'
    | 'send'
    | 'approve'
    | 'refund';
  entity: string;
  entityId?: string | null;
  description?: string;
  patientId?: string | null;
  companyId?: string | null;
  orderId?: string | null;
  previous?: unknown;
  next?: unknown;
  isAutomatic?: boolean;
  origin?: string;
}

/**
 * Registra auditoria. Nunca lanca excecao: falha de log nao pode
 * derrubar a operacao de negocio (mas e reportada no console do servidor).
 */
export async function audit(ctx: SessionContext, input: AuditInput): Promise<void> {
  try {
    const supabase = await createClient();
    const h = await headers();
    const forwarded = h.get('x-forwarded-for');
    const ip = forwarded ? forwarded.split(',')[0]?.trim() : null;

    await supabase.from('audit_logs').insert({
      tenant_id: ctx.tenant.id,
      user_id: ctx.userId,
      user_name: ctx.profile.full_name,
      user_roles: ctx.roles,
      action: input.action,
      entity: input.entity,
      entity_id: input.entityId ?? null,
      patient_id: input.patientId ?? null,
      company_id: input.companyId ?? null,
      order_id: input.orderId ?? null,
      description: input.description ?? null,
      previous_value: input.previous ?? null,
      new_value: input.next ?? null,
      origin: input.origin ?? 'app',
      is_automatic: input.isAutomatic ?? false,
      ip_address: ip,
      user_agent: h.get('user-agent'),
    });
  } catch (error) {
    console.error('[audit] falha ao registrar log:', error);
  }
}

/** Log especifico de acesso a dado clinico (exigencia LGPD). */
export async function auditClinicalAccess(
  ctx: SessionContext,
  patientId: string,
  context: 'prontuario' | 'exame' | 'documento' | 'triagem' | 'consulta',
  referenceId?: string,
): Promise<void> {
  try {
    const supabase = await createClient();
    const h = await headers();
    const forwarded = h.get('x-forwarded-for');
    await supabase.from('clinical_access_logs').insert({
      tenant_id: ctx.tenant.id,
      user_id: ctx.userId,
      patient_id: patientId,
      context,
      reference_id: referenceId ?? null,
      ip_address: forwarded ? forwarded.split(',')[0]?.trim() : null,
      user_agent: h.get('user-agent'),
    });
  } catch (error) {
    console.error('[audit] falha no log clinico:', error);
  }
}
