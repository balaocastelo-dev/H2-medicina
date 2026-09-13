import PainelPage from '../painel/page';

/**
 * TV 1 — sala de espera.
 *
 * Endereco curto porque quem digita isso esta de pe, na frente da TV, com
 * um controle remoto na mao. /painel/recepcao e a mesma tela.
 */
export const dynamic = 'force-dynamic';

export default function Tv1Page() {
  return PainelPage({ searchParams: Promise.resolve({ tela: 'recepcao' }) });
}
