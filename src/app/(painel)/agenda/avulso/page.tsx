import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { FormularioAvulso } from './formulario';

export const dynamic = 'force-dynamic';

export default async function AgendamentoAvulsoPage() {
  const ctx = await requirePermission('agenda.administrar');
  const supabase = await createClient();

  const [companiesRes, examsRes] = await Promise.all([
    supabase
      .from('companies')
      .select('id, legal_name, trade_name')
      .eq('tenant_id', ctx.tenant.id)
      .eq('situation', 'ativa')
      .is('deleted_at', null)
      .order('legal_name')
      .returns<{ id: string; legal_name: string; trade_name: string | null }[]>(),
    supabase
      .from('exam_types')
      .select('id, name, code, price, average_minutes')
      .eq('tenant_id', ctx.tenant.id)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('sort_order')
      .returns<
        { id: string; name: string; code: string; price: number | null; average_minutes: number }[]
      >(),
  ]);

  return (
    <div>
      <PageHeader
        title="Agendamento avulso — empresa"
        description="Cadastre e agende exames e consultas de funcionários no fluxo particular (P)"
      />
      <FormularioAvulso
        companies={(companiesRes.data ?? []).map((c) => ({
          id: c.id,
          label: c.trade_name ?? c.legal_name,
        }))}
        examTypes={examsRes.data ?? []}
      />
    </div>
  );
}
