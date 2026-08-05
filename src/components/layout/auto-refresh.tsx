'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Mantém os contadores do menu em dia.
 *
 * Recarrega os dados do servidor em intervalo fixo, e imediatamente quando a
 * pessoa volta para a aba. Pausa enquanto a aba está oculta para não gastar
 * requisição à toa numa recepção que fica o dia todo aberta.
 */
export function AutoRefresh({ segundos = 20 }: { segundos?: number }) {
  const router = useRouter();

  useEffect(() => {
    const atualizar = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };

    const timer = window.setInterval(atualizar, segundos * 1000);
    document.addEventListener('visibilitychange', atualizar);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', atualizar);
    };
  }, [router, segundos]);

  return null;
}
