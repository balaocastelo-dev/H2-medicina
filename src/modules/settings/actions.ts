'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { assertPermission } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { type ActionResult, fail, ok, toFriendlyError } from '@/lib/action-result';

/** Salva um grupo de configuracoes do tenant (chave/valor). */
export async function saveTenantSettings(
  groupKey: string,
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('whitelabel.configurar');
    const supabase = await createClient();

    const settings: Record<string, unknown> = {};
    for (const [key, value] of formData.entries()) {
      if (key.startsWith('$')) continue;
      const str = String(value);
      if (str === 'on') settings[key] = true;
      else if (str === '') settings[key] = null;
      else settings[key] = str;
    }

    const { data: previous } = await supabase
      .from('tenant_settings')
      .select('settings')
      .eq('tenant_id', ctx.tenant.id)
      .eq('group_key', groupKey)
      .maybeSingle<{ settings: Record<string, unknown> }>();

    const merged = { ...(previous?.settings ?? {}), ...settings };

    const { error } = await supabase
      .from('tenant_settings')
      .upsert(
        { tenant_id: ctx.tenant.id, group_key: groupKey, settings: merged },
        { onConflict: 'tenant_id,group_key' },
      );
    if (error) return fail(toFriendlyError(error));

    await audit(ctx, {
      action: 'update',
      entity: 'tenant_settings',
      description: `Configuracoes "${groupKey}" atualizadas`,
      previous: previous?.settings,
      next: merged,
    });

    revalidatePath('/configuracoes');
    revalidatePath('/', 'layout');
    return ok(undefined, 'Configurações salvas.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/** Salva marca e cores (aplicadas em todo o sistema, PDFs e telas dedicadas). */
export async function saveBranding(_prev: unknown, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('whitelabel.configurar');
    const supabase = await createClient();

    const statusColors: Record<string, string> = {};
    for (const [key, value] of formData.entries()) {
      if (key.startsWith('status_')) statusColors[key.replace('status_', '')] = String(value);
    }

    const payload = {
      tenant_id: ctx.tenant.id,
      system_name: String(formData.get('system_name') ?? ctx.branding.system_name),
      logo_url: (formData.get('logo_url') as string) || null,
      logo_compact_url: (formData.get('logo_compact_url') as string) || null,
      favicon_url: (formData.get('favicon_url') as string) || null,
      color_primary: String(formData.get('color_primary') ?? '#0F766E'),
      color_secondary: String(formData.get('color_secondary') ?? '#0EA5E9'),
      color_accent: String(formData.get('color_accent') ?? '#F59E0B'),
      color_sidebar: String(formData.get('color_sidebar') ?? '#0B1220'),
      footer_text: (formData.get('footer_text') as string) || null,
      pdf_header_html: (formData.get('pdf_header_html') as string) || null,
      pdf_footer_html: (formData.get('pdf_footer_html') as string) || null,
      status_colors: Object.keys(statusColors).length ? statusColors : ctx.branding.status_colors,
    };

    const { error } = await supabase
      .from('tenant_branding')
      .upsert(payload, { onConflict: 'tenant_id' });
    if (error) return fail(toFriendlyError(error));

    await audit(ctx, {
      action: 'update',
      entity: 'tenant_branding',
      description: 'Identidade visual atualizada',
      previous: ctx.branding,
      next: payload,
    });

    revalidatePath('/', 'layout');
    return ok(undefined, 'Marca atualizada.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/** Liga/desliga modulos do tenant. */
export async function toggleModule(moduleKey: string, enabled: boolean): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('whitelabel.configurar');
    const supabase = await createClient();
    const { error } = await supabase
      .from('tenant_modules')
      .upsert(
        { tenant_id: ctx.tenant.id, module_key: moduleKey, is_enabled: enabled },
        { onConflict: 'tenant_id,module_key' },
      );
    if (error) return fail(toFriendlyError(error));

    await audit(ctx, {
      action: 'update',
      entity: 'tenant_modules',
      description: `Modulo ${moduleKey} ${enabled ? 'habilitado' : 'desabilitado'}`,
    });
    revalidatePath('/', 'layout');
    return ok(undefined, 'Módulos atualizados.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}
