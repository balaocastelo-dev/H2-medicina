import PainelPage from '../page';

/** TV da sala de espera: chamadas da recepção e da triagem. */
export const dynamic = 'force-dynamic';

export default function PainelRecepcaoPage() {
  return PainelPage({ searchParams: Promise.resolve({ tela: 'recepcao' }) });
}
