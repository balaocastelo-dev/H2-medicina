import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Card, EmptyState } from '@/components/ui';
import { startOfTodayISO } from '@/lib/format';
import { CrmBoard } from './board';
import type { CrmStage } from '@/types/entities';

export const dynamic = 'force-dynamic';

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

export default async function CrmPage() {
  const ctx = await requirePermission('agenda.ver');
  const supabase = await createClient();

  const [stagesRes, cardsRes] = await Promise.all([
    supabase
      .from('crm_stages')
      .select('*')
      .eq('tenant_id', ctx.tenant.id)
      .eq('is_active', true)
      .order('sort_order')
      .returns<CrmStage[]>(),
    supabase
      .from('attendances')
      .select(
        'id, stage_code, priority, checkin_at, stage_changed_at, payment_status, order_id, notes, patients(id, full_name), companies(trade_name, legal_name), queue_tickets(code), patient_exams(id, status)',
      )
      .eq('tenant_id', ctx.tenant.id)
      .gte('checkin_at', startOfTodayISO())
      .is('deleted_at', null)
      .order('checkin_at')
      .returns<CrmCard[]>(),
  ]);

  const stages = stagesRes.data ?? [];
  const cards = cardsRes.data ?? [];

  return (
    <div>
      <PageHeader
        title="CRM do dia"
        description="Movimentacao automatica conforme o paciente avanca na jornada"
      />
      {stages.length === 0 ? (
        <Card>
          <EmptyState
            title="Estagios nao configurados"
            description="Execute o seed do tenant ou cadastre os estagios do CRM."
          />
        </Card>
      ) : (
        <CrmBoard stages={stages} cards={cards} canMove={ctx.permissions.has('crm.mover_manual')} />
      )}
    </div>
  );
}
