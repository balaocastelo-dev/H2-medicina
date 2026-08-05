import Link from 'next/link';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, Button, Card, EmptyState, StatCard, Table, Td, Th } from '@/components/ui';
import { elapsedFrom, formatTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface Row {
  id: string;
  stage_code: string;
  priority: string;
  checkin_at: string;
  stage_changed_at: string;
  patients: { id: string; full_name: string } | null;
  companies: { trade_name: string | null; legal_name: string } | null;
  queue_tickets: { code: string }[];
  patient_exams: { status: string }[];
}

export default async function MedicoPage() {
  const ctx = await requirePermission('medico.atender');
  const supabase = await createClient();

  const { data } = await supabase
    .from('attendances')
    .select(
      'id, stage_code, priority, checkin_at, stage_changed_at, patients(id, full_name), companies(trade_name, legal_name), queue_tickets(code), patient_exams(status)',
    )
    .eq('tenant_id', ctx.tenant.id)
    .in('stage_code', ['aguardando_medico', 'em_consulta', 'aguardando_documentos'])
    .is('finished_at', null)
    .is('deleted_at', null)
    .order('priority')
    .order('checkin_at')
    .returns<Row[]>();

  const rows = data ?? [];

  return (
    <div>
      <PageHeader
        title="Módulo médico"
        description="Pacientes com exames concluídos aguardando avaliação"
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard
          label="Aguardando médico"
          value={rows.filter((r) => r.stage_code === 'aguardando_medico').length}
          color="#A855F7"
        />
        <StatCard
          label="Em consulta"
          value={rows.filter((r) => r.stage_code === 'em_consulta').length}
          color="#3B82F6"
        />
        <StatCard
          label="Aguardando documentos"
          value={rows.filter((r) => r.stage_code === 'aguardando_documentos').length}
          color="#FACC15"
        />
      </div>

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            title="Nenhum paciente aguardando"
            description="Assim que todos os exames forem concluídos, o paciente aparece aqui."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Senha</Th>
                <Th>Paciente</Th>
                <Th>Empresa</Th>
                <Th>Exames</Th>
                <Th>Etapa</Th>
                <Th>Espera</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const done = r.patient_exams.filter((e) => e.status === 'concluído').length;
                return (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <Td className="font-mono font-bold">{r.queue_tickets[0]?.code ?? '—'}</Td>
                    <Td className="font-medium">{r.patients?.full_name ?? '—'}</Td>
                    <Td className="text-slate-600">
                      {r.companies?.trade_name ?? r.companies?.legal_name ?? '—'}
                    </Td>
                    <Td>
                      <Badge color={done === r.patient_exams.length ? '#22C55E' : '#FB923C'}>
                        {done}/{r.patient_exams.length}
                      </Badge>
                    </Td>
                    <Td>
                      <Badge color={r.stage_code === 'em_consulta' ? '#3B82F6' : '#A855F7'}>
                        {r.stage_code}
                      </Badge>
                    </Td>
                    <Td className="text-slate-500">
                      {formatTime(r.checkin_at)} · {elapsedFrom(r.checkin_at)}
                    </Td>
                    <Td>
                      <Link href={`/medico/${r.id}`}>
                        <Button size="sm">Atender</Button>
                      </Link>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
