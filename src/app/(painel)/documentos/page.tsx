import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Card, EmptyState, Table, Td, Th } from '@/components/ui';
import { formatDateTime, sinceISO } from '@/lib/format';
import { DocumentActions, GenerateDocumentCard } from './client';

export const dynamic = 'force-dynamic';

export interface DocRow {
  id: string;
  kind: string;
  title: string;
  verification_code: string | null;
  generated_at: string;
  patients: { full_name: string } | null;
}

export default async function DocumentosPage() {
  const ctx = await requirePermission('documentos.emitir');
  const supabase = await createClient();

  const [docsRes, attendancesRes] = await Promise.all([
    supabase
      .from('documents')
      .select('id, kind, title, verification_code, generated_at, patients(full_name)')
      .eq('tenant_id', ctx.tenant.id)
      .is('deleted_at', null)
      .order('generated_at', { ascending: false })
      .limit(100)
      .returns<DocRow[]>(),
    supabase
      .from('attendances')
      .select('id, checkin_at, patients(full_name)')
      .eq('tenant_id', ctx.tenant.id)
      .gte('checkin_at', sinceISO(7))
      .is('deleted_at', null)
      .order('checkin_at', { ascending: false })
      .limit(100)
      .returns<{ id: string; checkin_at: string; patients: { full_name: string } | null }[]>(),
  ]);

  return (
    <div>
      <PageHeader
        title="Documentos"
        description="PDFs personalizados com a marca do tenant, armazenados em bucket privado"
      />

      <div className="mb-4">
        <GenerateDocumentCard attendances={attendancesRes.data ?? []} />
      </div>

      <Card>
        {(docsRes.data ?? []).length === 0 ? (
          <EmptyState
            title="Nenhum documento emitido"
            description="Gere o primeiro documento acima."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Documento</Th>
                <Th>Paciente</Th>
                <Th>Tipo</Th>
                <Th>Codigo</Th>
                <Th>Emitido em</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {(docsRes.data ?? []).map((d) => (
                <tr key={d.id} className="hover:bg-slate-50">
                  <Td className="font-medium">{d.title}</Td>
                  <Td className="text-slate-600">{d.patients?.full_name ?? '—'}</Td>
                  <Td className="text-slate-600">{d.kind}</Td>
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
