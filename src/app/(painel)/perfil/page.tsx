import { requireSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardBody, CardHeader } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { MinhaAssinatura } from './assinatura';

export const dynamic = 'force-dynamic';

export default async function PerfilPage() {
  const ctx = await requireSession();
  const supabase = await createClient();

  const { data: perfil } = await supabase
    .from('profiles')
    .select('signature_path, signature_updated_at, council_type, council_number, council_state')
    .eq('id', ctx.userId)
    .maybeSingle<{
      signature_path: string | null;
      signature_updated_at: string | null;
      council_type: string | null;
      council_number: string | null;
      council_state: string | null;
    }>();

  // A imagem fica em bucket privado: a tela recebe um link temporario.
  let previa: string | null = null;
  if (perfil?.signature_path) {
    const { data } = await supabase.storage
      .from('signatures')
      .createSignedUrl(perfil.signature_path, 300);
    previa = data?.signedUrl ?? null;
  }

  const registro = perfil?.council_number
    ? `${perfil.council_type ?? 'CRM'} ${perfil.council_number}${perfil.council_state ? '/' + perfil.council_state : ''}`
    : null;

  return (
    <div>
      <PageHeader title="Meu perfil" description={ctx.profile.full_name || ctx.email || ''} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Meus dados" />
          <CardBody className="space-y-1 text-sm">
            <p>
              <span className="text-slate-500">Nome:</span> {ctx.profile.full_name || '—'}
            </p>
            <p>
              <span className="text-slate-500">E-mail:</span> {ctx.email ?? '—'}
            </p>
            <p>
              <span className="text-slate-500">Registro:</span> {registro ?? '—'}
            </p>
            <p className="pt-2 text-xs text-slate-400">
              Para alterar nome, e-mail ou registro, fale com quem administra o sistema.
            </p>
          </CardBody>
        </Card>

        <MinhaAssinatura
          profileId={ctx.userId}
          previaAtual={previa}
          atualizadaEm={
            perfil?.signature_updated_at ? formatDateTime(perfil.signature_updated_at) : null
          }
          temRegistro={!!registro}
        />
      </div>
    </div>
  );
}
