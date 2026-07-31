import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardHeader, EmptyState, StatCard, Table, Td, Th } from '@/components/ui';
import { daysAgoISO, formatDuration, formatMoney, todayISO } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string }>;
}) {
  const ctx = await requirePermission('relatorios.ver');
  const sp = await searchParams;
  const from = sp.de ?? daysAgoISO(30);
  const to = sp.ate ?? todayISO();
  const supabase = await createClient();

  const [attendancesRes, examsRes, paymentsRes] = await Promise.all([
    supabase
      .from('attendances')
      .select('id, checkin_at, finished_at, stage_code, companies(trade_name, legal_name)')
      .eq('tenant_id', ctx.tenant.id)
      .gte('checkin_at', `${from}T00:00:00`)
      .lte('checkin_at', `${to}T23:59:59`)
      .is('deleted_at', null)
      .returns<
        {
          id: string;
          checkin_at: string;
          finished_at: string | null;
          stage_code: string;
          companies: { trade_name: string | null; legal_name: string } | null;
        }[]
      >(),
    supabase
      .from('patient_exams')
      .select('id, status, duration_seconds, exam_types(name)')
      .eq('tenant_id', ctx.tenant.id)
      .gte('created_at', `${from}T00:00:00`)
      .returns<
        {
          id: string;
          status: string;
          duration_seconds: number | null;
          exam_types: { name: string } | null;
        }[]
      >(),
    ctx.permissions.has('financeiro.ver')
      ? supabase
          .from('payments')
          .select('status, net_amount, method')
          .eq('tenant_id', ctx.tenant.id)
          .gte('created_at', `${from}T00:00:00`)
          .is('deleted_at', null)
          .returns<{ status: string; net_amount: number; method: string }[]>()
      : Promise.resolve({ data: [] as { status: string; net_amount: number; method: string }[] }),
  ]);

  const attendances = attendancesRes.data ?? [];
  const exams = examsRes.data ?? [];
  const payments = paymentsRes.data ?? [];

  const finished = attendances.filter((a) => a.finished_at);
  const avgJourney =
    finished.length > 0
      ? finished.reduce(
          (sum, a) =>
            sum + (new Date(a.finished_at!).getTime() - new Date(a.checkin_at).getTime()) / 1000,
          0,
        ) / finished.length
      : 0;

  const byCompany = new Map<string, number>();
  for (const a of attendances) {
    const key = a.companies?.trade_name ?? a.companies?.legal_name ?? 'Sem empresa';
    byCompany.set(key, (byCompany.get(key) ?? 0) + 1);
  }

  const byExam = new Map<string, { total: number; done: number; seconds: number }>();
  for (const e of exams) {
    const key = e.exam_types?.name ?? 'Outro';
    const entry = byExam.get(key) ?? { total: 0, done: 0, seconds: 0 };
    entry.total += 1;
    if (e.status === 'concluido') entry.done += 1;
    entry.seconds += e.duration_seconds ?? 0;
    byExam.set(key, entry);
  }

  const revenue = payments
    .filter((p) => p.status === 'pago')
    .reduce((s, p) => s + Number(p.net_amount), 0);

  return (
    <div>
      <PageHeader title="Relatorios" description={`Periodo de ${from} a ${to}`} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Atendimentos" value={attendances.length} />
        <StatCard label="Finalizados" value={finished.length} color="#22C55E" />
        <StatCard label="Tempo medio de jornada" value={formatDuration(avgJourney)} />
        {ctx.permissions.has('financeiro.ver') && (
          <StatCard label="Faturamento" value={formatMoney(revenue)} color="#0EA5E9" />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Atendimentos por empresa" />
          {byCompany.size === 0 ? (
            <EmptyState title="Sem dados no periodo" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Empresa</Th>
                  <Th>Atendimentos</Th>
                </tr>
              </thead>
              <tbody>
                {Array.from(byCompany.entries())
                  .sort((a, b) => b[1] - a[1])
                  .map(([name, total]) => (
                    <tr key={name}>
                      <Td>{name}</Td>
                      <Td className="font-medium">{total}</Td>
                    </tr>
                  ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title="Produtividade por exame" />
          {byExam.size === 0 ? (
            <EmptyState title="Sem exames no periodo" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Exame</Th>
                  <Th>Total</Th>
                  <Th>Concluidos</Th>
                  <Th>Tempo medio</Th>
                </tr>
              </thead>
              <tbody>
                {Array.from(byExam.entries()).map(([name, e]) => (
                  <tr key={name}>
                    <Td>{name}</Td>
                    <Td>{e.total}</Td>
                    <Td>{e.done}</Td>
                    <Td>{e.done ? formatDuration(e.seconds / e.done) : '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
