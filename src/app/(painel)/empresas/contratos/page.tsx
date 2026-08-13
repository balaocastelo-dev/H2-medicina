import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardBody, EmptyState, StatCard } from '@/components/ui';
import { diasAteVencer, situacaoDoContrato } from '@/modules/companies/contract-template';
import { PainelContratos } from './painel';
import type { ContratoNaLista } from './tipos';

export const dynamic = 'force-dynamic';

export default async function ContratosPage() {
  const ctx = await requirePermission('empresas.ver');
  const supabase = await createClient();

  const [contratosRes, empresasRes, examesRes] = await Promise.all([
    supabase
      .from('company_contracts')
      .select(
        'id, name, code, kind, status, starts_on, ends_on, signed_on, pcmso_valid_until, employees_count, monthly_amount, amount, billing_day, readjustment_index, auto_renew, esocial_enabled, coordinator_name, coordinator_crm, schedule_email, billing_email, technical_hour_rate, late_fee_percent, late_interest_percent, credits_total, credits_used, notes, company_id, document_path, companies(legal_name, trade_name), company_contract_items(id, kind, name, exam_type_id, quantity_included, quantity_used, unit_price, extra_price)',
      )
      .eq('tenant_id', ctx.tenant.id)
      .is('deleted_at', null)
      .order('ends_on', { nullsFirst: false })
      .returns<ContratoNaLista[]>(),
    supabase
      .from('companies')
      .select('id, legal_name, trade_name')
      .eq('tenant_id', ctx.tenant.id)
      .is('deleted_at', null)
      .order('legal_name')
      .returns<{ id: string; legal_name: string; trade_name: string | null }[]>(),
    supabase
      .from('exam_types')
      .select('id, name, price')
      .eq('tenant_id', ctx.tenant.id)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('sort_order')
      .returns<{ id: string; name: string; price: number | null }[]>(),
  ]);

  const contratos = contratosRes.data ?? [];
  const ativos = contratos.filter((c) => c.status === 'ativo');
  const situacoes = ativos.map((c) => situacaoDoContrato(diasAteVencer(c.ends_on)));
  const vencendo = situacoes.filter((s) => s === 'critico' || s === 'atencao').length;
  const vencidos = situacoes.filter((s) => s === 'vencido').length;
  const faturamento = ativos.reduce((soma, c) => soma + Number(c.monthly_amount ?? 0), 0);

  return (
    <div>
      <PageHeader
        title="Contratos das empresas"
        description="Vigência, cota de exames, valores e convocação — tudo num lugar só"
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Contratos ativos" value={ativos.length} />
        <StatCard label="Vencendo em 60 dias" value={vencendo} color="#EAB308" />
        <StatCard label="Vencidos" value={vencidos} color="#EF4444" />
        <StatCard
          label="Mensalidade somada"
          value={`R$ ${faturamento.toFixed(2).replace('.', ',')}`}
          color="#22C55E"
        />
      </div>

      {contratos.length === 0 && empresasRes.data?.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              title="Nenhuma empresa cadastrada"
              description="Cadastre a empresa em Empresas antes de criar o contrato."
            />
          </CardBody>
        </Card>
      ) : (
        <PainelContratos
          contratos={contratos}
          empresas={(empresasRes.data ?? []).map((e) => ({
            id: e.id,
            label: e.trade_name ?? e.legal_name,
          }))}
          examTypes={examesRes.data ?? []}
        />
      )}
    </div>
  );
}
