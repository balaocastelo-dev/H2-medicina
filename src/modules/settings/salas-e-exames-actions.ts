'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertPermission } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { type ActionResult, fail, ok, toFriendlyError } from '@/lib/action-result';
import {
  normalizarCodigo,
  podeDesativarExame,
  podeDesativarSala,
  podeMudarCodigo,
} from './salas-e-exames';

/**
 * Cadastro de salas e tipos de exame, feito pela propria clinica.
 *
 * "sera que tem como a gente colocar no sistema um jeito da gente ter mais
 *  autonomia sobre isso?" -- Isabella, 25/09.
 *
 * Ate aqui cada troca de sala e cada exame novo eram comandos escritos a
 * mao no banco. Isso funcionou enquanto era uma vez por semana; nao
 * funciona para uma clinica que muda equipamento de lugar.
 *
 * As travas de desativacao estao em `salas-e-exames.ts`, como logica pura:
 * sao a razao de esta tela poder existir sem quebrar atendimento em
 * andamento, e trava dentro de tela ninguem consegue conferir.
 */

const ETAPAS_ABERTAS = [
  'aguardando_recepcao',
  'na_recepcao',
  'aguardando_triagem',
  'em_triagem',
  'aguardando_exames',
  'em_exames',
  'aguardando_medico',
  'em_consulta',
  'aguardando_documentos',
  'aguardando_pagamento',
];

const ATIVOS = ['pendente', 'em_fila', 'chamado', 'em_andamento'];

// ---------------------------------------------------------------------
// Salas
// ---------------------------------------------------------------------

const salaSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().trim().min(1, 'Informe o código'),
  name: z.string().trim().min(2, 'Informe o nome da sala'),
  kind: z.enum(['recepcao', 'triagem', 'exame', 'consultorio', 'guiche']),
  sort_order: z.coerce.number().int().min(0).max(999).default(0),
  is_active: z.boolean().default(true),
});

export async function salvarSala(_prev: unknown, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('salas.administrar');
    const parsed = salaSchema.safeParse({
      id: (formData.get('id') as string) || undefined,
      code: formData.get('code'),
      name: formData.get('name'),
      kind: formData.get('kind'),
      sort_order: formData.get('sort_order') ?? 0,
      is_active: formData.get('is_active') === 'on' || formData.get('is_active') === 'true',
    });
    if (!parsed.success) {
      return fail('Verifique os campos da sala.', z.flattenError(parsed.error).fieldErrors);
    }

    const supabase = await createClient();
    const dados = parsed.data;
    const codigo = normalizarCodigo(dados.code);
    if (!codigo) return fail('O código da sala não pode ficar vazio.');

    // Desativar exige conferir quem depende desta sala.
    if (dados.id && !dados.is_active) {
      const [{ data: exames }, { data: sala }] = await Promise.all([
        supabase
          .from('exam_types')
          .select('name')
          .eq('tenant_id', ctx.tenant.id)
          .eq('default_room_id', dados.id)
          .eq('is_active', true)
          .is('deleted_at', null)
          .returns<{ name: string }[]>(),
        supabase
          .from('rooms')
          .select('current_attendance_id')
          .eq('id', dados.id)
          .eq('tenant_id', ctx.tenant.id)
          .maybeSingle<{ current_attendance_id: string | null }>(),
      ]);

      const veredito = podeDesativarSala({
        examesQueUsam: (exames ?? []).map((e) => ({ nome: e.name })),
        temPacienteDentro: Boolean(sala?.current_attendance_id),
      });
      if (!veredito.pode) return fail(veredito.motivo ?? 'Não é possível desativar esta sala.');
    }

    const payload = {
      tenant_id: ctx.tenant.id,
      code: codigo,
      name: dados.name,
      kind: dados.kind,
      sort_order: dados.sort_order,
      is_active: dados.is_active,
      updated_by: ctx.userId,
    };

    const { error } = dados.id
      ? await supabase
          .from('rooms')
          .update(payload)
          .eq('id', dados.id)
          .eq('tenant_id', ctx.tenant.id)
      : await supabase.from('rooms').insert({ ...payload, created_by: ctx.userId });

    if (error) return fail(toFriendlyError(error));

    await audit(ctx, {
      action: dados.id ? 'update' : 'create',
      entity: 'rooms',
      entityId: dados.id,
      description: `Sala ${dados.name} (${codigo}) ${dados.id ? 'atualizada' : 'criada'}`,
    });

    revalidatePath('/salas-e-exames');
    revalidatePath('/filas');
    return ok(undefined, dados.id ? 'Sala atualizada.' : 'Sala criada.');
  } catch (e) {
    return fail(toFriendlyError(e));
  }
}

// ---------------------------------------------------------------------
// Tipos de exame
// ---------------------------------------------------------------------

const exameSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().trim().min(1, 'Informe o código'),
  name: z.string().trim().min(2, 'Informe o nome do exame'),
  default_room_id: z.string().uuid().nullable().optional(),
  price: z.coerce.number().min(0, 'Valor inválido').default(0),
  average_minutes: z.coerce.number().int().min(0).max(480).default(15),
  sort_order: z.coerce.number().int().min(0).max(999).default(0),
  is_active: z.boolean().default(true),
});

export async function salvarTipoDeExame(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('salas.administrar');
    const sala = (formData.get('default_room_id') as string) || null;
    const parsed = exameSchema.safeParse({
      id: (formData.get('id') as string) || undefined,
      code: formData.get('code'),
      name: formData.get('name'),
      default_room_id: sala,
      price: formData.get('price') ?? 0,
      average_minutes: formData.get('average_minutes') ?? 15,
      sort_order: formData.get('sort_order') ?? 0,
      is_active: formData.get('is_active') === 'on' || formData.get('is_active') === 'true',
    });
    if (!parsed.success) {
      return fail('Verifique os campos do exame.', z.flattenError(parsed.error).fieldErrors);
    }

    const supabase = await createClient();
    const dados = parsed.data;
    const codigo = normalizarCodigo(dados.code);
    if (!codigo) return fail('O código do exame não pode ficar vazio.');

    // O que ja existe, para conferir codigo e situacao antes de gravar.
    const atual = dados.id
      ? (
          await supabase
            .from('exam_types')
            .select('code, ocupa_sala, name')
            .eq('id', dados.id)
            .eq('tenant_id', ctx.tenant.id)
            .maybeSingle<{ code: string; ocupa_sala: boolean; name: string }>()
        ).data
      : null;

    if (atual) {
      const veredito = podeMudarCodigo(atual.code, codigo);
      if (!veredito.pode) return fail(veredito.motivo ?? 'Este código não pode ser alterado.');
    }

    if (dados.id && !dados.is_active) {
      const { count } = await supabase
        .from('patient_exams')
        .select('id, attendances!inner(stage_code)', { count: 'exact', head: true })
        .eq('tenant_id', ctx.tenant.id)
        .eq('exam_type_id', dados.id)
        .in('status', ATIVOS)
        .in('attendances.stage_code', ETAPAS_ABERTAS);

      const veredito = podeDesativarExame({ pedidosEmAberto: count ?? 0 });
      if (!veredito.pode) return fail(veredito.motivo ?? 'Não é possível desativar este exame.');
    }

    // Exame que nao ocupa sala nao recebe sala: escolher uma daria a
    // entender que ele passaria a ser chamado numa fila.
    const ocupaSala = atual?.ocupa_sala ?? true;
    const salaFinal = ocupaSala ? (dados.default_room_id ?? null) : (atual ? undefined : null);

    const payload: Record<string, unknown> = {
      tenant_id: ctx.tenant.id,
      code: codigo,
      name: dados.name,
      price: dados.price,
      average_minutes: dados.average_minutes,
      sort_order: dados.sort_order,
      is_active: dados.is_active,
      updated_by: ctx.userId,
    };
    if (salaFinal !== undefined) payload.default_room_id = salaFinal;

    const { error } = dados.id
      ? await supabase
          .from('exam_types')
          .update(payload)
          .eq('id', dados.id)
          .eq('tenant_id', ctx.tenant.id)
      : await supabase.from('exam_types').insert({ ...payload, created_by: ctx.userId });

    if (error) return fail(toFriendlyError(error));

    await audit(ctx, {
      action: dados.id ? 'update' : 'create',
      entity: 'exam_types',
      entityId: dados.id,
      description: `Exame ${dados.name} (${codigo}) ${dados.id ? 'atualizado' : 'criado'}`,
    });

    // O vinculo sala-exame e mantido pelo gatilho do banco: trocar a sala
    // aqui arrasta a lista de exames da sala junto.
    revalidatePath('/salas-e-exames');
    revalidatePath('/filas');
    revalidatePath('/recepcao');
    return ok(undefined, dados.id ? 'Exame atualizado.' : 'Exame criado.');
  } catch (e) {
    return fail(toFriendlyError(e));
  }
}
