import PainelPage from '../painel/page';

/**
 * TV 2 — corredor dos exames e consultorios.
 *
 * Mesma tela de /painel/salas, com endereco curto para digitar na TV.
 */
export const dynamic = 'force-dynamic';

export default function Tv2Page() {
  return PainelPage({ searchParams: Promise.resolve({ tela: 'salas' }) });
}
