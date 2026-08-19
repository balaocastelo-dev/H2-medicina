import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Card, EmptyState } from '@/components/ui';
import { FormValoresDoMedico } from './client';

export const dynamic = 'force-dynamic';

export default async function ValoresDoMedicoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requirePermission('usuarios.administrar');
  const { id } = await params;
  const supabase = await createClient();

  const { data: medico } = await supabase
    .from('profiles')
    .select('id, full_name, job_title, council_type, council_number, council_state')
    .eq('id', id)
    .eq('tenant_id', ctx.tenant.id)
    .maybeSingle<{
      id: string;
      full_name: string | null;
      job_title: string | null;
      council_type: string | null;
      council_number: string | null;
      council_state: string | null;
    }>();
  if (!medico) notFound();

  const [procedimentos, valores] = await Promise.all([
    supabase
      .from('procedure_types')
      .select('id, code, name, default_fee')
      .eq('tenant_id', ctx.tenant.id)
      .eq('is_active', true)
      .order('sort_order')
      .returns<{ id: string; code: string; name: string; default_fee: number }[]>(),
    supabase
      .from('medical_fees')
      .select('procedure_type_id, fee')
      .eq('profile_id', id)
      .returns<{ procedure_type_id: string; fee: number }[]>(),
  ]);

  const proprio = new Map((valores.data ?? []).map((v) => [v.procedure_type_id, Number(v.fee)]));
  const lista = (procedimentos.data ?? []).map((p) => ({
    code: p.code,
    name: p.name,
    padrao: Number(p.default_fee),
    proprio: proprio.get(p.id) ?? null,
  }));

  const registro = medico.council_number
    ? `${medico.council_type ?? 'CRM'} ${medico.council_number}${medico.council_state ? '/' + medico.council_state : ''}`
    : null;

  return (
    <div>
      <PageHeader
        title={`Repasse — ${medico.full_name ?? 'Médico'}`}
        description={[medico.job_title, registro].filter(Boolean).join(' · ') || undefined}
        actions={
          <Link href="/usuarios" className="text-sm text-slate-500 underline">
            voltar aos usuários
          </Link>
        }
      />

      {lista.length === 0 ? (
        <Card>
          <EmptyState
            title="Nenhum procedimento cadastrado"
            description="Cadastre a tabela em Financeiro › Repasse médico."
          />
        </Card>
      ) : (
        <FormValoresDoMedico profileId={medico.id} procedimentos={lista} />
      )}
    </div>
  );
}
