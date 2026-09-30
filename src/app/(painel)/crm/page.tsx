import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Card, EmptyState } from '@/components/ui';
import { inicioDasPendenciasISO, startOfTodayISO } from '@/lib/format';
import { CrmBoard } from './board';
import type { CrmStage } from '@/types/entities';

import type { CrmCard } from './types';

export const dynamic = 'force-dynamic';

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
      // Trinta dias em vez de "hoje".
      //
      // O CRM e o lugar onde se vai PROCURAR o cartao que se perdeu, e era o
      // unico. Cortando em hoje, o atendimento que virou a noite em aberto
      // sumia daqui tambem, e com ele o unico caminho de volta: reabrir,
      // cancelar ou empurrar a etapa a mao. Ficava so a ficha do paciente,
      // que ninguem abre sem saber o nome.
      //
      // Terminado, cancelado e ausente de dias anteriores nao poluem o
      // quadro: as colunas terminais sao as ultimas, e o cartao carrega a
      // data de chegada.
      .gte('checkin_at', inicioDasPendenciasISO())
      .is('deleted_at', null)
      .order('checkin_at')
      .returns<CrmCard[]>(),
  ]);

  const stages = stagesRes.data ?? [];
  const cards = cardsRes.data ?? [];

  const hoje = startOfTodayISO();
  const deHoje = cards.filter((c) => c.checkin_at >= hoje).length;
  const anteriores = cards.length - deHoje;

  return (
    <div>
      <PageHeader
        title="CRM"
        description={
          anteriores > 0
            ? `${deHoje} de hoje e ${anteriores} de dias anteriores — movimentação automática conforme o paciente avanca na jornada`
            : 'Movimentação automática conforme o paciente avanca na jornada'
        }
      />
      {stages.length === 0 ? (
        <Card>
          <EmptyState
            title="Estagios não configurados"
            description="Execute o seed do tenant ou cadastre os estagios do CRM."
          />
        </Card>
      ) : (
        <CrmBoard stages={stages} cards={cards} canMove={ctx.permissions.has('crm.mover_manual')} />
      )}
    </div>
  );
}
