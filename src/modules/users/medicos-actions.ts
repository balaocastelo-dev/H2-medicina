'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertPermission, requireSession } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { type ActionResult, fail, ok, toFriendlyError } from '@/lib/action-result';
import { MEDICOS_INICIAIS, emailProvisorio } from './medicos-iniciais';

export interface ResultadoPreCadastro {
  criados: string[];
  jaExistiam: string[];
  falharam: { nome: string; motivo: string }[];
}

/**
 * Pre-cadastra o corpo clinico.
 *
 * O medico entra no sistema pelo nome e pelo registro; e-mail e senha ele
 * mesmo define depois. Como o login exige um endereco, cada um recebe um
 * provisorio derivado do registro — unico, sem caixa de entrada, e visivel
 * na lista de usuarios como "acesso pendente".
 *
 * Rodar de novo nao duplica ninguem: quem ja tem o registro cadastrado e
 * apenas informado.
 */
export async function preCadastrarMedicos(): Promise<ActionResult<ResultadoPreCadastro>> {
  try {
    const ctx = await assertPermission('usuarios.administrar');
    const supabase = await createClient();
    const admin = createAdminClient();

    const { data: papel } = await supabase
      .from('roles')
      .select('id, name')
      .eq('tenant_id', ctx.tenant.id)
      .eq('code', 'medico')
      .maybeSingle<{ id: string; name: string }>();
    if (!papel) return fail('O papel "medico" não existe nesta empresa.');

    const dominio =
      ((ctx.settings.empresa as { dominio?: string } | undefined)?.dominio ?? '') ||
      ((ctx.settings.empresa as { site?: string } | undefined)?.site ?? '');

    const resultado: ResultadoPreCadastro = { criados: [], jaExistiam: [], falharam: [] };

    for (const medico of MEDICOS_INICIAIS) {
      try {
        const { data: existente } = await supabase
          .from('profiles')
          .select('id')
          .eq('tenant_id', ctx.tenant.id)
          .eq('council_number', medico.numero)
          .is('deleted_at', null)
          .maybeSingle<{ id: string }>();

        if (existente) {
          resultado.jaExistiam.push(medico.nome);
          continue;
        }

        const email = emailProvisorio(medico.conselho, medico.numero, dominio);

        const { data: criado, error: erroAuth } = await admin.auth.admin.createUser({
          email,
          password: crypto.randomUUID(),
          email_confirm: true,
          user_metadata: { full_name: medico.nome, tenant_id: ctx.tenant.id },
        });

        if (erroAuth || !criado.user) {
          resultado.falharam.push({ nome: medico.nome, motivo: erroAuth?.message ?? 'falha no Auth' });
          continue;
        }

        const { error: erroPerfil } = await admin.from('profiles').upsert(
          {
            id: criado.user.id,
            tenant_id: ctx.tenant.id,
            full_name: medico.nome,
            email,
            job_title: 'Médico(a)',
            council_type: medico.conselho,
            council_number: medico.numero,
            council_state: medico.uf,
            is_active: true,
            must_change_password: true,
            created_by: ctx.userId,
            updated_by: ctx.userId,
          },
          { onConflict: 'id' },
        );

        if (erroPerfil) {
          await admin.auth.admin.deleteUser(criado.user.id).catch(() => {});
          resultado.falharam.push({ nome: medico.nome, motivo: toFriendlyError(erroPerfil) });
          continue;
        }

        await admin.from('user_roles').upsert(
          { user_id: criado.user.id, role_id: papel.id, tenant_id: ctx.tenant.id, created_by: ctx.userId },
          { onConflict: 'user_id,role_id' },
        );

        resultado.criados.push(medico.nome);
      } catch (erroMedico) {
        resultado.falharam.push({ nome: medico.nome, motivo: toFriendlyError(erroMedico) });
      }
    }

    await audit(ctx, {
      action: 'create',
      entity: 'profiles',
      description: `Pré-cadastro do corpo clínico: ${resultado.criados.length} criado(s)`,
      next: resultado,
    });

    revalidatePath('/usuarios');
    return ok(
      resultado,
      `${resultado.criados.length} médico(s) cadastrado(s), ${resultado.jaExistiam.length} já existia(m).`,
    );
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

const assinaturaSchema = z.object({
  profileId: z.string().uuid(),
  /** PNG em data URI, desenhado pelo proprio profissional. */
  imagem: z.string().startsWith('data:image/png;base64,', 'Assinatura inválida'),
  consentimento: z.literal(true, { message: 'É preciso autorizar o uso da assinatura' }),
});

/**
 * Guarda a assinatura manuscrita do profissional.
 *
 * Só o próprio profissional pode registrar a dele. Isso não é burocracia:
 * uma assinatura gravada por outra pessoa nao e assinatura, e assinaria
 * documento medico em nome de alguem que nao esteve ali.
 */
export async function salvarAssinatura(entrada: {
  profileId: string;
  imagem: string;
  consentimento: boolean;
}): Promise<ActionResult> {
  try {
    // Nao ha permissao especial: qualquer pessoa logada registra a propria
    // assinatura, e so a propria.
    const ctx = await requireSession();
    const parsed = assinaturaSchema.safeParse(entrada);
    if (!parsed.success) return fail(z.prettifyError(parsed.error));

    if (parsed.data.profileId !== ctx.userId) {
      return fail('Cada profissional registra a própria assinatura.');
    }

    const supabase = await createClient();
    const base64 = parsed.data.imagem.split(',')[1] ?? '';
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length < 200) return fail('Assinatura muito curta. Desenhe novamente.');
    if (bytes.length > 1_000_000) return fail('Imagem grande demais.');

    const caminho = `${ctx.tenant.id}/profissionais/${ctx.userId}.png`;
    const { error: erroUpload } = await supabase.storage
      .from('signatures')
      .upload(caminho, bytes, { contentType: 'image/png', upsert: true });
    if (erroUpload) return fail(toFriendlyError(erroUpload));

    const agora = new Date().toISOString();
    const { error } = await supabase
      .from('profiles')
      .update({
        signature_path: caminho,
        signature_updated_at: agora,
        signature_consent_at: agora,
        updated_by: ctx.userId,
      })
      .eq('id', ctx.userId);
    if (error) return fail(toFriendlyError(error));

    await audit(ctx, {
      action: 'update',
      entity: 'profiles',
      entityId: ctx.userId,
      description: 'Assinatura manuscrita registrada pelo próprio profissional',
    });

    revalidatePath('/usuarios');
    revalidatePath('/perfil');
    return ok(undefined, 'Assinatura registrada.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/** Remove a assinatura guardada. */
export async function removerAssinatura(): Promise<ActionResult> {
  try {
    const ctx = await requireSession();
    const supabase = await createClient();

    const { data: perfil } = await supabase
      .from('profiles')
      .select('signature_path')
      .eq('id', ctx.userId)
      .maybeSingle<{ signature_path: string | null }>();

    if (perfil?.signature_path) {
      await supabase.storage.from('signatures').remove([perfil.signature_path]);
    }

    await supabase
      .from('profiles')
      .update({ signature_path: null, signature_updated_at: null, signature_consent_at: null })
      .eq('id', ctx.userId);

    await audit(ctx, {
      action: 'delete',
      entity: 'profiles',
      entityId: ctx.userId,
      description: 'Assinatura manuscrita removida',
    });

    revalidatePath('/perfil');
    return ok(undefined, 'Assinatura removida.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}
