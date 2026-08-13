'use client';

import { getDocumentUrl } from '@/modules/documents/actions';

/**
 * Abre um documento do storage em outra aba.
 *
 * O navegador so deixa `window.open` passar quando ele acontece dentro do
 * clique. Como a URL assinada so chega depois de uma ida ao servidor, a aba
 * e aberta em branco na hora do clique e recebe o endereco quando ele
 * chega — era isso que fazia o botao de imprimir "nao fazer nada".
 *
 * Devolve a URL tambem, para a tela poder oferecer um link visivel caso o
 * navegador ainda assim tenha bloqueado a aba.
 */
export async function abrirDocumentoEmNovaAba(
  documentId: string,
): Promise<{ ok: true; url: string; abriu: boolean } | { ok: false; error: string }> {
  const janela = typeof window !== 'undefined' ? window.open('', '_blank', 'noopener') : null;

  const resultado = await getDocumentUrl(documentId);

  if (!resultado.ok || !resultado.data) {
    janela?.close();
    return { ok: false, error: resultado.ok ? 'Documento sem arquivo.' : resultado.error };
  }

  if (janela && !janela.closed) {
    janela.location.href = resultado.data.url;
    return { ok: true, url: resultado.data.url, abriu: true };
  }

  return { ok: true, url: resultado.data.url, abriu: false };
}
