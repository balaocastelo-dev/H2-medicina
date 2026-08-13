'use server';

import { createClient } from '@/lib/supabase/server';
import { getSessionContext } from '@/lib/auth';
import { type ActionResult, fail, ok, toFriendlyError } from '@/lib/action-result';

/**
 * Progresso do guia por usuario.
 *
 * Falha aqui nunca pode atrapalhar o trabalho: se o banco nao responder, o
 * guia simplesmente nao aparece (ou aparece de novo). Nenhuma dessas duas
 * situacoes impede alguem de atender.
 */

export interface ProgressoDoGuia {
  guide_key: string;
  completed_at: string | null;
  skipped_at: string | null;
}

/** Telas que a pessoa ja viu, para o guia nao reaparecer nelas. */
export async function guiasJaVistos(): Promise<string[]> {
  try {
    const ctx = await getSessionContext();
    if (!ctx) return [];
    const supabase = await createClient();

    const { data } = await supabase
      .from('user_guide_progress')
      .select('guide_key, completed_at, skipped_at')
      .eq('user_id', ctx.userId)
      .returns<ProgressoDoGuia[]>();

    return (data ?? [])
      .filter((p) => p.completed_at !== null || p.skipped_at !== null)
      .map((p) => p.guide_key);
  } catch {
    return [];
  }
}

/** Marca a tela como vista, tendo a pessoa ido ate o fim ou pulado. */
export async function registrarGuia(
  guideKey: string,
  desfecho: 'concluido' | 'pulado',
  ultimoPasso = 0,
): Promise<ActionResult> {
  try {
    const ctx = await getSessionContext();
    if (!ctx) return fail('Sessão expirada.');
    const supabase = await createClient();

    const agora = new Date().toISOString();

    // `seen_count` sobe a cada passagem: ver o guia da mesma tela cinco
    // vezes e sinal de que o texto nao esta resolvendo a duvida.
    const { data: existente } = await supabase
      .from('user_guide_progress')
      .select('id, seen_count')
      .eq('user_id', ctx.userId)
      .eq('guide_key', guideKey)
      .maybeSingle<{ id: string; seen_count: number }>();

    const campos = {
      last_step: ultimoPasso,
      completed_at: desfecho === 'concluido' ? agora : null,
      skipped_at: desfecho === 'pulado' ? agora : null,
      seen_count: (existente?.seen_count ?? 0) + 1,
    };

    const { error } = existente
      ? await supabase.from('user_guide_progress').update(campos).eq('id', existente.id)
      : await supabase.from('user_guide_progress').insert({
          tenant_id: ctx.tenant.id,
          user_id: ctx.userId,
          guide_key: guideKey,
          ...campos,
        });

    if (error) return fail(toFriendlyError(error));
    return ok();
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/** Zera a memoria do guia: ele volta a aparecer sozinho em todas as telas. */
export async function reiniciarGuia(): Promise<ActionResult> {
  try {
    const ctx = await getSessionContext();
    if (!ctx) return fail('Sessão expirada.');
    const supabase = await createClient();

    const { error } = await supabase
      .from('user_guide_progress')
      .delete()
      .eq('user_id', ctx.userId);
    if (error) return fail(toFriendlyError(error));

    return ok(undefined, 'O guia vai aparecer de novo em cada tela.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}
