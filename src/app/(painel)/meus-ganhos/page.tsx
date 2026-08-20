import { requireSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, Card, CardHeader, EmptyState, StatCard, Table, Td, Th } from '@/components/ui';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import {
  competenciaAtual,
  corDoStatus,
  ganhosPorCompetencia,
  nomeDaCompetencia,
  resumirGanhos,
  rotuloDoStatus,
  type LancamentoDoMedico,
} from '@/modules/finance/meus-ganhos';
import { SeletorDeCompetencia } from './client';

export const dynamic = 'force-dynamic';

interface LinhaBanco {
  id: string;
  fee: number;
  status: string;
  competencia: string;
  created_at: string;
  paid_at: string | null;
  procedure_name: string;
  patients: { full_name: string } | null;
  companies: { trade_name: string | null; legal_name: string } | null;
}

/**
 * Extrato do proprio medico.
 *
 * Nao ha filtro por profile_id nesta consulta de proposito: a politica de
 * acesso da tabela ja devolve apenas as linhas de quem esta logado (ou
 * todas, para quem cuida do financeiro). Repetir a regra aqui criaria um
 * segundo lugar para ela ficar errada.
 */
export default async function MeusGanhosPage({
  searchParams,
}: {
  searchParams: Promise<{ competencia?: string }>;
}) {
  const ctx = await requireSession();
  const sp = await searchParams;
  const supabase = await createClient();

  const competencia = /^\d{4}-\d{2}$/.test(sp.competencia ?? '')
    ? `${sp.competencia}-01`
    : competenciaAtual();

  const [doMes, historico] = await Promise.all([
    supabase
      .from('fee_entries')
      .select(
        'id, fee, status, competencia, created_at, paid_at, procedure_name, patients(full_name), companies(trade_name, legal_name)',
      )
      .eq('tenant_id', ctx.tenant.id)
      .eq('profile_id', ctx.userId)
      .eq('competencia', competencia)
      .order('created_at', { ascending: false })
      .returns<LinhaBanco[]>(),
    supabase
      .from('fee_entries')
      .select('id, fee, status, competencia, created_at, paid_at, procedure_name')
      .eq('tenant_id', ctx.tenant.id)
      .eq('profile_id', ctx.userId)
      .order('competencia', { ascending: false })
      .limit(2000)
      .returns<Omit<LinhaBanco, 'patients' | 'companies'>[]>(),
  ]);

  const paraCalculo = (linhas: { fee: number; status: string; competencia: string }[]) =>
    linhas.map((l) => ({
      id: '',
      paciente: null,
      empresa: null,
      procedimento: '',
      fee: l.fee,
      status: l.status,
      atendidoEm: '',
      competencia: l.competencia,
      pagoEm: null,
    })) as LancamentoDoMedico[];

  const linhas = doMes.data ?? [];
  const resumo = resumirGanhos(
    linhas.map((l) => ({
      id: l.id,
      paciente: l.patients?.full_name ?? null,
      empresa: l.companies?.trade_name ?? l.companies?.legal_name ?? null,
      procedimento: l.procedure_name,
      fee: l.fee,
      status: l.status,
      atendidoEm: l.created_at,
      competencia: l.competencia,
      pagoEm: l.paid_at,
    })),
  );

  const meses = ganhosPorCompetencia(paraCalculo(historico.data ?? []));
  const totalRecebidoSempre = meses.reduce((s, m) => s + m.recebido, 0);

  return (
    <div>
      <PageHeader
        title="Meus ganhos"
        description={`Atendimentos e repasse de ${nomeDaCompetencia(competencia.slice(0, 7))}`}
      />

      <div className="mb-4">
        <SeletorDeCompetencia competencia={competencia.slice(0, 7)} />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="A receber" value={formatMoney(resumo.aReceber)} color="#FB923C" />
        <StatCard label="Recebido no mês" value={formatMoney(resumo.recebido)} color="#22C55E" />
        <StatCard label="Total do mês" value={formatMoney(resumo.total)} />
        <StatCard
          label="Atendimentos"
          value={resumo.atendimentos}
          hint={`${resumo.pacientesUnicos} paciente(s)`}
        />
      </div>

      <Card className="mb-4">
        <CardHeader
          title="Atendimentos do mês"
          description="Cada linha vira repasse quando a consulta é finalizada"
        />
        {linhas.length === 0 ? (
          <EmptyState
            title="Nenhum atendimento nesta competência"
            description="Os valores aparecem aqui assim que você finalizar uma consulta."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Data</Th>
                <Th>Paciente</Th>
                <Th>Empresa</Th>
                <Th>Procedimento</Th>
                <Th>Valor</Th>
                <Th>Situação</Th>
                <Th>Baixa</Th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <Td className="text-slate-600">{formatDate(l.created_at)}</Td>
                  <Td className="font-medium">{l.patients?.full_name ?? '—'}</Td>
                  <Td className="text-slate-600">
                    {l.companies?.trade_name ?? l.companies?.legal_name ?? '—'}
                  </Td>
                  <Td className="text-slate-600">{l.procedure_name}</Td>
                  <Td className="font-medium">{formatMoney(l.fee)}</Td>
                  <Td>
                    <Badge color={corDoStatus(l.status)}>{rotuloDoStatus(l.status)}</Badge>
                  </Td>
                  <Td className="text-xs text-slate-500">
                    {l.paid_at ? formatDateTime(l.paid_at) : '—'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Histórico por competência"
          description={`Recebido desde o início: ${formatMoney(totalRecebidoSempre)}`}
        />
        {meses.length === 0 ? (
          <EmptyState title="Ainda sem histórico" description="Seu primeiro mês aparece aqui." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Competência</Th>
                <Th>Atendimentos</Th>
                <Th>A receber</Th>
                <Th>Recebido</Th>
                <Th>Total</Th>
              </tr>
            </thead>
            <tbody>
              {meses.map((m) => (
                <tr
                  key={m.competencia}
                  className={
                    m.competencia === competencia.slice(0, 7) ? 'bg-slate-50 font-medium' : undefined
                  }
                >
                  <Td>{nomeDaCompetencia(m.competencia)}</Td>
                  <Td className="text-slate-600">{m.atendimentos}</Td>
                  <Td className={m.aReceber > 0 ? 'text-orange-600' : 'text-slate-400'}>
                    {formatMoney(m.aReceber)}
                  </Td>
                  <Td className="text-emerald-600">{formatMoney(m.recebido)}</Td>
                  <Td>{formatMoney(m.total)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <p className="mt-3 text-xs text-slate-400">
        &quot;A receber&quot; é o que a clínica ainda vai acertar com você. A linha passa para
        &quot;recebido&quot; quando o financeiro dá baixa no pagamento.
      </p>
    </div>
  );
}
