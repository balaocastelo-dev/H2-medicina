import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardHeader, StatCard } from '@/components/ui';
import { UserManager, type UserRow } from './user-manager';

export const dynamic = 'force-dynamic';

export default async function UsuariosPage() {
  const ctx = await requirePermission('usuarios.administrar');
  const supabase = await createClient();

  const [usersRes, rolesRes, permsRes] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'id, full_name, email, job_title, council_type, council_number, council_state, is_active, blocked_at, last_sign_in_at, user_roles(roles(name, code))',
      )
      .eq('tenant_id', ctx.tenant.id)
      .is('deleted_at', null)
      .order('full_name')
      .returns<UserRow[]>(),
    supabase
      .from('roles')
      .select('id, code, name, description, role_permissions(permission_code)')
      .eq('tenant_id', ctx.tenant.id)
      .order('name')
      .returns<
        {
          id: string;
          code: string;
          name: string;
          description: string | null;
          role_permissions: { permission_code: string }[];
        }[]
      >(),
    supabase.from('permissions').select('code', { count: 'exact', head: true }),
  ]);

  const users = usersRes.data ?? [];
  const roles = rolesRes.data ?? [];

  return (
    <div>
      <PageHeader
        title="Usuários e permissões"
        description="Crie acessos para administracao, corpo clínico e recepção"
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Usuarios" value={users.length} />
        <StatCard
          label="Ativos"
          value={users.filter((u) => u.is_active && !u.blocked_at).length}
          color="#22C55E"
        />
        <StatCard
          label="Bloqueados"
          value={users.filter((u) => u.blocked_at).length}
          color="#EF4444"
        />
        <StatCard label="Permissões disponíveis" value={permsRes.count ?? 0} />
      </div>

      <div className="grid gap-4 xl:grid-cols-4">
        <div className="xl:col-span-3">
          <UserManager
            users={users}
            podeGerenciarPapeis={ctx.permissions.has('permissoes.administrar')}
            meuId={ctx.userId}
          />
        </div>

        <Card className="h-fit">
          <CardHeader title="Papeis" description="Definidos no seed, editaveis no banco" />
          <div className="divide-y divide-slate-100">
            {roles.map((r) => (
              <div key={r.id} className="p-3">
                <p className="text-sm font-medium">{r.name}</p>
                <p className="text-xs text-slate-500">{r.description}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {r.role_permissions.length} permissao(oes)
                </p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
