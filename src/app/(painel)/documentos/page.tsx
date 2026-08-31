import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, Card, EmptyState, Table, Td, Th } from '@/components/ui';
import { daysAgoISO, formatDateTime, todayISO } from '@/lib/format';
import { DocumentActions, GenerateDocumentCard } from './client';
import { FiltrosDeDocumento } from './filtros';

export const dynamic = 'force-dynamic';

export interface DocRow {
  id: string;
  kind: string;
  title: string;
  verification_code: string | null;
  generated_at: string;
  patients: { full_name: string } | null;
  attendances: { finished_at: string | null } | null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Rotulos dos tipos, para a tela nao mostrar o codigo cru do banco. */
const TIPOS: Record<string, string> = {
  aso: 'A.S.O.',
  ficha_clinica: 'Ficha clínica',
  relacao_exames: 'Relação de exames',
  resultado_exame: 'Resultado de exame',
  resumo_atendimento: 'Resumo do atendimento',
  atestado_comparecimento: 'Atestado de comparecimento',
  comprovante_comparecimento: 'Comprovante de comparecimento',
  comprovante_agendamento: 'Comprovante de agendamento',
  documento_final: 'Documento final',
  recibo: 'Recibo',
};

export default async function DocumentosPage({
  searchParams,
}: {
  searchParams: Promise<{ situacao?: string; tipo?: string; de?: string; ate?: string }>;
}) {
  const ctx = await requirePermission('documentos.emitir');
  const sp = await searchParams;
  const supabase = await createClient();

  const de = ISO.test(sp.de ?? '') ? sp.de! : daysAgoISO(30);
  const ate = ISO.test(sp.ate ?? '') ? sp.ate! : todayISO();

  let consulta = supabase
    .from('documents')
    .select(
      'id, kind, title, verification_code, generated_at, patients(full_name), attendances(finished_at)',
    )
    .eq('tenant_id', ctx.tenant.id)
    .is('deleted_at', null)
    .gte('generated_at', `${de}T00:00:00`)
    .lte('generated_at', `${ate}T23:59:59`);

  if (sp.tipo) consulta = consulta.eq('kind', sp.tipo);

  const [docsRes, attendancesRes] = await Promise.all([
    consulta.order('generated_at', { ascending: false }).limit(300).returns<DocRow[]>(),
    supabase
      .from('attendances')
      .select('id, checkin_at, patients(full_name)')
      .eq('tenant_id', ctx.tenant.id)
      // Somente quem passou pelo pagamento: a esteira e recepcao -> ... ->
      // medico -> pagamento -> documentos.
      .in('stage_code', ['aguardando_documentos', 'finalizado'])
      .gte('checkin_at', `${de}T00:00:00`)
      .is('deleted_at', null)
      .order('checkin_at', { ascending: false })
      .limit(100)
      .returns<{ id: string; checkin_at: string; patients: { full_name: string } | null }[]>(),
  ]);

  /**
   * "ter um filtro para 'concluidos' e 'em aberto' das pessoas que ainda nao
   *  foi encerrado o atendimento"
   *
   * O corte e o fim do atendimento, nao a emissao do documento: a recepcao
   * quer separar quem ainda esta na clinica de quem ja foi embora.
   */
  const todos = docsRes.data ?? [];
  const emAberto = (d: DocRow) => !!d.attendances && !d.attendances.finished_at;
  const linhas =
    sp.situacao === 'aberto'
      ? todos.filter(emAberto)
      : sp.situacao === 'concluido'
        ? todos.filter((d) => !emAberto(d))
        : todos;

  return (
    <div>
      <PageHeader
        title="Documentos"
        description="PDFs com o cabeçalho e o rodapé da clínica, guardados em bucket privado"
      />

      <div className="mb-4">
        <GenerateDocumentCard attendances={attendancesRes.data ?? []} />
      </div>

      <Card>
        <div className="border-b border-slate-100 p-4">
          <FiltrosDeDocumento
            de={de}
            ate={ate}
            tipos={Object.entries(TIPOS).map(([value, label]) => ({ value, label }))}
          />
        </div>

        {linhas.length === 0 ? (
          <EmptyState
            title="Nenhum documento no período"
            description="Ajuste o período ou os filtros acima."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Documento</Th>
                <Th>Paciente</Th>
                <Th>Tipo</Th>
                <Th>Atendimento</Th>
                <Th>Código</Th>
                <Th>Emitido em</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {linhas.map((d) => (
                <tr key={d.id} className="hover:bg-slate-50">
                  <Td className="font-medium">{d.title}</Td>
                  <Td className="text-slate-600">{d.patients?.full_name ?? '—'}</Td>
                  <Td className="text-slate-600">{TIPOS[d.kind] ?? d.kind}</Td>
                  <Td>
                    {!d.attendances ? (
                      <span className="text-slate-400">—</span>
                    ) : emAberto(d) ? (
                      <Badge color="#FB923C">em aberto</Badge>
                    ) : (
                      <Badge color="#22C55E">concluído</Badge>
                    )}
                  </Td>
                  <Td className="font-mono text-xs">{d.verification_code ?? '—'}</Td>
                  <Td className="text-slate-500">{formatDateTime(d.generated_at)}</Td>
                  <Td>
                    <DocumentActions documentId={d.id} />
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
