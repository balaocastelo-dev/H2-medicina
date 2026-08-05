import Link from 'next/link';
import { Plus } from 'lucide-react';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, Button, Card, EmptyState, StatCard, Table, Td, Th } from '@/components/ui';
import { FilterSelect } from '@/components/ui/data-controls';
import { formatDate, formatTime, todayISO } from '@/lib/format';
import { AgendaDatePicker } from './date-picker';

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
  searchParams: Promise<{ data?: string; status?: string; empresa?: string }>;
}) {
  const ctx = await requirePermission('agenda.ver');
  const sp = await searchParams;
  const date = sp.data ?? todayISO();
  const supabase = await createClient();

  let query = supabase
    .from('appointments')
    .select(
      'id, scheduled_at, status, priority, attendance_kind, patients(id, full_name, cpf), companies(trade_name, legal_name), appointment_exams(exam_types(name)), attendances(stage_code, finished_at)',
    )
    .eq('tenant_id', ctx.tenant.id)
    .eq('scheduled_date', date)
    .is('deleted_at', null);

  if (sp.status) query = query.eq('status', sp.status);
  if (sp.empresa) query = query.eq('company_id', sp.empresa);

  const [rowsRes, companiesRes] = await Promise.all([
    query.order('scheduled_at').returns<Row[]>(),
    supabase
      .from('companies')
      .select('id, legal_name, trade_name')
      .eq('tenant_id', ctx.tenant.id)
      .is('deleted_at', null)
      .order('legal_name')
      .returns<{ id: string; legal_name: string; trade_name: string | null }[]>(),
  ]);

  const rows = rowsRes.data ?? [];
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

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total do dia" value={total} />
        <StatCard label="Confirmados" value={confirmed} color="#0EA5E9" />
        <StatCard label="Realizados" value={done} color="#22C55E" />
        <StatCard label="Ausentes" value={absent} color="#EF4444" />
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
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
