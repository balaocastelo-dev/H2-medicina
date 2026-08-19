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

const edicaoSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string().trim().min(3, 'Informe o nome'),
  email: z.email('E-mail inválido'),
  phone: z.string().trim().nullable().optional(),
  job_title: z.string().trim().nullable().optional(),
  council_type: z.string().trim().nullable().optional(),
  council_number: z.string().trim().nullable().optional(),
  council_state: z.string().trim().max(2).nullable().optional(),
  rqe: z.string().trim().nullable().optional(),
});

/**
 * Edita os dados de um usuario.
 *
 * O e-mail e a identidade de login, entao mudar aqui muda no Auth tambem —
 * senao a pessoa veria um endereco na tela e entraria com outro. E o caso
 * de quem foi pre-cadastrado: troca o provisorio pelo endereco real.
 */
export async function atualizarUsuario(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('usuarios.administrar');
    const bruto = Object.fromEntries(formData.entries());
    const parsed = edicaoSchema.safeParse({
      ...bruto,
      phone: bruto.phone || null,
      job_title: bruto.job_title || null,
      council_type: bruto.council_type || null,
      council_number: bruto.council_number || null,
      council_state: bruto.council_state || null,
      rqe: bruto.rqe || null,
    });
    if (!parsed.success) {
      return fail('Verifique os campos destacados.', z.flattenError(parsed.error).fieldErrors);
    }
    const dados = parsed.data;

    const supabase = await createClient();
    const { data: atual } = await supabase
      .from('profiles')
      .select('id, email')
      .eq('id', dados.id)
      .eq('tenant_id', ctx.tenant.id)
      .is('deleted_at', null)
      .maybeSingle<{ id: string; email: string | null }>();
    if (!atual) return fail('Usuário não encontrado nesta empresa.');

    const admin = createAdminClient();

    if (atual.email?.toLowerCase() !== dados.email.toLowerCase()) {
      const { error: erroAuth } = await admin.auth.admin.updateUserById(dados.id, {
        email: dados.email,
        email_confirm: true,
      });
      if (erroAuth) {
        return fail(
          /already/i.test(erroAuth.message)
            ? 'Já existe uma conta com este e-mail.'
            : `Não consegui alterar o e-mail de acesso: ${erroAuth.message}`,
        );
      }
    }

    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: dados.full_name,
        email: dados.email,
        phone: dados.phone,
        job_title: dados.job_title,
        council_type: dados.council_type,
        council_number: dados.council_number,
        council_state: dados.council_state ? dados.council_state.toUpperCase() : null,
        rqe: dados.rqe,
        updated_by: ctx.userId,
      })
      .eq('id', dados.id)
      .eq('tenant_id', ctx.tenant.id);
    if (error) return fail(toFriendlyError(error));

    await audit(ctx, {
      action: 'update',
      entity: 'profiles',
      entityId: dados.id,
      description: `Cadastro de ${dados.full_name} atualizado`,
      previous: atual,
      next: dados,
    });

    revalidatePath('/usuarios');
    return ok(undefined, 'Usuário atualizado.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/**
 * Exclui um usuario do sistema.
 *
 * O perfil sai por exclusao logica, nao apagado de vez: consulta assinada,
 * documento emitido e registro de auditoria apontam para ele, e apagar a
 * linha deixaria o historico clinico sem autor. O acesso, esse sim, e
 * cortado de imediato no Auth.
 */
export async function excluirUsuario(userId: string, motivo?: string): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('usuarios.administrar');
    if (userId === ctx.userId) return fail('Você não pode excluir o próprio acesso.');

    const supabase = await createClient();
    const { data: alvo } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .eq('id', userId)
      .eq('tenant_id', ctx.tenant.id)
      .is('deleted_at', null)
      .maybeSingle<{ id: string; full_name: string; email: string | null }>();
    if (!alvo) return fail('Usuário não encontrado nesta empresa.');

    const agora = new Date().toISOString();
    const { error } = await supabase
      .from('profiles')
      .update({
        deleted_at: agora,
        is_active: false,
        blocked_at: agora,
        blocked_reason: motivo ?? 'Excluído do sistema',
        updated_by: ctx.userId,
      })
      .eq('id', userId)
      .eq('tenant_id', ctx.tenant.id);
    if (error) return fail(toFriendlyError(error));

    // Corta o acesso. Apagar a conta do Auth costuma falhar por causa das
    // referencias no historico; o banimento tem o mesmo efeito pratico e
    // nao deixa o perfil marcado como excluido com login ainda valendo.
    const admin = createAdminClient();
    const { error: erroAuth } = await admin.auth.admin.deleteUser(userId);
    let aviso = '';
    if (erroAuth) {
      const { error: erroBan } = await admin.auth.admin.updateUserById(userId, {
        ban_duration: '876000h',
      });
      if (erroBan) {
        aviso = ' O acesso foi bloqueado no sistema, mas confira a conta no painel do Supabase.';
      }
    }

    await supabase.from('user_roles').delete().eq('user_id', userId).eq('tenant_id', ctx.tenant.id);

    await audit(ctx, {
      action: 'delete',
      entity: 'profiles',
      entityId: userId,
      description: `Usuário ${alvo.full_name} excluído${motivo ? `: ${motivo}` : ''}`,
      previous: alvo,
    });

    revalidatePath('/usuarios');
    return ok(undefined, `Usuário excluído.${aviso}`);
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}
