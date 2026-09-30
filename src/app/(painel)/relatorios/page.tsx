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
      // `-03:00` explicito: sem o fuso, o Postgres le a string como UTC e a
      // janela real vira 21h a 20h59 de Sao Paulo — o relatorio perdia as
      // tres ultimas horas do ultimo dia e ganhava as tres ultimas do dia
      // anterior ao primeiro.
      .gte('checkin_at', `${from}T00:00:00-03:00`)
      .lte('checkin_at', `${to}T23:59:59-03:00`)
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
      .gte('created_at', `${from}T00:00:00-03:00`)
      // Faltava o `.lte`: escolher 01/08 a 15/08 trazia tudo de 01/08 ATE
      // HOJE, com o cabecalho dizendo "Periodo de 01/08 a 15/08". Fechava-se
      // um mes com numero de dois. O `-03:00` e obrigatorio: sem ele a
      // janela escorrega tres horas.
      .lte('created_at', `${to}T23:59:59-03:00`)
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
          .gte('created_at', `${from}T00:00:00-03:00`)
          // Mesmo `.lte` que faltava nos exames — aqui o numero e dinheiro.
          .lte('created_at', `${to}T23:59:59-03:00`)
          .is('deleted_at', null)
          .returns<{ status: string; net_amount: number; method: string }[]>()
      : Promise.resolve({ data: [] as { status: string; net_amount: number; method: string }[] }),
  ]);

  const attendances = attendancesRes.data ?? [];
  const exams = examsRes.data ?? [];
  const payments = paymentsRes.data ?? [];

  // Cancelado e ausente nao sao atendimento.
  //
  // As contagens usavam a lista inteira, e `finished_at` e gravado tambem
  // quando o paciente e marcado ausente no totem — entao um no-show entrava
  // como atendimento concluido, e a "jornada" dele era o tempo entre a
  // primeira chegada e a volta ao totem. Isso inflava os tres indicadores de
  // uma vez.
  const NAO_CONTAM = ['cancelado', 'ausente'];
  const realizados = attendances.filter((a) => !NAO_CONTAM.includes(a.stage_code));

  const finished = realizados.filter((a) => a.finished_at);
  const avgJourney =
    finished.length > 0
      ? finished.reduce(
          (sum, a) =>
            sum + (new Date(a.finished_at!).getTime() - new Date(a.checkin_at).getTime()) / 1000,
          0,
        ) / finished.length
      : 0;

  const cancelados = attendances.length - realizados.length;

  const byCompany = new Map<string, number>();
  for (const a of realizados) {
    const key = a.companies?.trade_name ?? a.companies?.legal_name ?? 'Sem empresa';
    byCompany.set(key, (byCompany.get(key) ?? 0) + 1);
  }

  const byExam = new Map<string, { total: number; done: number; seconds: number }>();
  for (const e of exams) {
    const key = e.exam_types?.name ?? 'Outro';
    const entry = byExam.get(key) ?? { total: 0, done: 0, seconds: 0 };
    entry.total += 1;
    // Somar a duracao so de quem entra no divisor.
    //
    // `duration_seconds` e gerado de started_at -> finished_at, e o sistema
    // grava `finished_at` tambem quando o exame e marcado "nao realizado".
    // Exame iniciado e abandonado somava no numerador e nao no denominador:
    // o tempo medio saia inflado, e ninguem entendia por que.
    if (e.status === 'concluido') {
      entry.done += 1;
      entry.seconds += e.duration_seconds ?? 0;
    }
    byExam.set(key, entry);
  }

  const revenue = payments
    .filter((p) => p.status === 'pago')
    .reduce((s, p) => s + Number(p.net_amount), 0);

  return (
    <div>
      <PageHeader title="Relatorios" description={`Periodo de ${from} a ${to}`} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Atendimentos"
          value={realizados.length}
          // A clinica precisa saber quantos cairam, e nao ver o numero cheio
          // sem saber que ha cancelados dentro.
          hint={cancelados > 0 ? `${cancelados} cancelado(s) ou ausente(s) fora da conta` : undefined}
        />
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
            <EmptyState title="Sem dados no período" />
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
            <EmptyState title="Sem exames no período" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Exame</Th>
                  <Th>Total</Th>
                  <Th>Concluídos</Th>
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
