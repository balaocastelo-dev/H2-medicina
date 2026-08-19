import PainelPage from '../page';

/** TV do corredor: chamadas das salas de exame e dos consultórios. */
export const dynamic = 'force-dynamic';

export default function PainelSalasPage() {
  return PainelPage({ searchParams: Promise.resolve({ tela: 'salas' }) });
}
