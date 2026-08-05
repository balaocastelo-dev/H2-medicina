import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Healthcheck para verificar o deploy.
 * GET /api/health
 *
 * Nao expoe segredo algum: informa apenas se a configuracao existe e se o
 * banco respondeu, nunca os valores das variaveis.
 */
export async function GET() {
  const configured = isSupabaseConfigured();
  const report: Record<string, unknown> = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    supabase: { configured, reachable: false, migrations: false, tenants: 0 },
    serviceRole: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    encryptionKey: Boolean(process.env.SECRETS_ENCRYPTION_KEY),
  };

  if (!configured) {
    report.status = 'incompleto';
    report.hint =
      'Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY nas variaveis de ambiente e refaca o deploy.';
    return NextResponse.json(report, { status: 503 });
  }

  try {
    const supabase = process.env.SUPABASE_SERVICE_ROLE_KEY
      ? createAdminClient()
      : await createClient();
    const { count, error } = await supabase
      .from('tenants')
      .select('id', { count: 'exact', head: true });

    if (error) {
      report.status = 'sem_migrations';
      report.hint =
        'Banco alcancado, mas a tabela tenants não respondeu. Rode as migrations (npm run db:push) e o seed.';
      (report.supabase as Record<string, unknown>).reachable = true;
      return NextResponse.json(report, { status: 503 });
    }

    Object.assign(report.supabase as Record<string, unknown>, {
      reachable: true,
      migrations: true,
      tenants: count ?? 0,
    });

    if ((count ?? 0) === 0) {
      report.status = 'sem_seed';
      report.hint = 'Migrations aplicadas, mas nenhum tenant cadastrado. Rode npm run db:seed.';
      return NextResponse.json(report, { status: 503 });
    }

    return NextResponse.json(report);
  } catch {
    report.status = 'erro';
    report.hint = 'Não foi possível falar com o Supabase. Confira a URL e a chave pública.';
    return NextResponse.json(report, { status: 503 });
  }
}
