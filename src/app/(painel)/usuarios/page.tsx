import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, Card, CardHeader, EmptyState, Table, Td, Th } from '@/components/ui';
import { formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface UserRow {
  id: string;
  full_name: string;
  email: string | null;
  job_title: string | null;
  is_active: boolean;
  blocked_at: string | null;
  last_sign_in_at: string | null;
  user_roles: { roles: { name: string; code: string } | null }[];
}

export default async function UsuariosPage() {
  const ctx = await requirePermission('usuarios.administrar');
  const supabase = await createClient();

  const [usersRes, rolesRes, permsRes] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'id, full_name, email, job_title, is_active, blocked_at, last_sign_in_at, user_roles(roles(name, code))',
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
    supabase
      .from('permissions')
      .select('code, module, name')
      .order('module')
      .returns<{ code: string; module: string; name: string }[]>(),
  ]);

  const users = usersRes.data ?? [];
  const roles = rolesRes.data ?? [];

  return (
    <div>
      <PageHeader
        title="Usuarios e permissoes"
        description="Perfis, papeis e permissoes granulares deste tenant"
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Usuarios" description={`${users.length} conta(s)`} />
          {users.length === 0 ? (
            <EmptyState
              title="Nenhum usuario"
              description="Crie usuarios no Supabase Auth e vincule o perfil ao tenant."
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Nome</Th>
                  <Th>E-mail</Th>
                  <Th>Papeis</Th>
                  <Th>Situacao</Th>
                  <Th>Ultimo acesso</Th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <Td className="font-medium">{u.full_name || '—'}</Td>
                    <Td className="text-slate-600">{u.email ?? '—'}</Td>
                    <Td className="text-xs">
                      {u.user_roles
                        .map((r) => r.roles?.name)
                        .filter(Boolean)
                        .join(', ') || '—'}
                    </Td>
                    <Td>
                      <Badge color={u.blocked_at ? '#EF4444' : u.is_active ? '#22C55E' : '#9CA3AF'}>
                        {u.blocked_at ? 'bloqueado' : u.is_active ? 'ativo' : 'inativo'}
                      </Badge>
                    </Td>
                    <Td className="text-slate-500">{formatDateTime(u.last_sign_in_at)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Papeis"
            description={`${permsRes.data?.length ?? 0} permissoes disponiveis`}
          />
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
