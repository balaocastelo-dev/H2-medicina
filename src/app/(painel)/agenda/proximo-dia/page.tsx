import { Printer } from 'lucide-react';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, Card, CardHeader, EmptyState, StatCard, Table, Td, Th } from '@/components/ui';
import { daysAheadISO, formatCPF, formatDate, formatTime } from '@/lib/format';
import { PrintButton, ExportCsvButton } from './actions-bar';

export const dynamic = 'force-dynamic';

interface Row {
  id: string;
  scheduled_at: string;
  status: string;
  priority: string;
  attendance_kind: string;
  origin: string;
  company_id: string | null;
  patients: { full_name: string; cpf: string | null } | null;
  companies: { trade_name: string | null; legal_name: string } | null;
  appointment_exams: { exam_types: { name: string } | null }[];
}

export default async function ProximoDiaPage({
  searchParams,
}: {
  searchParams: Promise<{ data?: string }>;
}) {
  const ctx = await requirePermission('agenda.ver');
  const sp = await searchParams;

  const date = sp.data ?? daysAheadISO(1);

  const supabase = await createClient();
  const { data } = await supabase
    .from('appointments')
    .select(
      'id, scheduled_at, status, priority, attendance_kind, origin, company_id, patients(full_name, cpf), companies(trade_name, legal_name), appointment_exams(exam_types(name))',
    )
    .eq('tenant_id', ctx.tenant.id)
    .eq('scheduled_date', date)
    .is('deleted_at', null)
    .order('scheduled_at')
    .returns<Row[]>();

  const rows = data ?? [];

  const groups = new Map<string, { label: string; rows: Row[] }>();
  for (const r of rows) {
    const key = r.company_id ?? 'sem-empresa';
    const label = r.companies?.trade_name ?? r.companies?.legal_name ?? 'Sem empresa vinculada';
    if (!groups.has(key)) groups.set(key, { label, rows: [] });
    groups.get(key)!.rows.push(r);
  }

  const csvRows = rows.map((r) => ({
    hora: formatTime(r.scheduled_at),
    paciente: r.patients?.full_name ?? '',
    cpf: r.patients?.cpf ? formatCPF(r.patients.cpf) : '',
    empresa: r.companies?.trade_name ?? r.companies?.legal_name ?? '',
    tipo: r.attendance_kind,
    exames: r.appointment_exams
      .map((e) => e.exam_types?.name)
      .filter(Boolean)
      .join(' | '),
    prioridade: r.priority,
    status: r.status,
    origem: r.origin,
  }));

  return (
    <div>
      <PageHeader
        title="Agenda do proximo dia"
        description={`Pacientes previstos para ${formatDate(date)}, agrupados por empresa`}
        actions={
          <div className="no-print flex gap-2">
            <ExportCsvButton rows={csvRows} fileName={`agenda-${date}.csv`} />
            <PrintButton>
              <Printer className="h-4 w-4" /> Imprimir
            </PrintButton>
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total previsto" value={rows.length} />
        <StatCard label="Empresas" value={groups.size} />
        <StatCard
          label="Prioritarios"
          value={rows.filter((r) => r.priority !== 'normal').length}
          color="#EF4444"
        />
        <StatCard
          label="Vindos da loja"
          value={rows.filter((r) => r.origin === 'ecommerce').length}
          color="#0EA5E9"
        />
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title="Nenhum paciente previsto"
            description="Assim que a lista do proximo dia for recebida ou importada, ela aparece aqui."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {Array.from(groups.entries()).map(([key, group]) => (
            <Card key={key}>
              <CardHeader title={group.label} description={`${group.rows.length} paciente(s)`} />
              <Table>
                <thead>
                  <tr>
                    <Th>Hora</Th>
                    <Th>Paciente</Th>
                    <Th>CPF</Th>
                    <Th>Tipo</Th>
                    <Th>Exames previstos</Th>
                    <Th>Prioridade</Th>
                    <Th>Origem</Th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((r) => (
                    <tr key={r.id}>
                      <Td className="font-mono">{formatTime(r.scheduled_at)}</Td>
                      <Td className="font-medium">{r.patients?.full_name ?? '—'}</Td>
                      <Td className="font-mono text-xs">
                        {r.patients?.cpf ? formatCPF(r.patients.cpf) : '—'}
                      </Td>
                      <Td className="text-slate-600">{r.attendance_kind}</Td>
                      <Td className="text-xs text-slate-600">
                        {r.appointment_exams
                          .map((e) => e.exam_types?.name)
                          .filter(Boolean)
                          .join(', ') || '—'}
                      </Td>
                      <Td>
                        {r.priority === 'normal' ? (
                          '—'
                        ) : (
                          <Badge color="#EF4444">{r.priority}</Badge>
                        )}
                      </Td>
                      <Td className="text-xs text-slate-500">{r.origin}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
