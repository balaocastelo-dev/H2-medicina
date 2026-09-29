/**
 * Prova que o simulador liga antes de confiar em qualquer resultado dele.
 *
 * Um simulador que mente e pior que nenhum: daria testes verdes sobre um
 * sistema quebrado. Entao a primeira coisa que ele precisa provar e sobre
 * si mesmo -- que o PostgREST de mentira devolve o que o de verdade
 * devolveria, inclusive nas tres armadilhas que ja causaram defeito.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { montarClinica, type Clinica, type Pessoa } from './clinica';
import { createClient } from '@/lib/supabase/server';
import { assertPermission, PermissionError } from '@/lib/auth';

let c: Clinica;
let recepcao: Pessoa;
let medico: Pessoa;

beforeAll(async () => {
  c = await montarClinica();
  recepcao = await c.criarPessoa('Recepção de teste', 'recepcao@sim.teste', 'atendimento');
  medico = await c.criarPessoa('Dra. de teste', 'medica@sim.teste', 'medico_examinador');
}, 300_000);

afterAll(async () => {
  await c?.fechar();
});

describe('o cliente substituído se comporta como o de verdade', () => {
  it('enxerga quem está logado', async () => {
    const quem = await c.como(recepcao, async () => {
      const supabase = await createClient();
      const { data } = await supabase.auth.getUser();
      return data.user?.id;
    });
    expect(quem).toBe(recepcao.id);
  });

  it('fora de uma sessão, não há usuário', async () => {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    expect(data.user).toBeNull();
  });

  it('seleciona colunas e aplica filtros', async () => {
    const nomes = await c.como(recepcao, async () => {
      const supabase = await createClient();
      const { data } = await supabase
        .from('exam_types')
        .select('code, name')
        .eq('tenant_id', c.tenant)
        .eq('code', 'AUDIO');
      return data as { code: string; name: string }[];
    });
    expect(nomes).toHaveLength(1);
    expect(nomes[0]!.code).toBe('AUDIO');
  });

  it('ordena e limita', async () => {
    const salas = await c.como(recepcao, async () => {
      const supabase = await createClient();
      const { data } = await supabase
        .from('rooms')
        .select('name, sort_order')
        .eq('tenant_id', c.tenant)
        .order('sort_order', { ascending: true })
        .limit(3);
      return data as { name: string; sort_order: number }[];
    });
    expect(salas).toHaveLength(3);
    expect(salas[0]!.sort_order).toBeLessThanOrEqual(salas[2]!.sort_order);
  });
});

describe('as três armadilhas que já causaram defeito', () => {
  let atendimento = '';
  let paciente = '';

  beforeAll(async () => {
    paciente = (
      await c.um<{ id: string }>(
        `insert into public.patients (tenant_id, full_name) values ('${c.tenant}', 'Paciente da armadilha') returning id`,
      )
    ).id;
    atendimento = (
      await c.um<{ id: string }>(
        `insert into public.attendances (tenant_id, patient_id, stage_code)
         values ('${c.tenant}', '${paciente}', 'na_recepcao') returning id`,
      )
    ).id;
    await c.db.exec(`
      insert into public.triages (tenant_id, attendance_id, patient_id, heart_rate)
      values ('${c.tenant}', '${atendimento}', '${paciente}', 72)`);
  });

  it('embed um-para-um volta OBJETO, não array', async () => {
    // `triages.attendance_id` tem unique. Ler `?.[0]` disto devolve
    // undefined em silencio -- foi o que apagou a triagem da tela do
    // medico em 23/09, junto com mais duas queixas no mesmo dia.
    const linha = await c.como(medico, async () => {
      const supabase = await createClient();
      const { data } = await supabase
        .from('attendances')
        .select('id, triages(heart_rate)')
        .eq('id', atendimento)
        .maybeSingle();
      return data as { id: string; triages: unknown };
    });

    expect(Array.isArray(linha.triages)).toBe(false);
    expect((linha.triages as { heart_rate: number }).heart_rate).toBe(72);
  });

  it('embed um-para-muitos volta ARRAY', async () => {
    const linha = await c.como(medico, async () => {
      const supabase = await createClient();
      const { data } = await supabase
        .from('attendances')
        .select('id, patient_exams(id)')
        .eq('id', atendimento)
        .maybeSingle();
      return data as { patient_exams: unknown };
    });
    expect(Array.isArray(linha.patient_exams)).toBe(true);
  });

  it('embed pela chave estrangeira volta o registro apontado', async () => {
    const linha = await c.como(medico, async () => {
      const supabase = await createClient();
      const { data } = await supabase
        .from('attendances')
        .select('id, patients(full_name)')
        .eq('id', atendimento)
        .maybeSingle();
      return data as unknown as { patients: { full_name: string } | null };
    });
    expect(linha.patients?.full_name).toBe('Paciente da armadilha');
  });

  it('maybeSingle com duas linhas devolve ERRO, não vazio', async () => {
    // A agenda colada duplicou por causa disto: o erro nao era lido, a
    // variavel ficava nula, e o sistema concluia "nao existe" no exato
    // caso em que existia duas vezes.
    const r = await c.como(recepcao, async () => {
      const supabase = await createClient();
      return supabase.from('rooms').select('id').eq('tenant_id', c.tenant).maybeSingle();
    });
    expect(r.error).not.toBeNull();
    expect(r.data).toBeNull();
  });

  it('single sem nenhuma linha devolve erro', async () => {
    const r = await c.como(recepcao, async () => {
      const supabase = await createClient();
      return supabase
        .from('rooms')
        .select('id')
        .eq('tenant_id', c.tenant)
        .eq('code', 'NAO_EXISTE')
        .single();
    });
    expect(r.error).not.toBeNull();
  });
});

describe('o RLS vale, e falha do jeito que falha em produção', () => {
  it('INSERT barrado levanta erro', async () => {
    // Esta e a metade barulhenta: vira "Erro inesperado" na tela.
    const r = await c.como(medico, async () => {
      const supabase = await createClient();
      return supabase
        .from('payments')
        .insert({ tenant_id: c.tenant, amount: 10, method: 'pix', status: 'pendente' });
    });
    expect(r.error).not.toBeNull();
  });

  it('UPDATE barrado não levanta erro: apenas não encontra linha', async () => {
    // E esta e a metade silenciosa, que produziu "Outro consultorio chamou
    // este paciente agora" com zero pacientes em consulta.
    const r = await c.como(medico, async () => {
      const supabase = await createClient();
      return supabase
        .from('exam_types')
        .update({ price: 999 })
        .eq('tenant_id', c.tenant)
        .eq('code', 'AUDIO')
        .select('id');
    });
    expect(r.error).toBeNull();
    expect(r.data).toEqual([]);
  });
});

describe('as permissões de verdade, lidas do banco', () => {
  it('a recepção tem recepcao.operar', async () => {
    const ctx = await c.como(recepcao, () => assertPermission('recepcao.operar'));
    expect(ctx.userId).toBe(recepcao.id);
    expect(ctx.tenant.id).toBe(c.tenant);
  });

  it('o médico NÃO tem recepcao.operar', async () => {
    await expect(c.como(medico, () => assertPermission('recepcao.operar'))).rejects.toBeInstanceOf(
      PermissionError,
    );
  });

  it('o contexto não vaza de um usuário para o outro', async () => {
    // `cache()` do React memoriza por requisicao. Se a memoria virasse
    // global, o contexto do primeiro usuario valeria para todos, e a matriz
    // de papeis provaria o contrario do que quer provar.
    const a = await c.como(recepcao, () => assertPermission('recepcao.operar'));
    const b = await c.como(medico, () => assertPermission('medico.atender'));
    expect(a.userId).toBe(recepcao.id);
    expect(b.userId).toBe(medico.id);
    expect(a.permissions.has('medico.atender')).toBe(false);
  });
});
