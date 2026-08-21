import Link from 'next/link';
import { Plus } from 'lucide-react';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, Button, Card, EmptyState, StatCard, Table, Td, Th } from '@/components/ui';
import { FilterSelect } from '@/components/ui/data-controls';
import { formatDate, formatTime, todayISO } from '@/lib/format';
import { AgendaDatePicker } from './date-picker';
import { PedidosOnline, type PedidoOnline } from './pedidos-online';
import { Calendario, type DiaDoCalendario } from './calendario';
import { AcoesDoAgendamento } from './acoes-agendamento';

export const dynamic = 'force-dynamic';

interface Row {
  id: string;
  scheduled_at: string;
  status: string;
  priority: string;
  attendance_kind: string;
  patients: { id: string; full_name: string; cpf: string | null } | null;
  companies: { trade_name: string | null; legal_name: string } | null;
  appointment_exams: { exam_types: { name: string } | null }[];
  attendances: { stage_code: string; finished_at: string | null }[];
}

const STATUS_COLORS: Record<string, string> = {
  agendado: '#9CA3AF',
  confirmado: '#0EA5E9',
  checkin: '#FACC15',
  em_atendimento: '#3B82F6',
  realizado: '#22C55E',
  cancelado: '#4B5563',
  ausente: '#EF4444',
  remarcado: '#A855F7',
};

/** Nome legivel da etapa, para quem olha a agenda sem conhecer os codigos. */
function etapaNome(code: string): string {
  const nomes: Record<string, string> = {
    agendado: 'agendado',
    checkin: 'check-in',
    aguardando_recepcao: 'aguardando recepção',
    na_recepcao: 'na recepção',
    aguardando_triagem: 'aguardando triagem',
    em_triagem: 'em triagem',
    aguardando_exames: 'aguardando exames',
    em_exames: 'em exames',
    aguardando_medico: 'aguardando médico',
    em_consulta: 'em consulta',
    aguardando_pagamento: 'aguardando pagamento',
    aguardando_documentos: 'aguardando documentos',
    finalizado: 'finalizado',
    cancelado: 'cancelado',
    ausente: 'ausente',
  };
  return nomes[code] ?? code;
}

function etapaCor(atendimento: { stage_code: string; finished_at: string | null }): string {
  if (atendimento.finished_at || atendimento.stage_code === 'finalizado') return '#22C55E';
  if (['cancelado', 'ausente'].includes(atendimento.stage_code)) return '#EF4444';
  if (atendimento.stage_code.startsWith('aguardando')) return '#FB923C';
  return '#3B82F6';
}

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ data?: string; status?: string; empresa?: string; inicio?: string }>;
}) {
  const ctx = await requirePermission('agenda.ver');
  const sp = await searchParams;
  const date = sp.data ?? todayISO();
  const inicio = sp.inicio ?? todayISO();
  const supabase = await createClient();

  // Janela de 30 dias do calendario.
  const dias: string[] = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(`${inicio}T12:00:00-03:00`);
    d.setDate(d.getDate() + i);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
  });
  const ultimoDia = dias[dias.length - 1] ?? inicio;

  let query = supabase
    .from('appointments')
    .select(
      'id, scheduled_at, status, priority, attendance_kind, patients(id, full_name, cpf), companies(trade_name, legal_name), appointment_exams(exam_types(name)), attendances(stage_code, finished_at)',
    )
    .eq('tenant_id', ctx.tenant.id)
    .eq('scheduled_date', date)
    .is('deleted_at', null);

  if (sp.status) {
    query = query.eq('status', sp.status);
  } else {
    // Cancelado e remarcado somem por padrao: quem abre a agenda quer ver
    // quem vem, nao quem desmarcou. Continuam acessiveis pelo filtro.
    query = query.not('status', 'in', '("cancelado","remarcado")');
  }
  if (sp.empresa) query = query.eq('company_id', sp.empresa);

  const [rowsRes, companiesRes, mesRes, pedidosRes] = await Promise.all([
    query.order('scheduled_at').returns<Row[]>(),
    supabase
      .from('companies')
      .select('id, legal_name, trade_name')
      .eq('tenant_id', ctx.tenant.id)
      .is('deleted_at', null)
      .order('legal_name')
      .returns<{ id: string; legal_name: string; trade_name: string | null }[]>(),
    supabase
      .from('appointments')
      .select('scheduled_date, status')
      .eq('tenant_id', ctx.tenant.id)
      .gte('scheduled_date', inicio)
      .lte('scheduled_date', ultimoDia)
      .is('deleted_at', null)
      .returns<{ scheduled_date: string; status: string }[]>(),
    // Pedidos do site aguardando decisao, de qualquer data: o horario fica
    // travado ate alguem responder, entao nao pode depender do dia escolhido.
    supabase
      .from('appointments')
      .select(
        'id, scheduled_at, public_code, requester_name, requester_phone, requester_email, requested_at, notes, patients(full_name, cpf), appointment_exams(exam_types(name))',
      )
      .eq('tenant_id', ctx.tenant.id)
      .eq('requested_online', true)
      .is('confirmed_at', null)
      .is('rejected_at', null)
      .is('deleted_at', null)
      .gte('scheduled_date', todayISO())
      .order('scheduled_at')
      .limit(30)
      .returns<PedidoOnline[]>(),
  ]);

  const pedidos = pedidosRes.data ?? [];

  const porDia = new Map<string, DiaDoCalendario>();
  for (const iso of dias) {
    porDia.set(iso, { iso, total: 0, realizados: 0, ausentes: 0 });
  }
  for (const a of mesRes.data ?? []) {
    const dia = porDia.get(a.scheduled_date);
    if (!dia) continue;
    if (a.status === 'cancelado' || a.status === 'remarcado') continue;
    dia.total += 1;
    if (a.status === 'realizado') dia.realizados += 1;
    if (a.status === 'ausente') dia.ausentes += 1;
  }
  const calendario = Array.from(porDia.values());

  const rows = rowsRes.data ?? [];
  const podeMexer = ctx.permissions.has('agenda.administrar');
  const total = rows.length;
  const confirmed = rows.filter((r) => r.status === 'confirmado').length;
  const done = rows.filter((r) => r.status === 'realizado').length;
  const absent = rows.filter((r) => r.status === 'ausente').length;

  return (
    <div>
      <PageHeader
        title="Agenda"
        description={`Agendamentos de ${formatDate(date)}`}
        actions={
          ctx.permissions.has('agenda.administrar') && (
            <Link href="/agenda/novo">
              <Button>
                <Plus className="h-4 w-4" /> Novo agendamento
              </Button>
            </Link>
          )
        }
      />

      {/* Pedidos do site esperando decisao: horario reservado, relogio correndo. */}
      {ctx.permissions.has('agenda.administrar') && <PedidosOnline pedidos={pedidos} />}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total do dia" value={total} />
        <StatCard label="Confirmados" value={confirmed} color="#0EA5E9" />
        <StatCard label="Realizados" value={done} color="#22C55E" />
        <StatCard label="Ausentes" value={absent} color="#EF4444" />
      </div>

      <div className="mb-4">
        <Calendario dias={calendario} selecionado={date} inicio={inicio} />
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <AgendaDatePicker value={date} />
          <FilterSelect
            name="status"
            label="Status"
            options={Object.keys(STATUS_COLORS).map((s) => ({ value: s, label: s }))}
          />
          <FilterSelect
            name="empresa"
            label="Empresa"
            options={(companiesRes.data ?? []).map((c) => ({
              value: c.id,
              label: c.trade_name ?? c.legal_name,
            }))}
          />
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title="Nenhum agendamento nesta data"
            description="Crie manualmente, importe uma planilha ou aguarde a sincronização automática."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Hora</Th>
                <Th>Paciente</Th>
                <Th>Empresa</Th>
                <Th>Tipo</Th>
                <Th>Exames</Th>
                <Th>Prioridade</Th>
                <Th>Status</Th>
                <Th>Etapa agora</Th>
                {podeMexer && <Th className="no-print">Ações</Th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <Td className="font-mono">{formatTime(r.scheduled_at)}</Td>
                  <Td>
                    {r.patients ? (
                      <Link
                        href={`/pacientes/${r.patients.id}`}
                        className="font-medium hover:underline"
                      >
                        {r.patients.full_name}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td className="text-slate-600">
                    {r.companies?.trade_name ?? r.companies?.legal_name ?? '—'}
                  </Td>
                  <Td className="text-slate-600">{r.attendance_kind}</Td>
                  <Td className="text-xs text-slate-600">
                    {r.appointment_exams.length === 0
                      ? '—'
                      : r.appointment_exams
                          .map((e) => e.exam_types?.name)
                          .filter(Boolean)
                          .join(', ')}
                  </Td>
                  <Td>
                    {r.priority === 'normal' ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <Badge color="#EF4444">{r.priority}</Badge>
                    )}
                  </Td>
                  <Td>
                    <Badge color={STATUS_COLORS[r.status] ?? '#9CA3AF'}>{r.status}</Badge>
                  </Td>
                  <Td>
                    {r.attendances?.[0] ? (
                      <Badge color={etapaCor(r.attendances[0])}>
                        {etapaNome(r.attendances[0].stage_code)}
                      </Badge>
                    ) : (
                      <span className="text-slate-400">não chegou</span>
                    )}
                  </Td>
                  {podeMexer && (
                    <Td className="no-print">
                      <AcoesDoAgendamento
                        appointmentId={r.id}
                        paciente={r.patients?.full_name ?? 'este paciente'}
                        status={r.status}
                        jaChegou={!!r.attendances?.[0]}
                      />
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
