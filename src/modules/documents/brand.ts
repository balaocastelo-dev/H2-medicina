import 'server-only';
import type { SessionContext } from '@/lib/auth';
import { carregarLogo, type PdfBrand } from './pdf';

/**
 * Identidade visual do tenant aplicada aos documentos em PDF.
 *
 * Estava repetida em tres lugares (documentos, termo de autorizacao e
 * contrato) e as tres copias comecaram a divergir. Agora e uma so: mudou
 * aqui, muda em todo papel que sai da clinica.
 */
export async function marcaDoTenant(ctx: SessionContext): Promise<PdfBrand> {
  const empresa = (ctx.settings.empresa ?? {}) as Record<string, string | null>;
  const contato = (ctx.settings.contato ?? {}) as Record<string, string | null>;
  const documentos = (ctx.settings.documentos ?? {}) as Record<string, string | null>;

  const endereco = [
    contato.logradouro,
    contato.numero,
    contato.complemento,
    contato.bairro,
    contato.cidade,
    contato.estado,
  ]
    .filter(Boolean)
    .join(', ');

  const contatoLinha = [contato.telefone, contato.whatsapp, contato.email, empresa.site]
    .filter(Boolean)
    .join(' · ');

  return {
    systemName: ctx.branding.system_name,
    legalName: empresa.razao_social ?? ctx.tenant.legal_name,
    document: empresa.cnpj ? `CNPJ ${empresa.cnpj}` : null,
    address: endereco || null,
    contact: contatoLinha || null,
    headerText: documentos.cabecalho ?? ctx.branding.pdf_header_html,
    footerText: documentos.rodape ?? ctx.branding.footer_text,
    primaryColor: ctx.branding.color_primary,
    logo: await carregarLogo(ctx.branding.logo_url),
  };
}
