import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { todayISO } from '@/lib/format';
import {
  janelaDoPeriodo,
  porCategoria,
  resumirFluxo,
  ROTULO_PERIODO,
  type Movimento,
  type Periodo,
} from '@/modules/finance/fluxo-caixa';
import { buildRelatorioFinanceiro } from '@/modules/finance/relatorio-pdf';

export const dynamic = 'force-dynamic';

const PERIODOS: Periodo[] = ['dia', 'semana', 'mes', 'ano', 'personalizado'];

/**
 * Relatorio financeiro do periodo, em PDF.
 *
 * Rota propria em vez de botao de download: o navegador abre numa aba, a
 * pessoa ve antes de salvar, e o mesmo endereco pode ser guardado nos
 * favoritos para o fechamento do mes.
 */
export async function GET(request: Request) {
  const ctx = await requirePermission('financeiro.ver');
  const sp = new URL(request.url).searchParams;

  const periodoBruto = sp.get('periodo') ?? 'mes';
  const periodo = (PERIODOS as string[]).includes(periodoBruto)
    ? (periodoBruto as Periodo)
    : 'mes';
  const referencia = /^\d{4}-\d{2}-\d{2}$/.test(sp.get('data') ?? '')
    ? (sp.get('data') as string)
    : todayISO();
  const de = sp.get('de');
  const ate = sp.get('ate');
  const personalizado =
    de && ate && /^\d{4}-\d{2}-\d{2}$/.test(de) && /^\d{4}-\d{2}-\d{2}$/.test(ate)
      ? { inicio: de, fim: ate }
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
        { amount: number; category: string; due_date: string; status: string; paid_at: string | null }[]
      >(),
    supabase
      .from('fee_entries')
      .select('fee, status, created_at, paid_at')
      .eq('tenant_id', ctx.tenant.id)
      .neq('status', 'cancelado')
      .returns<{ fee: number; status: string; created_at: string; paid_at: string | null }[]>(),
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

  const empresaCfg = (ctx.settings.empresa ?? {}) as Record<string, string | null>;
  const docsCfg = (ctx.settings.documentos ?? {}) as Record<string, string | null>;

  const pdf = await buildRelatorioFinanceiro({
    clinica: {
      nome: empresaCfg.razao_social ?? ctx.branding.system_name,
      cnpj: empresaCfg.cnpj ? `CNPJ ${empresaCfg.cnpj}` : null,
      cor: ctx.branding.color_primary,
    },
    periodo: { rotulo: ROTULO_PERIODO[periodo], inicio, fim },
    emitidoEm: new Date(),
    emitidoPor: ctx.profile.full_name || (ctx.email ?? 'sistema'),
    resumo: resumirFluxo(movimentos, inicio, fim),
    despesas: porCategoria(movimentos, 'despesa', inicio, fim),
    receitas: porCategoria(movimentos, 'receita', inicio, fim),
    rodape: docsCfg.rodape ?? ctx.branding.footer_text ?? null,
  });

  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      // `inline` abre na aba; a pessoa decide se salva.
      'Content-Disposition': `inline; filename="financeiro-${inicio}-a-${fim}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
