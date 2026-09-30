import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Alert, Card, EmptyState, StatCard } from '@/components/ui';
import { inicioDasPendenciasISO, startOfTodayISO } from '@/lib/format';
import { PainelPagamentos, type LinhaPagamento } from './painel';

export const dynamic = 'force-dynamic';

export default async function PagamentosPage() {
  const ctx = await requirePermission('financeiro.ver');
  const supabase = await createClient();

  // A esteira do pagamento: quem saiu da consulta e ainda nao foi liberado
  // para os documentos.
  const { data } = await supabase
    .from('attendances')
    .select(
      'id, stage_code, checkin_at, payment_status, patients(id, full_name, cpf), companies(trade_name, legal_name), queue_tickets(code), payments(id, description, net_amount, status, method), patient_exams(status, exam_types(name, price))',
    )
    .eq('tenant_id', ctx.tenant.id)
    .in('stage_code', ['aguardando_pagamento', 'aguardando_documentos'])
    .is('finished_at', null)
    .is('deleted_at', null)
    // Trinta dias, e nao "hoje".
    //
    // A tela cortava no inicio do dia. Um atendimento que virou a noite em
    // `aguardando_pagamento` — exatamente a etapa onde a CONTA ESTA ABERTA —
    // desaparecia daqui, e de todas as outras telas junto: a de Documentos
    // exige `aguardando_documentos`, o modulo medico nao lista esta etapa, e
    // o CRM tambem cortava em hoje. A clinica ficava sem lugar nenhum de
    // onde cobrar.
    .gte('checkin_at', inicioDasPendenciasISO())
    .order('checkin_at')
    .returns<LinhaPagamento[]>();

  const linhas = data ?? [];
  const aguardando = linhas.filter((l) => l.stage_code === 'aguardando_pagamento');
  const liberados = linhas.filter((l) => l.stage_code === 'aguardando_documentos');

  // O que ficou de outro dia precisa ser dito, nao so listado: a esteira de
  // hoje e uma coisa, conta velha em aberto e outra.
  const hoje = startOfTodayISO();
  const deOutrosDias = linhas.filter((l) => l.checkin_at < hoje);

  const emAberto = linhas.reduce(
    (soma, l) =>
      soma +
      (l.payments ?? [])
        .filter((p) => p.status === 'pendente')
        .reduce((s, p) => s + Number(p.net_amount), 0),
    0,
  );
  const recebido = linhas.reduce(
    (soma, l) =>
      soma +
      (l.payments ?? [])
        .filter((p) => p.status === 'pago')
        .reduce((s, p) => s + Number(p.net_amount), 0),
    0,
  );

  return (
    <div>
      <PageHeader
        title="Pagamentos"
        description="Etapa entre a consulta e a emissão dos documentos"
      />

      <div className="mb-4 space-y-2">
        <Alert variant="info">
          Nenhum documento é emitido antes de a conta fechar. Confirme o pagamento e clique em
          <strong> Liberar documentos</strong> para o paciente seguir na esteira.
        </Alert>
        {deOutrosDias.length > 0 && (
          <Alert variant="warning">
            <strong>
              {deOutrosDias.length} atendimento{deOutrosDias.length > 1 ? 's' : ''} de dias
              anteriores
            </strong>{' '}
            ainda {deOutrosDias.length > 1 ? 'estão' : 'está'} nesta esteira — aparece
            {deOutrosDias.length > 1 ? 'm' : ''} com a data de chegada na lista. Confirme o
            pagamento ou cancele o atendimento no CRM para tirá-
            {deOutrosDias.length > 1 ? 'los' : 'lo'} daqui.
          </Alert>
        )}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Aguardando pagamento" value={aguardando.length} color="#F59E0B" />
        <StatCard label="Liberados p/ documentos" value={liberados.length} color="#22C55E" />
        <StatCard
          label="Em aberto"
          value={emAberto.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
          color="#EF4444"
        />
        <StatCard
          label="Recebido"
          value={recebido.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
          color="#22C55E"
        />
      </div>

      {linhas.length === 0 ? (
        <Card>
          <EmptyState
            title="Ninguém aguardando pagamento"
            description="Assim que o médico finalizar uma consulta, o paciente aparece aqui."
          />
        </Card>
      ) : (
        <PainelPagamentos
          linhas={linhas}
          podeCobrar={ctx.permissions.has('financeiro.registrar')}
        />
      )}
    </div>
  );
}
