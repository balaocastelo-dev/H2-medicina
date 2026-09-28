import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardBody, CardHeader } from '@/components/ui';
import { CadastroDeSalas, CadastroDeExames } from './client';

export const dynamic = 'force-dynamic';

/**
 * Salas e tipos de exame, no cadastro da propria clinica.
 *
 * "no futuro a gente quiser fazer outro tipo de exame, ou entao se no
 *  futuro a gente for trocar a ordem das salas... sera que tem como a
 *  gente ter mais autonomia sobre isso?" -- Isabella, 25/09.
 *
 * Ate aqui cada equipamento que mudava de sala virava um comando escrito
 * a mao no banco de dados.
 */
export default async function SalasEExamesPage() {
  const ctx = await requirePermission('salas.administrar');
  const supabase = await createClient();

  const [{ data: salas }, { data: exames }] = await Promise.all([
    supabase
      .from('rooms')
      .select('id, code, name, kind, sort_order, is_active, current_attendance_id')
      .eq('tenant_id', ctx.tenant.id)
      .is('deleted_at', null)
      .order('sort_order')
      .returns<
        {
          id: string;
          code: string;
          name: string;
          kind: string;
          sort_order: number;
          is_active: boolean;
          current_attendance_id: string | null;
        }[]
      >(),
    supabase
      .from('exam_types')
      .select('id, code, name, default_room_id, price, average_minutes, sort_order, is_active, ocupa_sala')
      .eq('tenant_id', ctx.tenant.id)
      .is('deleted_at', null)
      .order('sort_order')
      .returns<
        {
          id: string;
          code: string;
          name: string;
          default_room_id: string | null;
          price: number | null;
          average_minutes: number;
          sort_order: number;
          is_active: boolean;
          ocupa_sala: boolean;
        }[]
      >(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Salas e exames"
        description="O que a clínica realiza e onde cada exame acontece"
      />

      <Card>
        <CardHeader
          title="Antes de mexer"
          description="Três coisas que o sistema não deixa fazer, e o motivo"
        />
        <CardBody>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
            <li>
              Uma sala não pode ser desativada enquanto for a sala de algum exame ativo. Sem sala,
              o exame não aparece em fila nenhuma e o paciente fica esperando uma chamada que não
              vem.
            </li>
            <li>
              Um exame não pode ser desativado enquanto houver atendimento em aberto com ele
              pedido.
            </li>
            <li>
              Nada é apagado — só desativado. O que já foi feito continua no histórico do paciente
              e nos documentos emitidos.
            </li>
          </ul>
        </CardBody>
      </Card>

      <CadastroDeSalas salas={salas ?? []} />
      <CadastroDeExames exames={exames ?? []} salas={salas ?? []} />
    </div>
  );
}
