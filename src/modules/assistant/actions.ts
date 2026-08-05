'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSessionContext, type SessionContext } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { buildPixPayload, buildTxid } from '@/lib/pix';
import { formatCPF, formatMoney, slugify } from '@/lib/format';
import { toFriendlyError } from '@/lib/action-result';
import { EXEMPLOS, interpretar, type Intencao, type SalaContexto } from './intents';

export interface RespostaAssistente {
  /** Texto mostrado ao usuario. */
  mensagem: string;
  /** Pergunta de confirmacao antes de executar. */
  confirmar?: string;
  /** Linhas auxiliares (resultados de busca, credenciais geradas). */
  detalhes?: string[];
  sugestoes?: string[];
  ok: boolean;
}

async function carregarSalas(ctx: SessionContext): Promise<SalaContexto[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('rooms')
    .select('id, name, code')
    .eq('tenant_id', ctx.tenant.id)
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('sort_order')
    .returns<{ id: string; name: string; code: string }[]>();
  return (data ?? []).map((s) => ({ id: s.id, nome: s.name, codigo: s.code }));
}

/** Primeira etapa: entende o pedido e devolve o que sera feito. */
export async function interpretarComando(texto: string): Promise<RespostaAssistente> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, mensagem: 'Sessao expirada. Entre novamente.' };

  const leitura = interpretar(texto, { salas: await carregarSalas(ctx) });

  if (leitura.intencao.tipo === 'ajuda') {
    return {
      ok: true,
      mensagem: 'Posso executar estas tarefas para voce:',
      sugestoes: EXEMPLOS,
    };
  }

  if (leitura.intencao.tipo === 'desconhecida') {
    return {
      ok: false,
      mensagem: leitura.intencao.motivo,
      sugestoes: leitura.intencao.sugestoes,
    };
  }

  if (leitura.permissao && !ctx.permissions.has(leitura.permissao)) {
    return {
      ok: false,
      mensagem: `Seu perfil nao tem permissao para isso (${leitura.permissao}).`,
    };
  }

  return { ok: true, mensagem: leitura.resumo, confirmar: leitura.resumo };
}

/**
 * Segunda etapa: executa.
 *
 * O texto e reinterpretado aqui no servidor — nada do que o navegador manda e
 * usado como intencao. Permissao conferida de novo, e tudo vai para a auditoria.
 */
export async function executarComando(texto: string): Promise<RespostaAssistente> {
  try {
    const ctx = await getSessionContext();
    if (!ctx) return { ok: false, mensagem: 'Sessao expirada. Entre novamente.' };

    const leitura = interpretar(texto, { salas: await carregarSalas(ctx) });
    const { intencao } = leitura;

    if (intencao.tipo === 'ajuda') {
      return { ok: true, mensagem: 'Posso executar estas tarefas:', sugestoes: EXEMPLOS };
    }
    if (intencao.tipo === 'desconhecida') {
      return { ok: false, mensagem: intencao.motivo, sugestoes: intencao.sugestoes };
    }
    if (leitura.permissao && !ctx.permissions.has(leitura.permissao)) {
      return { ok: false, mensagem: `Sem permissao para esta operacao (${leitura.permissao}).` };
    }

    switch (intencao.tipo) {
      case 'chamar_proximo':
        return await chamarProximo(ctx, intencao);
      case 'criar_cobranca':
        return await criarCobranca(ctx, intencao);
      case 'criar_profissional':
        return await criarProfissional(ctx, intencao);
      case 'buscar_paciente':
        return await buscarPaciente(ctx, intencao);
    }
  } catch (error) {
    return { ok: false, mensagem: toFriendlyError(error) };
  }
}

async function chamarProximo(
  ctx: SessionContext,
  intencao: Extract<Intencao, { tipo: 'chamar_proximo' }>,
): Promise<RespostaAssistente> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('call_next_for_room', {
    p_tenant: ctx.tenant.id,
    p_room: intencao.salaId,
  });
  if (error) return { ok: false, mensagem: toFriendlyError(error) };

  const payload = data as { found: boolean; ticket?: { code?: string } | null };
  if (!payload.found) {
    return { ok: false, mensagem: `Nao ha ninguem elegivel na fila de ${intencao.salaNome}.` };
  }

  // Completa o rotulo do painel com o nome do paciente chamado.
  const { data: sala } = await supabase
    .from('rooms')
    .select('current_attendance_id')
    .eq('id', intencao.salaId)
    .maybeSingle<{ current_attendance_id: string | null }>();
  if (sala?.current_attendance_id) {
    const { data: atendimento } = await supabase
      .from('attendances')
      .select('patients(full_name, social_name)')
      .eq('id', sala.current_attendance_id)
      .maybeSingle<{ patients: { full_name: string; social_name: string | null } | null }>();
    const nome = atendimento?.patients?.social_name ?? atendimento?.patients?.full_name;
    if (nome) {
      const { data: chamada } = await supabase
        .from('tv_calls')
        .select('id')
        .eq('tenant_id', ctx.tenant.id)
        .order('called_at', { ascending: false })
        .limit(1)
        .maybeSingle<{ id: string }>();
      if (chamada) await supabase.from('tv_calls').update({ patient_label: nome }).eq('id', chamada.id);
    }
  }

  await audit(ctx, {
    action: 'update',
    entity: 'rooms',
    entityId: intencao.salaId,
    description: `Chamada pelo assistente em ${intencao.salaNome}`,
    origin: 'assistente',
  });

  revalidatePath('/filas');
  revalidatePath('/painel');
  return {
    ok: true,
    mensagem: `Chamei a senha ${payload.ticket?.code ?? '—'} para ${intencao.salaNome}. Ja apareceu no painel.`,
  };
}

async function criarCobranca(
  ctx: SessionContext,
  intencao: Extract<Intencao, { tipo: 'criar_cobranca' }>,
): Promise<RespostaAssistente> {
  const supabase = await createClient();

  const { data: paciente } = await supabase
    .from('patients')
    .select('id, full_name')
    .eq('tenant_id', ctx.tenant.id)
    .eq('cpf', intencao.cpf)
    .is('deleted_at', null)
    .maybeSingle<{ id: string; full_name: string }>();

  if (!paciente) {
    return {
      ok: false,
      mensagem: `Nao encontrei paciente com o CPF ${formatCPF(intencao.cpf)}.`,
      sugestoes: ['Cadastre o paciente antes de gerar a cobranca.'],
    };
  }

  // Procura um atendimento aberto para vincular a cobranca.
  const { data: atendimento } = await supabase
    .from('attendances')
    .select('id')
    .eq('tenant_id', ctx.tenant.id)
    .eq('patient_id', paciente.id)
    .is('finished_at', null)
    .is('deleted_at', null)
    .order('checkin_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  const { data: pagamento, error } = await supabase
    .from('payments')
    .insert({
      tenant_id: ctx.tenant.id,
      patient_id: paciente.id,
      attendance_id: atendimento?.id ?? null,
      description: intencao.descricao,
      amount: intencao.valor,
      method: intencao.metodo,
      status: 'pendente',
      provider: intencao.metodo === 'pix' ? 'pix_manual' : 'manual',
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .select('id, net_amount')
    .single<{ id: string; net_amount: number }>();

  if (error) return { ok: false, mensagem: toFriendlyError(error) };

  await supabase.from('payment_transactions').insert({
    tenant_id: ctx.tenant.id,
    payment_id: pagamento.id,
    event: 'criada',
    status: 'pendente',
    amount: pagamento.net_amount,
    performed_by: ctx.userId,
  });

  const detalhes = [`Paciente: ${paciente.full_name}`, `Valor: ${formatMoney(intencao.valor)}`];

  // Pix: gera o BR Code se a chave estiver configurada.
  if (intencao.metodo === 'pix') {
    const conf = (ctx.settings.pagamento ?? {}) as {
      chave_pix?: string;
      beneficiario?: string;
      cidade?: string;
      tipo_chave?: string;
    };
    if (conf.chave_pix) {
      const txid = buildTxid('CB', pagamento.id.replace(/-/g, '').slice(0, 20));
      const payload = buildPixPayload({
        key: conf.chave_pix,
        merchantName: conf.beneficiario ?? ctx.tenant.trade_name,
        merchantCity: conf.cidade ?? 'SAO PAULO',
        amount: Number(pagamento.net_amount),
        txid,
        description: intencao.descricao,
      });
      await supabase.from('pix_charges').insert({
        tenant_id: ctx.tenant.id,
        payment_id: pagamento.id,
        pix_key: conf.chave_pix,
        key_kind: conf.tipo_chave ?? 'aleatoria',
        merchant_name: conf.beneficiario ?? ctx.tenant.trade_name,
        merchant_city: conf.cidade ?? 'SAO PAULO',
        txid,
        amount: pagamento.net_amount,
        payload,
        confirmation_mode: 'manual',
      });
      detalhes.push('QR Code Pix gerado — disponivel no Financeiro.');
    } else {
      detalhes.push('Chave Pix nao configurada: a cobranca ficou sem QR Code.');
    }
  }

  await audit(ctx, {
    action: 'create',
    entity: 'payments',
    entityId: pagamento.id,
    patientId: paciente.id,
    description: `Cobranca de ${formatMoney(intencao.valor)} criada pelo assistente`,
    origin: 'assistente',
  });

  revalidatePath('/financeiro');
  return {
    ok: true,
    mensagem: `Cobranca de ${formatMoney(intencao.valor)} lancada para ${paciente.full_name}.`,
    detalhes,
  };
}

async function criarProfissional(
  ctx: SessionContext,
  intencao: Extract<Intencao, { tipo: 'criar_profissional' }>,
): Promise<RespostaAssistente> {
  const supabase = await createClient();

  const { data: papel } = await supabase
    .from('roles')
    .select('id, name')
    .eq('tenant_id', ctx.tenant.id)
    .eq('code', intencao.papel)
    .maybeSingle<{ id: string; name: string }>();
  if (!papel) return { ok: false, mensagem: 'Papel nao encontrado nesta empresa.' };

  const email =
    intencao.email ?? `${slugify(intencao.nome).split('-')[0]}@${ctx.tenant.slug}.com`;
  const senha = `${slugify(intencao.nome).split('-')[0]}${Math.floor(1000 + Math.random() * 9000)}`;

  const admin = createAdminClient();
  const { data: criado, error: erroAuth } = await admin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
    user_metadata: { full_name: intencao.nome, tenant_id: ctx.tenant.id },
  });

  if (erroAuth || !criado.user) {
    const msg = erroAuth?.message ?? '';
    if (/already been registered|already exists/i.test(msg)) {
      return { ok: false, mensagem: `Ja existe uma conta com o e-mail ${email}.` };
    }
    return { ok: false, mensagem: `Nao consegui criar a conta: ${msg}` };
  }

  const { error: erroPerfil } = await admin.from('profiles').upsert(
    {
      id: criado.user.id,
      tenant_id: ctx.tenant.id,
      full_name: intencao.nome,
      email,
      job_title: papel.name,
      council_type: intencao.conselhoTipo,
      council_number: intencao.conselhoNumero,
      council_state: intencao.conselhoUf,
      is_active: true,
      must_change_password: true,
      created_by: ctx.userId,
    },
    { onConflict: 'id' },
  );
  if (erroPerfil) {
    await admin.auth.admin.deleteUser(criado.user.id).catch(() => {});
    return { ok: false, mensagem: toFriendlyError(erroPerfil) };
  }

  await admin.from('user_roles').upsert(
    { user_id: criado.user.id, role_id: papel.id, tenant_id: ctx.tenant.id, created_by: ctx.userId },
    { onConflict: 'user_id,role_id' },
  );

  await audit(ctx, {
    action: 'create',
    entity: 'profiles',
    entityId: criado.user.id,
    description: `${intencao.nome} cadastrado como ${papel.name} pelo assistente`,
    origin: 'assistente',
  });

  revalidatePath('/usuarios');
  return {
    ok: true,
    mensagem: `${intencao.nome} cadastrado como ${papel.name}.`,
    detalhes: [
      `E-mail de acesso: ${email}`,
      `Senha provisoria: ${senha}`,
      'A troca de senha sera exigida no primeiro acesso.',
      ...(intencao.conselhoNumero
        ? [`Registro: ${intencao.conselhoTipo} ${intencao.conselhoNumero}${intencao.conselhoUf ? '/' + intencao.conselhoUf : ''}`]
        : []),
    ],
  };
}

async function buscarPaciente(
  ctx: SessionContext,
  intencao: Extract<Intencao, { tipo: 'buscar_paciente' }>,
): Promise<RespostaAssistente> {
  const supabase = await createClient();
  const digitos = intencao.termo.replace(/\D/g, '');

  const base = supabase
    .from('patients')
    .select('id, full_name, cpf, birth_date')
    .eq('tenant_id', ctx.tenant.id)
    .is('deleted_at', null)
    .limit(8);

  const { data } = digitos.length === 11
    ? await base.eq('cpf', digitos).returns<{ id: string; full_name: string; cpf: string | null }[]>()
    : await base.ilike('full_name', `%${intencao.termo}%`).returns<{ id: string; full_name: string; cpf: string | null }[]>();

  const achados = data ?? [];
  if (achados.length === 0) {
    return { ok: false, mensagem: `Nenhum paciente encontrado para "${intencao.termo}".` };
  }

  return {
    ok: true,
    mensagem: `${achados.length} paciente(s) encontrado(s):`,
    detalhes: achados.map((p) => `${p.full_name}${p.cpf ? ` — ${formatCPF(p.cpf)}` : ''}`),
  };
}
