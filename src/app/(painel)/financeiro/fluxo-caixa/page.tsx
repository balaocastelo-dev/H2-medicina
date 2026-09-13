import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardBody, CardHeader, EmptyState, StatCard, Table, Td, Th } from '@/components/ui';
import { formatMoney, todayISO } from '@/lib/format';
import {
  evolucaoMensal,
  janelaDoPeriodo,
  porCategoria,
  resumirFluxo,
  type Movimento,
  type Periodo,
} from '@/modules/finance/fluxo-caixa';
import { SeletorDePeriodo } from './client';

export const dynamic = 'force-dynamic';

const PERIODOS: Periodo[] = ['dia', 'semana', 'mes', 'ano', 'personalizado'];

function nomeDoMes(mes: string): string {
  const [ano, m] = mes.split('-');
  if (!ano || !m) return mes;
  return new Intl.DateTimeFormat('pt-BR', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(Number(ano), Number(m) - 1, 1)));
}

/**
 * Fluxo de caixa e resultado do periodo.
 *
 * Mostra as duas leituras lado a lado — o que foi faturado e o que entrou
 * no caixa — porque um mes pode fechar com lucro e caixa negativo, e e
 * isso que a dona da clinica precisa enxergar antes de assumir despesa.
 */
export default async function FluxoDeCaixaPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; data?: string; de?: string; ate?: string }>;
}) {
  const ctx = await requirePermission('financeiro.ver');
  const sp = await searchParams;

  const periodo = (PERIODOS as string[]).includes(sp.periodo ?? '')
    ? (sp.periodo as Periodo)
    : 'mes';
  const referencia = /^\d{4}-\d{2}-\d{2}$/.test(sp.data ?? '') ? sp.data! : todayISO();
  const personalizado =
    /^\d{4}-\d{2}-\d{2}$/.test(sp.de ?? '') && /^\d{4}-\d{2}-\d{2}$/.test(sp.ate ?? '')
      ? { inicio: sp.de!, fim: sp.ate! }
      : undefined;

  const { inicio, fim } = janelaDoPeriodo(periodo, referencia, personalizado);

  const supabase = await createClient();
  const [pagamentos, contas, repasses] = await Promise.all([
    supabase
      .from('payments')
      .select('net_amount, status, due_date, paid_at, created_at, description')
      .eq('tenant_id', ctx.tenant.id)
      .is('deleted_at', null)
      .returns<
        {
          net_amount: number;
          status: string;
          due_date: string | null;
          paid_at: string | null;
          created_at: string;
          description: string | null;
        }[]
      >(),
    supabase
      .from('payables')
      .select('amount, category, due_date, status, paid_at')
      .eq('tenant_id', ctx.tenant.id)
      .is('deleted_at', null)
      .returns<
        {
          amount: number;
          category: string;
          due_date: string;
          status: string;
          paid_at: string | null;
        }[]
      >(),
    supabase
      .from('fee_entries')
      .select('fee, status, competencia, created_at, paid_at')
      .eq('tenant_id', ctx.tenant.id)
      .neq('status', 'cancelado')
      .returns<
        {
          fee: number;
          status: string;
          competencia: string;
          created_at: string;
          paid_at: string | null;
        }[]
      >(),
  ]);

  const movimentos: Movimento[] = [];

  for (const p of pagamentos.data ?? []) {
    if (['cancelado', 'estornado', 'falhou'].includes(p.status)) continue;
    movimentos.push({
      competencia: (p.due_date ?? p.created_at).slice(0, 10),
      pagoEm: p.status === 'pago' ? (p.paid_at ?? p.created_at).slice(0, 10) : null,
      tipo: 'receita',
      valor: p.net_amount,
      categoria: p.description?.trim() || 'Atendimento',
    });
  }

  for (const c of contas.data ?? []) {
    if (c.status === 'cancelada') continue;
    movimentos.push({
      competencia: c.due_date,
      pagoEm: c.status === 'paga' ? (c.paid_at ?? c.due_date).slice(0, 10) : null,
      tipo: 'despesa',
      valor: c.amount,
      categoria: c.category,
    });
  }

  for (const r of repasses.data ?? []) {
    movimentos.push({
      competencia: r.created_at.slice(0, 10),
      pagoEm: r.status === 'pago' ? (r.paid_at ?? r.created_at).slice(0, 10) : null,
      tipo: 'repasse',
      valor: r.fee,
      categoria: 'Repasse médico',
    });
  }

  const resumo = resumirFluxo(movimentos, inicio, fim);
  const despesasPorCategoria = porCategoria(movimentos, 'despesa', inicio, fim);
  const receitasPorCategoria = porCategoria(movimentos, 'receita', inicio, fim).slice(0, 8);
  const meses = evolucaoMensal(movimentos).slice(-12);
  const maiorMes = Math.max(1, ...meses.map((m) => Math.max(m.receita, m.despesa + m.repasse)));

  return (
    <div>
      <PageHeader
        title="Fluxo de caixa"
        description="O que foi faturado e o que entrou no caixa, lado a lado"
      />

      <div className="mb-4">
        <SeletorDePeriodo
          periodo={periodo}
          referencia={referencia}
          de={personalizado?.inicio ?? inicio}
          ate={personalizado?.fim ?? fim}
          inicio={inicio}
          fim={fim}
        />
      </div>

      <div className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
        Resultado do período
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Receita" value={formatMoney(resumo.receita)} color="#22C55E" />
        <StatCard label="Despesas" value={formatMoney(resumo.despesa)} color="#FB923C" />
        <StatCard label="Repasse médico" value={formatMoney(resumo.repasse)} color="#A78BFA" />
        <StatCard
          label="Resultado"
          value={formatMoney(resumo.resultado)}
          color={resumo.resultado >= 0 ? '#22C55E' : '#EF4444'}
          hint={resumo.margem !== null ? `margem de ${resumo.margem}%` : 'sem receita no período'}
        />
      </div>

      <div className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
        Caixa do período
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Entrou" value={formatMoney(resumo.entradas)} color="#22C55E" />
        <StatCard label="Saiu" value={formatMoney(resumo.saidas)} color="#EF4444" />
        <StatCard
          label="Saldo"
          value={formatMoney(resumo.saldoDeCaixa)}
          color={resumo.saldoDeCaixa >= 0 ? '#22C55E' : '#EF4444'}
        />
        <StatCard
          label="Pendente"
          value={formatMoney(resumo.aReceber - resumo.aPagar)}
          hint={`${formatMoney(resumo.aReceber)} a receber · ${formatMoney(resumo.aPagar)} a pagar`}
        />
      </div>

      {resumo.resultado > 0 && resumo.saldoDeCaixa < 0 && (
        <Card className="mb-4 border-l-4 border-l-amber-500">
          <CardBody className="text-sm">
            O período fechou com <strong>resultado positivo</strong> e{' '}
            <strong>caixa negativo</strong>: foi faturado mais do que se gastou, mas o dinheiro
            ainda não entrou. O que falta receber está em Cobranças.
          </CardBody>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Para onde foi o dinheiro" description="Despesas por categoria" />
          {despesasPorCategoria.length === 0 ? (
            <EmptyState title="Sem despesas no período" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Categoria</Th>
                  <Th>Valor</Th>
                  <Th className="w-32">Fatia</Th>
                </tr>
              </thead>
              <tbody>
                {despesasPorCategoria.map((l) => (
                  <tr key={l.categoria} className="hover:bg-slate-50">
                    <Td className="font-medium">{l.categoria}</Td>
                    <Td>{formatMoney(l.valor)}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-16 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-orange-400"
                            style={{ width: `${Math.min(100, l.fatia)}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-500">{l.fatia}%</span>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title="De onde veio" description="Receita por tipo de cobrança" />
          {receitasPorCategoria.length === 0 ? (
            <EmptyState title="Sem receita no período" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Origem</Th>
                  <Th>Valor</Th>
                  <Th className="w-20">Fatia</Th>
                </tr>
              </thead>
              <tbody>
                {receitasPorCategoria.map((l) => (
                  <tr key={l.categoria} className="hover:bg-slate-50">
                    <Td className="font-medium">{l.categoria}</Td>
                    <Td>{formatMoney(l.valor)}</Td>
                    <Td className="text-xs text-slate-500">{l.fatia}%</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Últimos meses" description="Receita contra despesa e repasse" />
        <CardBody>
          {meses.length === 0 ? (
            <p className="text-sm text-slate-500">Ainda não há movimento registrado.</p>
          ) : (
            <div className="flex items-end gap-3 overflow-x-auto pb-2">
              {meses.map((m) => (
                <div key={m.mes} className="flex min-w-14 flex-col items-center gap-1">
                  <span
                    className={`text-[11px] font-medium ${
                      m.resultado >= 0 ? 'text-emerald-600' : 'text-red-600'
                    }`}
                  >
                    {formatMoney(m.resultado)}
                  </span>
                  <div className="flex h-28 items-end gap-1">
                    <div
                      className="w-4 rounded-t bg-emerald-500"
                      style={{ height: `${(m.receita / maiorMes) * 100}%` }}
                      title={`Receita ${formatMoney(m.receita)}`}
                    />
                    <div
                      className="w-4 rounded-t bg-orange-400"
                      style={{ height: `${((m.despesa + m.repasse) / maiorMes) * 100}%` }}
                      title={`Saídas ${formatMoney(m.despesa + m.repasse)}`}
                    />
                  </div>
                  <span className="text-[11px] text-slate-500">{nomeDoMes(m.mes)}</span>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-slate-400">
            Barra verde: receita faturada. Barra laranja: despesas mais repasse médico.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
