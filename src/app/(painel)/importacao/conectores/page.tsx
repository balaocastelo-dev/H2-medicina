import { requireModulePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Alert, Badge, Card, CardHeader, EmptyState, Table, Td, Th } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import type { ScraperConnectorSafe } from '@/types/entities';

export const dynamic = 'force-dynamic';

export default async function ConectoresPage() {
  const ctx = await requireModulePermission('scraper', 'scraper.administrar');
  const supabase = await createClient();

  // View segura: nunca expoe a senha do portal externo
  const { data } = await supabase
    .from('scraper_connectors_safe')
    .select('*')
    .eq('tenant_id', ctx.tenant.id)
    .order('name')
    .returns<ScraperConnectorSafe[]>();

  const rows = data ?? [];

  return (
    <div>
      <PageHeader
        title="Conectores de importacao"
        description="Coleta autorizada de agenda em portais externos, API, CSV ou Excel"
      />

      <div className="mb-4 space-y-3">
        <Alert variant="warning" title="Uso autorizado">
          Os conectores so podem ser usados em portais para os quais o tenant possui autorizacao
          expressa. A execucao fica bloqueada enquanto a autorizacao nao for confirmada no cadastro.
          Nao ha suporte a quebra de CAPTCHA, contorno de autenticacao ou coleta fora do escopo
          autorizado.
        </Alert>
        <Alert variant="info">
          As credenciais do portal ficam cifradas no servidor e nunca sao enviadas ao navegador nem
          gravadas em logs. Quando houver API ou exportacao oficial, prefira o modo API/CSV/Excel.
        </Alert>
      </div>

      <Card>
        <CardHeader title="Conectores cadastrados" description={`${rows.length} conector(es)`} />
        {rows.length === 0 ? (
          <EmptyState
            title="Nenhum conector configurado"
            description="Cadastre um conector informando URL, autenticacao, seletores e mapeamento de campos."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Nome</Th>
                <Th>Tipo</Th>
                <Th>Modo</Th>
                <Th>Credencial</Th>
                <Th>Autorizacao</Th>
                <Th>Situacao</Th>
                <Th>Ultima execucao</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <Td>
                    <span className="font-medium">{c.name}</span>
                    <p className="text-xs text-slate-500">{c.base_url ?? '—'}</p>
                  </Td>
                  <Td className="text-slate-600">{c.kind}</Td>
                  <Td>{c.run_mode}</Td>
                  <Td>
                    <Badge color={c.has_password ? '#22C55E' : '#9CA3AF'}>
                      {c.has_password ? 'cifrada' : 'nao definida'}
                    </Badge>
                  </Td>
                  <Td>
                    <Badge color={c.authorization_confirmed ? '#22C55E' : '#EF4444'}>
                      {c.authorization_confirmed ? 'confirmada' : 'pendente'}
                    </Badge>
                  </Td>
                  <Td>
                    <Badge color={c.is_active ? '#22C55E' : '#9CA3AF'}>
                      {c.is_active ? 'ativo' : 'inativo'}
                    </Badge>
                  </Td>
                  <Td className="text-slate-500">{formatDateTime(c.last_run_at)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
