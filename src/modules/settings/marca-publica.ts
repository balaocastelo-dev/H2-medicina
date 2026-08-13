import 'server-only';
import { cache } from 'react';
import { createAdminClient } from '@/lib/supabase/admin';
import { publicEnv } from '@/lib/env';

/**
 * Marca e unidade para as telas abertas ao publico.
 *
 * `tenants` e `tenant_branding` estao protegidos por RLS, e com razao: um
 * visitante anonimo nao deve varrer os tenants da plataforma. So que isso
 * derrubava tambem o basico — logo e nome — nas paginas que existem
 * justamente para quem nao tem login. O resultado era a tela de
 * agendamento dizendo "indisponivel" e o login sem logo.
 *
 * A leitura passa a ser feita com a chave de servico, restrita ao tenant
 * do proprio deploy (vem da variavel de ambiente, nao do navegador) e
 * devolvendo apenas campos de vitrine. Nenhum dado de paciente sai daqui.
 */

export interface MarcaPublica {
  tenantId: string;
  legalName: string;
  tradeName: string;
  systemName: string;
  logoUrl: string | null;
  logoCompactUrl: string | null;
  colorPrimary: string;
  footerText: string | null;
  pdfHeaderHtml: string | null;
}

export const marcaPublica = cache(async (): Promise<MarcaPublica | null> => {
  try {
    const admin = createAdminClient();

    const { data: tenant } = await admin
      .from('tenants')
      .select('id, legal_name, trade_name')
      .eq('slug', publicEnv.NEXT_PUBLIC_DEFAULT_TENANT_SLUG)
      .maybeSingle<{ id: string; legal_name: string; trade_name: string }>();

    if (!tenant) return null;

    const { data: branding } = await admin
      .from('tenant_branding')
      .select('system_name, logo_url, logo_compact_url, color_primary, footer_text, pdf_header_html')
      .eq('tenant_id', tenant.id)
      .maybeSingle<{
        system_name: string;
        logo_url: string | null;
        logo_compact_url: string | null;
        color_primary: string;
        footer_text: string | null;
        pdf_header_html: string | null;
      }>();

    return {
      tenantId: tenant.id,
      legalName: tenant.legal_name,
      tradeName: tenant.trade_name,
      systemName: branding?.system_name ?? tenant.trade_name,
      logoUrl: branding?.logo_url ?? null,
      logoCompactUrl: branding?.logo_compact_url ?? null,
      colorPrimary: branding?.color_primary ?? '#0F766E',
      footerText: branding?.footer_text ?? null,
      pdfHeaderHtml: branding?.pdf_header_html ?? null,
    };
  } catch {
    // Sem a chave de servico configurada, a pagina ainda precisa abrir —
    // apenas sem logo.
    return null;
  }
});
