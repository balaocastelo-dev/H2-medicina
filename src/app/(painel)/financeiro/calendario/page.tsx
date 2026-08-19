import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Card, StatCard } from '@/components/ui';
import { formatMoney, todayISO } from '@/lib/format';
import {
  agruparPorMes,
  montarCalendario,
  periodoDaVisao,
  type MovimentoFinanceiro,
  type Visao,
} from '@/modules/finance/repasse';
import { GradeCalendario, SeletorDeVisao } from './grade';

export const dynamic = 'force-dynamic';

const VISOES: Visao[] = ['dia', 'semana', 'mes', 'ano'];

export default async function CalendarioFinanceiroPage({
  searchParams,
}: {
  searchParams: Promise<{ visao?: string; data?: string }>;
}) {
  const ctx = await requirePermission('financeiro.ver');
  const sp = await searchParams;

  const visao = (VISOES as string[]).includes(sp.visao ?? '') ? (sp.visao as Visao) : 'mes';
  const referencia = /^\d{4}-\d{2}-\d{2}$/.test(sp.data ?? '') ? sp.data! : todayISO();
  const { inicio, fim } = periodoDaVisao(visao, referencia);

  const supabase = await createClient();
  const [pagamentos, contas, repasses] = await Promise.all([
    supabase
      .from('payments')
      .select('amount, net_amount, status, due_date, paid_at, created_at')
      .eq('tenant_id', ctx.tenant.id)
      .is('deleted_at', null)
      .returns<
        {
          net_amount: number;
          status: string;
          due_date: string | null;
          paid_at: string | null;
          created_at: string;
        }[]
      >(),
    supabase
      .from('payables')
      .select('amount, due_date, status')
      .eq('tenant_id', ctx.tenant.id)
      .is('deleted_at', null)
      .gte('due_date', inicio)
      .lte('due_date', fim)
      .returns<{ amount: number; due_date: string; status: string }[]>(),
    supabase
      .from('fee_entries')
      .select('fee, competencia, status, created_at')
      .eq('tenant_id', ctx.tenant.id)
      .neq('status', 'cancelado')
      .returns<{ fee: number; competencia: string; status: string; created_at: string }[]>(),
  ]);

  // Cada lancamento entra no dia em que o dinheiro se movimenta de fato:
  // recebido na data do pagamento, a receber no vencimento.
  const movimentos: MovimentoFinanceiro[] = [];

  for (const p of pagamentos.data ?? []) {
    if (p.status === 'pago') {
      movimentos.push({ data: (p.paid_at ?? p.created_at).slice(0, 10), tipo: 'recebido', valor: p.net_amount });
    } else if (['pendente', 'em_analise'].includes(p.status)) {
      movimentos.push({
        data: (p.due_date ?? p.created_at).slice(0, 10),
        tipo: 'a_receber',
        valor: p.net_amount,
      });
    }
  }

  for (const c of contas.data ?? []) {
    if (c.status === 'cancelada') continue;
    movimentos.push({ data: c.due_date, tipo: 'a_pagar', valor: c.amount });
  }

  for (const r of repasses.data ?? []) {
    movimentos.push({ data: r.created_at.slice(0, 10), tipo: 'repasse', valor: r.fee });
  }

  const dias = montarCalendario(inicio, fim, movimentos);
  const meses = visao === 'ano' ? agruparPorMes(dias) : [];
  const soma = (campo: 'recebido' | 'aReceber' | 'aPagar' | 'repasse') =>
    dias.reduce((s, d) => s + d[campo], 0);

  const saldo = soma('recebido') - soma('aPagar') - soma('repasse');

  return (
    <div>
      <PageHeader
        title="Calendário financeiro"
        description="Entradas, contas e repasse por dia, semana, mês e ano"
      />

      <div className="mb-4">
        <SeletorDeVisao visao={visao} referencia={referencia} inicio={inicio} fim={fim} />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Recebido" value={formatMoney(soma('recebido'))} color="#22C55E" />
        <StatCard label="A receber" value={formatMoney(soma('aReceber'))} color="#38BDF8" />
        <StatCard label="Contas a pagar" value={formatMoney(soma('aPagar'))} color="#FB923C" />
        <StatCard label="Repasse médico" value={formatMoney(soma('repasse'))} color="#A78BFA" />
        <StatCard label="Saldo" value={formatMoney(saldo)} color={saldo >= 0 ? '#22C55E' : '#EF4444'} />
      </div>

      <Card className="p-3">
        <GradeCalendario visao={visao} dias={dias} meses={meses} />
      </Card>

      <p className="mt-3 text-xs text-slate-400">
        Recebido entra na data do pagamento; a receber, no vencimento. O saldo desconta contas e
        repasse.
      </p>
    </div>
  );
}
