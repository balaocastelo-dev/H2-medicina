import Link from 'next/link';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, Card, CardBody, CardHeader, EmptyState, StatCard } from '@/components/ui';
import { formatMoney, todayISO } from '@/lib/format';
import { agruparPorMedico, competenciaDe, type LancamentoRepasse } from '@/modules/finance/repasse';
import { BaixaDeRepasse, CatalogoProcedimentos, SeletorCompetencia } from './client';

export const dynamic = 'force-dynamic';

interface LinhaBanco {
  id: string;
  profile_id: string;
  procedure_name: string;
  fee: number;
  status: string;
  competencia: string;
  created_at: string;
  profiles: { full_name: string | null } | null;
  patients: { full_name: string } | null;
}

export default async function RepassePage({
  searchParams,
}: {
  searchParams: Promise<{ competencia?: string; medico?: string }>;
}) {
  const ctx = await requirePermission('financeiro.ver');
  const sp = await searchParams;
  const competencia = /^\d{4}-\d{2}$/.test(sp.competencia ?? '')
    ? `${sp.competencia}-01`
    : competenciaDe(todayISO());

  const supabase = await createClient();
  const [lancamentos, procedimentos] = await Promise.all([
    supabase
      .from('fee_entries')
      .select(
        'id, profile_id, procedure_name, fee, status, competencia, created_at, profiles(full_name), patients(full_name)',
      )
      .eq('tenant_id', ctx.tenant.id)
      .eq('competencia', competencia)
      .order('created_at', { ascending: false })
      .returns<LinhaBanco[]>(),
    supabase
      .from('procedure_types')
      .select('id, code, name, default_fee, sort_order, is_active')
      .eq('tenant_id', ctx.tenant.id)
      .order('sort_order')
      .returns<
        { id: string; code: string; name: string; default_fee: number; sort_order: number; is_active: boolean }[]
      >(),
  ]);

  const linhas = lancamentos.data ?? [];
  const paraCalculo: LancamentoRepasse[] = linhas.map((l) => ({
    profile_id: l.profile_id,
    medico: l.profiles?.full_name ?? 'Médico',
    procedure_name: l.procedure_name,
    fee: l.fee,
    status: l.status,
    competencia: l.competencia,
  }));

  const resumo = agruparPorMedico(paraCalculo);
  const totalGeral = resumo.reduce((s, m) => s + m.total, 0);
  const aPagar = resumo.reduce((s, m) => s + m.aPagar, 0);
  const podeBaixar = ctx.permissions.has('financeiro.registrar');

  return (
    <div>
      <PageHeader
        title="Repasse médico"
        description="Calculado a partir dos atendimentos finalizados de cada médico"
      />

      <div className="mb-4">
        <SeletorCompetencia competencia={competencia.slice(0, 7)} />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total da competência" value={formatMoney(totalGeral)} />
        <StatCard label="A pagar" value={formatMoney(aPagar)} color="#FB923C" />
        <StatCard label="Já pago" value={formatMoney(totalGeral - aPagar)} color="#22C55E" />
        <StatCard label="Atendimentos" value={linhas.length} />
      </div>

      {resumo.length === 0 ? (
        <Card>
          <EmptyState
            title="Nenhum repasse nesta competência"
            description="Os lançamentos nascem quando o médico finaliza a consulta."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {resumo.map((m) => {
            const doMedico = linhas.filter((l) => l.profile_id === m.profile_id);
            return (
              <Card key={m.profile_id}>
                <CardHeader
                  title={m.medico}
                  description={`${m.atendimentos} atendimento(s) · ${formatMoney(m.total)}`}
                  action={
                    <Link
                      href={`/usuarios/${m.profile_id}/repasse`}
                      className="text-xs text-slate-500 underline"
                    >
                      valores do médico
                    </Link>
                  }
                />
                <CardBody>
                  <div className="mb-3 flex flex-wrap gap-2">
                    {m.porProcedimento.map((p) => (
                      <Badge key={p.nome} color="#64748B">
                        {p.nome} · {p.quantidade}x · {formatMoney(p.valor)}
                      </Badge>
                    ))}
                  </div>

                  <div className="mb-3 flex flex-wrap gap-4 text-sm">
                    <span className="text-orange-600">A pagar {formatMoney(m.aPagar)}</span>
                    <span className="text-emerald-600">Pago {formatMoney(m.pago)}</span>
                  </div>

                  <BaixaDeRepasse
                    lancamentos={doMedico.map((l) => ({
                      id: l.id,
                      paciente: l.patients?.full_name ?? '—',
                      procedimento: l.procedure_name,
                      valor: Number(l.fee),
                      status: l.status,
                      data: l.created_at,
                    }))}
                    podeBaixar={podeBaixar}
                  />
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {ctx.permissions.has('financeiro.registrar') && (
        <div className="mt-6">
          <CatalogoProcedimentos procedimentos={procedimentos.data ?? []} />
        </div>
      )}
    </div>
  );
}
