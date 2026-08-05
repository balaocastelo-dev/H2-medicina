import Link from 'next/link';
import { ArrowRight, CalendarDays, Clock, TrendingUp, Users } from 'lucide-react';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, Card, CardHeader, EmptyState, Table, Td, Th } from '@/components/ui';
import { WelcomeGreeting } from '@/modules/greeting/welcome-greeting';
import { saudacaoAtiva } from '@/modules/greeting/phrases';
import { elapsedFrom, formatMoney, formatTime, sinceISO, startOfTodayISO, todayISO } from '@/lib/format';
import type { CrmStage } from '@/types/entities';
import {
  BarrasEmpresas, BarrasExames, CurvaChegadas, OcupacaoSalas, RoscaEtapas,
  type BarraEmpresa, type BarraExame, type Fatia, type PontoHora,
} from './charts';

export const dynamic = 'force-dynamic';

interface AtendimentoAberto {
  id: string;
  stage_code: string;
  priority: string;
  checkin_at: string;
  stage_changed_at: string;
  patients: { full_name: string } | null;
  companies: { trade_name: string | null; legal_name: string } | null;
}

export default async function DashboardPage() {
  const ctx = await requirePermission('dashboard.ver');
  const supabase = await createClient();
  const tenantId = ctx.tenant.id;
  const hoje = todayISO();

  const [stagesRes, abertosRes, agendaRes, salasRes, examesRes, mesRes, pagamentosRes] =
    await Promise.all([
      supabase
        .from('crm_stages')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .order('sort_order')
        .returns<CrmStage[]>(),
      supabase
        .from('attendances')
        .select(
          'id, stage_code, priority, checkin_at, stage_changed_at, patients(full_name), companies(trade_name, legal_name)',
        )
        .eq('tenant_id', tenantId)
        .gte('checkin_at', startOfTodayISO())
        .is('deleted_at', null)
        .order('checkin_at')
        .returns<AtendimentoAberto[]>(),
      supabase
        .from('appointments')
        .select('id, status')
        .eq('tenant_id', tenantId)
        .eq('scheduled_date', hoje)
        .is('deleted_at', null)
        .returns<{ id: string; status: string }[]>(),
      supabase
        .from('rooms')
        .select('id, name, status, kind')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('sort_order')
        .returns<{ id: string; name: string; status: string; kind: string }[]>(),
      supabase
        .from('patient_exams')
        .select('id, status, exam_types(name)')
        .eq('tenant_id', tenantId)
        .gte('created_at', startOfTodayISO())
        .returns<{ id: string; status: string; exam_types: { name: string } | null }[]>(),
      supabase
        .from('attendances')
        .select('id, companies(trade_name, legal_name)')
        .eq('tenant_id', tenantId)
        .gte('checkin_at', sinceISO(30))
        .is('deleted_at', null)
        .returns<{ id: string; companies: { trade_name: string | null; legal_name: string } | null }[]>(),
      ctx.permissions.has('financeiro.ver')
        ? supabase
            .from('payments')
            .select('status, net_amount')
            .eq('tenant_id', tenantId)
            .gte('created_at', startOfTodayISO())
            .is('deleted_at', null)
            .returns<{ status: string; net_amount: number }[]>()
        : Promise.resolve({ data: [] as { status: string; net_amount: number }[] }),
    ]);

  const stages = stagesRes.data ?? [];
  const doDia = abertosRes.data ?? [];
  const abertos = doDia.filter((a) => !['finalizado', 'cancelado', 'ausente'].includes(a.stage_code));
  const salas = salasRes.data ?? [];
  const exames = examesRes.data ?? [];
  const pagamentos = pagamentosRes.data ?? [];

  const corEtapa = (code: string) => stages.find((s) => s.code === code)?.color ?? '#9CA3AF';
  const nomeEtapa = (code: string) => stages.find((s) => s.code === code)?.name ?? code;

  // ---- indicadores ----
  const agendados = (agendaRes.data ?? []).length;
  const presentes = doDia.length;
  const aguardando = abertos.filter((a) => a.stage_code.startsWith('aguardando')).length;
  const emAtendimento = abertos.filter((a) =>
    ['na_recepcao', 'em_triagem', 'em_exames', 'em_consulta'].includes(a.stage_code),
  ).length;
  const finalizados = doDia.filter((a) => a.stage_code === 'finalizado').length;

  const pagos = pagamentos.filter((p) => p.status === 'pago');
  const recebido = pagos.reduce((s, p) => s + Number(p.net_amount ?? 0), 0);
  const pendente = pagamentos
    .filter((p) => p.status === 'pendente')
    .reduce((s, p) => s + Number(p.net_amount ?? 0), 0);

  // ---- series dos graficos ----
  const porEtapa: Fatia[] = stages
    .map((s) => ({
      nome: s.name,
      valor: abertos.filter((a) => a.stage_code === s.code).length,
      cor: s.color,
    }))
    .filter((f) => f.valor > 0);

  const porHora: PontoHora[] = Array.from({ length: 13 }, (_, i) => {
    const h = i + 6; // 06h as 18h
    return {
      hora: `${String(h).padStart(2, '0')}h`,
      chegadas: doDia.filter((a) => new Date(a.checkin_at).getHours() === h).length,
    };
  });

  const contagemEmpresa = new Map<string, number>();
  for (const a of mesRes.data ?? []) {
    const nome = a.companies?.trade_name ?? a.companies?.legal_name ?? 'Sem empresa';
    contagemEmpresa.set(nome, (contagemEmpresa.get(nome) ?? 0) + 1);
  }
  const porEmpresa: BarraEmpresa[] = Array.from(contagemEmpresa.entries())
    .map(([empresa, atendimentos]) => ({
      empresa: empresa.length > 20 ? `${empresa.slice(0, 19)}…` : empresa,
      atendimentos,
    }))
    .sort((a, b) => b.atendimentos - a.atendimentos)
    .slice(0, 6);

  const contagemExame = new Map<string, { concluidos: number; pendentes: number }>();
  for (const e of exames) {
    const nome = e.exam_types?.name ?? 'Outro';
    const atual = contagemExame.get(nome) ?? { concluidos: 0, pendentes: 0 };
    if (e.status === 'concluido') atual.concluidos += 1;
    else if (!['cancelado', 'nao_realizado'].includes(e.status)) atual.pendentes += 1;
    contagemExame.set(nome, atual);
  }
  const porExame: BarraExame[] = Array.from(contagemExame.entries())
    .map(([exame, v]) => ({
      exame: exame.length > 16 ? `${exame.slice(0, 15)}…` : exame,
      ...v,
    }))
    .filter((e) => e.concluidos + e.pendentes > 0);

  const salasOcupadas = salas.filter((s) => s.status === 'ocupada').length;

  const saudacao = (ctx.settings.saudacao ?? {}) as {
    ativa?: unknown;
    tratamento_padrao?: string;
    tratamentos?: Record<string, string>;
    voz?: string;
    velocidade?: string | number;
  };
  const cor = ctx.branding.color_primary;

  return (
    <div>
      <WelcomeGreeting
        nome={ctx.profile.full_name || (ctx.email ?? '')}
        tratamento={saudacao.tratamentos?.[ctx.userId] ?? saudacao.tratamento_padrao ?? null}
        ativa={saudacaoAtiva(saudacao.ativa)}
        corPrimaria={cor}
        voz={saudacao.voz ?? null}
        velocidade={saudacao.velocidade ? Number(saudacao.velocidade) : null}
      />

      <PageHeader
        title="Dashboard"
        description={new Date().toLocaleDateString('pt-BR', {
          weekday: 'long',
          day: '2-digit',
          month: 'long',
          year: 'numeric',
        })}
      />

      {/* Faixa de indicadores */}
      <div
        className="mb-4 overflow-hidden rounded-2xl p-5 text-white shadow-lg"
        style={{
          background: `linear-gradient(120deg, ${cor} 0%, color-mix(in srgb, ${cor} 55%, #0f172a) 100%)`,
        }}
      >
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <Kpi icone={<CalendarDays className="h-4 w-4" />} rotulo="Agendados hoje" valor={agendados} />
          <Kpi icone={<Users className="h-4 w-4" />} rotulo="Presentes" valor={presentes} />
          <Kpi icone={<Clock className="h-4 w-4" />} rotulo="Aguardando" valor={aguardando} destaque />
          <Kpi icone={<TrendingUp className="h-4 w-4" />} rotulo="Em atendimento" valor={emAtendimento} />
          <Kpi icone={<ArrowRight className="h-4 w-4" />} rotulo="Finalizados" valor={finalizados} />
        </div>

        {ctx.permissions.has('financeiro.ver') && (
          <div className="mt-4 grid grid-cols-2 gap-4 border-t border-white/20 pt-4 lg:grid-cols-4">
            <Kpi rotulo="Recebido hoje" valor={formatMoney(recebido)} pequeno />
            <Kpi rotulo="Pendente" valor={formatMoney(pendente)} pequeno />
            <Kpi rotulo="Pagamentos" valor={pagos.length} pequeno />
            <Kpi
              rotulo="Ticket medio"
              valor={formatMoney(pagos.length ? recebido / pagos.length : 0)}
              pequeno
            />
          </div>
        )}
      </div>

      {/* Graficos */}
      <div className="grid gap-4 lg:grid-cols-3">
        <RoscaEtapas dados={porEtapa} total={abertos.length} />
        <div className="lg:col-span-2">
          <CurvaChegadas dados={porHora} cor={cor} />
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <BarrasExames dados={porExame} />
        <BarrasEmpresas dados={porEmpresa} cor={ctx.branding.color_secondary} />
        <OcupacaoSalas ocupadas={salasOcupadas} total={salas.length} cor={cor} />
      </div>

      {/* Fila em tempo real */}
      <div className="mt-4">
        <Card>
          <CardHeader
            title="Pacientes na clínica agora"
            description={`${abertos.length} em jornada aberta`}
            action={
              <Link href="/crm" className="text-sm font-medium hover:underline" style={{ color: cor }}>
                Ver quadro completo →
              </Link>
            }
          />
          {abertos.length === 0 ? (
            <EmptyState
              title="Nenhum paciente em atendimento"
              description="Assim que houver check-in no totem, os pacientes aparecem aqui."
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Paciente</Th>
                  <Th>Empresa</Th>
                  <Th>Etapa</Th>
                  <Th>Chegada</Th>
                  <Th>Na etapa</Th>
                </tr>
              </thead>
              <tbody>
                {abertos.slice(0, 10).map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <Td className="font-medium">
                      {a.patients?.full_name ?? '—'}
                      {a.priority !== 'normal' && (
                        <Badge className="ml-2" color="#EF4444">
                          {a.priority}
                        </Badge>
                      )}
                    </Td>
                    <Td className="text-slate-600">
                      {a.companies?.trade_name ?? a.companies?.legal_name ?? '—'}
                    </Td>
                    <Td>
                      <Badge color={corEtapa(a.stage_code)}>{nomeEtapa(a.stage_code)}</Badge>
                    </Td>
                    <Td className="text-slate-600">{formatTime(a.checkin_at)}</Td>
                    <Td className="text-slate-600">{elapsedFrom(a.stage_changed_at)}</Td>
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

function Kpi({
  rotulo,
  valor,
  icone,
  destaque,
  pequeno,
}: {
  rotulo: string;
  valor: React.ReactNode;
  icone?: React.ReactNode;
  destaque?: boolean;
  pequeno?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-white/70 uppercase">
        {icone}
        {rotulo}
      </div>
      <p
        className={`mt-1 font-bold tabular-nums ${pequeno ? 'text-xl' : 'text-3xl'} ${
          destaque ? 'text-amber-300' : 'text-white'
        }`}
      >
        {valor}
      </p>
    </div>
  );
}
