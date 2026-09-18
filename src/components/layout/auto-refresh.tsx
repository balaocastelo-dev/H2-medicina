'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

/**
 * Mantém as telas de operação em dia.
 *
 * `router.refresh()` refaz TODAS as consultas da tela atual no servidor. Isso
 * vale a pena na recepção, nas filas e no consultório, onde a informação muda
 * enquanto a pessoa olha. Não vale em Configurações, no cadastro de paciente
 * ou no financeiro: ali a tela recarregava de graça a cada 20 segundos,
 * gastando banco e deixando o sistema pesado sem nada em troca.
 *
 * Pausa enquanto a aba está oculta — uma recepção deixa o sistema aberto o
 * dia inteiro.
 */

/** Telas onde o dado muda sozinho e precisa acompanhar. */
const TELAS_VIVAS = [
  '/recepcao',
  '/triagem',
  '/filas',
  '/medico',
  '/pagamentos',
  '/documentos',
  '/crm',
  '/jornada',
  '/dashboard',
];

/** A pessoa está preenchendo alguma coisa? */
function digitando(): boolean {
  const ativo = document.activeElement;
  if (!ativo) return false;
  const tag = ativo.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    (ativo as HTMLElement).isContentEditable === true
  );
}

export function AutoRefresh({ segundos = 25 }: { segundos?: number }) {
  const router = useRouter();
  const caminho = usePathname();

  const viva = TELAS_VIVAS.some((t) => caminho === t || caminho.startsWith(`${t}/`));

  useEffect(() => {
    if (!viva) return;

    const atualizar = () => {
      if (document.visibilityState !== 'visible') return;
      // Recarregar no meio de um preenchimento faz o campo perder o foco e
      // parece travamento. O próximo ciclo pega.
      if (digitando()) return;
      router.refresh();
    };

    const timer = window.setInterval(atualizar, segundos * 1000);
    document.addEventListener('visibilitychange', atualizar);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', atualizar);
    };
  }, [router, segundos, viva]);

  return null;
}
