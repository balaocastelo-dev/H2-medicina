import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  StatCard,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { elapsedFrom, formatMoney, formatTime, todayISO } from '@/lib/format';
import type { CrmStage } from '@/types/entities';

export const dynamic = 'force-dynamic';

interface StageCount {
  stage_code: string;
  total: number;
}

interface OpenAttendance {
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
  const today = todayISO();

  const [stagesRes, attendancesRes, appointmentsRes, roomsRes, paymentsRes] = await Promise.all([
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
      .is('finished_at', null)
      .is('deleted_at', null)
      .order('checkin_at', { ascending: true })
      .limit(50)
      .returns<OpenAttendance[]>(),
    supabase
      .from('appointments')
      .select('id, status', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .eq('scheduled_date', today)
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
    ctx.permissions.has('financeiro.ver')
      ? supabase
          .from('payments')
          .select('status, net_amount')
          .eq('tenant_id', tenantId)
          .gte('created_at', `${today}T00:00:00`)
          .is('deleted_at', null)
          .returns<{ status: string; net_amount: number }[]>()
      : Promise.resolve({ data: [] as { status: string; net_amount: number }[], error: null }),
  ]);

  const stages = stagesRes.data ?? [];
  const attendances = attendancesRes.data ?? [];
  const appointments = appointmentsRes.data ?? [];
  const rooms = roomsRes.data ?? [];
  const payments = paymentsRes.data ?? [];

  const stageColor = (code: string) => stages.find((s) => s.code === code)?.color ?? '#9CA3AF';
  const stageName = (code: string) => stages.find((s) => s.code === code)?.name ?? code;

  const counts: StageCount[] = stages.map((s) => ({
    stage_code: s.code,
    total: attendances.filter((a) => a.stage_code === s.code).length,
  }));

  const scheduledToday = appointments.length;
  const presentToday = attendances.length;
  const waiting = attendances.filter((a) => a.stage_code.startsWith('aguardando')).length;
  const inService = attendances.filter((a) =>
    ['na_recepcao', 'em_triagem', 'em_exames', 'em_consulta'].includes(a.stage_code),
  ).length;
  const absent = appointments.filter((a) => a.status === 'ausente').length;

  const paid = payments.filter((p) => p.status === 'pago');
  const pending = payments.filter((p) => p.status === 'pendente');
  const revenue = paid.reduce((sum, p) => sum + Number(p.net_amount ?? 0), 0);
  const pendingAmount = pending.reduce((sum, p) => sum + Number(p.net_amount ?? 0), 0);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={`Panorama operacional de hoje — ${new Date().toLocaleDateString('pt-BR')}`}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Agendados hoje" value={scheduledToday} />
        <StatCard label="Presentes" value={presentToday} color="#0EA5E9" />
        <StatCard label="Aguardando" value={waiting} color="#FB923C" />
        <StatCard label="Em atendimento" value={inService} color="#3B82F6" />
        <StatCard label="Ausentes" value={absent} color="#EF4444" />
      </div>

      {ctx.permissions.has('financeiro.ver') && (
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Recebido hoje" value={formatMoney(revenue)} color="#22C55E" />
          <StatCard label="Pendente hoje" value={formatMoney(pendingAmount)} color="#FB923C" />
          <StatCard label="Pagamentos confirmados" value={paid.length} />
          <StatCard
            label="Ticket medio"
            value={formatMoney(paid.length ? revenue / paid.length : 0)}
          />
        </div>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Pacientes em atendimento" description="Jornada aberta no momento" />
          {attendances.length === 0 ? (
            <EmptyState
              title="Nenhum paciente em atendimento"
              description="Assim que houver check-in no totem, os pacientes aparecerao aqui."
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
                {attendances.slice(0, 12).map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <Td className="font-medium">
                      {a.patients?.full_name ?? '—'}
                      {a.priority !== 'normal' && (
                        <Badge className="ml-2" color="#EF4444">
                          {a.priority === 'prioritario' ? 'Prioritario' : 'Encaixe'}
                        </Badge>
                      )}
                    </Td>
                    <Td className="text-slate-600">
                      {a.companies?.trade_name ?? a.companies?.legal_name ?? '—'}
                    </Td>
                    <Td>
                      <Badge color={stageColor(a.stage_code)}>{stageName(a.stage_code)}</Badge>
                    </Td>
                    <Td className="text-slate-600">{formatTime(a.checkin_at)}</Td>
                    <Td className="text-slate-600">{elapsedFrom(a.stage_changed_at)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Fluxo por etapa" />
            <CardBody className="space-y-2">
              {counts.filter((c) => c.total > 0).length === 0 ? (
                <p className="text-sm text-slate-500">Sem movimentacao no momento.</p>
              ) : (
                counts
                  .filter((c) => c.total > 0)
                  .map((c) => (
                    <div key={c.stage_code} className="flex items-center justify-between text-sm">
                      <Badge color={stageColor(c.stage_code)}>{stageName(c.stage_code)}</Badge>
                      <span className="font-semibold">{c.total}</span>
                    </div>
                  ))
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Ocupacao das salas" />
            <CardBody className="space-y-2">
              {rooms.length === 0 ? (
                <Alert variant="warning">
                  Nenhuma sala cadastrada. Configure em Administracao.
                </Alert>
              ) : (
                rooms.map((r) => (
                  <div key={r.id} className="flex items-center justify-between text-sm">
                    <span className="text-slate-700">{r.name}</span>
                    <Badge
                      color={
                        r.status === 'disponivel'
                          ? '#22C55E'
                          : r.status === 'ocupada'
                            ? '#3B82F6'
                            : r.status === 'pausada'
                              ? '#FB923C'
                              : '#9CA3AF'
                      }
                    >
                      {r.status}
                    </Badge>
                  </div>
                ))
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
