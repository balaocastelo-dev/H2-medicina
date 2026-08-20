import Link from 'next/link';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Card, EmptyState, StatCard } from '@/components/ui';
import { formatMoney, todayISO } from '@/lib/format';
import { ContasClient, NovaConta } from './client';
import type { ContaRow } from './types';

export const dynamic = 'force-dynamic';

export default async function ContasPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const ctx = await requirePermission('financeiro.ver');
  const sp = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from('payables')
    .select('id, description, category, supplier, amount, due_date, status, is_recurring, notes')
    .eq('tenant_id', ctx.tenant.id)
    .is('deleted_at', null);
  if (sp.status) query = query.eq('status', sp.status);

  const { data } = await query.order('due_date').limit(300).returns<ContaRow[]>();
  const contas = data ?? [];
  const hoje = todayISO();

  // O repasse dos medicos nao e cadastrado aqui: nasce sozinho a cada
  // consulta finalizada. Mas e dinheiro que a clinica deve, entao o total
  // em aberto aparece junto das outras contas, com atalho para a baixa.
  const { data: repasses } = await supabase
    .from('fee_entries')
    .select('fee, profile_id')
    .eq('tenant_id', ctx.tenant.id)
    .eq('status', 'a_pagar')
    .returns<{ fee: number; profile_id: string }[]>();

  const repasseAberto = (repasses ?? []).reduce((s, r) => s + Number(r.fee), 0);
  const medicosComRepasse = new Set((repasses ?? []).map((r) => r.profile_id)).size;

  const soma = (filtro: (c: ContaRow) => boolean) =>
    contas.filter(filtro).reduce((s, c) => s + Number(c.amount), 0);

  const abertas = (c: ContaRow) => c.status === 'aberta';
  const vencidas = contas.filter((c) => abertas(c) && c.due_date < hoje);

  return (
    <div>
      <PageHeader
        title="Contas a pagar"
        description="Despesas da clínica, com vencimento e baixa manual"
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Em aberto" value={formatMoney(soma(abertas))} color="#FB923C" />
        <StatCard
          label="Vencidas"
          value={formatMoney(vencidas.reduce((s, c) => s + Number(c.amount), 0))}
          color="#EF4444"
        />
        <StatCard label="Pagas" value={formatMoney(soma((c) => c.status === 'paga'))} color="#22C55E" />
        <StatCard label="Lançamentos" value={contas.length} />
      </div>

      {repasseAberto > 0 && (
        <Card className="mb-4 border-l-4 border-l-violet-500">
          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="text-sm font-semibold text-slate-700">Repasse médico em aberto</p>
              <p className="text-xs text-slate-500">
                {medicosComRepasse} médico(s) aguardando acerto. Nasce dos atendimentos, não é
                cadastrado aqui.
              </p>
            </div>
            <div className="flex items-center gap-4">
              <p className="text-xl font-bold text-violet-600">{formatMoney(repasseAberto)}</p>
              <Link
                href="/financeiro/repasse"
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
              >
                Dar baixa
              </Link>
            </div>
          </div>
        </Card>
      )}

      {ctx.permissions.has('financeiro.registrar') && (
        <div className="mb-4">
          <NovaConta />
        </div>
      )}

      {contas.length === 0 ? (
        <Card>
          <EmptyState title="Nenhuma conta" description="Cadastre a primeira despesa acima." />
        </Card>
      ) : (
        <ContasClient
          contas={contas}
          hoje={hoje}
          podeEditar={ctx.permissions.has('financeiro.registrar')}
        />
      )}
    </div>
  );
}
