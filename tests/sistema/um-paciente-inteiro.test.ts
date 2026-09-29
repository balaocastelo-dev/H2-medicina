/**
 * Um paciente do cadastro ao encerramento, pelas acoes de verdade.
 *
 * Antes de centenas, um. Se o percurso de um nao fecha, o de trezentos so
 * produz ruido.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { montarClinica, type Clinica } from './clinica';
import { lerCatalogo, passarPeloSistema, type Equipe, type Percurso } from './percurso';

let c: Clinica;
let equipe: Equipe;
let percurso: Percurso;

beforeAll(async () => {
  c = await montarClinica();
  equipe = {
    recepcao: await c.criarPessoa('Recepção', 'recepcao@um.teste', 'atendimento'),
    triagista: await c.criarPessoa('Triagem', 'triagem@um.teste', 'medico_examinador'),
    examinador: await c.criarPessoa('Examinador', 'exame@um.teste', 'medico_examinador'),
    medico: await c.criarPessoa('Dr. Antônio', 'antonio@um.teste', 'medico_examinador'),
  };

  const catalogo = await lerCatalogo(c);
  percurso = await passarPeloSistema(
    c,
    equipe,
    {
      porque: 'o percurso comum: triagem, audiometria e consulta',
      nome: 'Renato Fernandes Lagoa',
      nascimento: '1985-11-25',
      sexo: 'masculino',
      exames: ['AUDIO', 'CLINICO'],
      triagem: true,
    },
    catalogo,
  );
}, 300_000);

afterAll(async () => {
  await c?.fechar();
});

describe('o percurso inteiro', () => {
  it('registra o percurso para leitura', () => {
    // O rastro inteiro, para o diagnostico nao depender de adivinhacao.
    console.log(
      'PERCURSO:\n' +
        percurso.passos
          .map(
            (p) =>
              `  ${p.ok ? 'ok ' : 'FALHOU'} ${p.acao}${p.detalhe ? ` [${p.detalhe}]` : ''}` +
              (p.erro ? ` -> ${p.erro}` : '') +
              (p.mensagem ? ` :: ${p.mensagem}` : ''),
          )
          .join('\n'),
    );
    expect(percurso.passos.length).toBeGreaterThan(0);
  });

  it('nenhuma ação foi recusada', () => {
    // A mensagem da falha e o relatorio: diz qual acao, com que argumento,
    // e o que ela respondeu.
    expect(
      percurso.falhas.map((f) => `${f.acao}${f.detalhe ? ` [${f.detalhe}]` : ''}: ${f.erro}`),
    ).toEqual([]);
  });

  it('passou por todas as etapas que deveria', () => {
    const acoes = percurso.passos.map((p) => p.acao);
    expect(acoes).toContain('performCheckin');
    expect(acoes).toContain('finishReception');
    expect(acoes).toContain('saveTriage');
    expect(acoes).toContain('callNextForRoom');
    expect(acoes).toContain('saveConsultation');
    expect(acoes).toContain('encerrarAtendimento');
  });
});

describe('o que ficou gravado', () => {
  it('o atendimento terminou', async () => {
    const a = await c.um<{ stage_code: string; in_service: boolean }>(
      `select stage_code, in_service from public.attendances where id = '${percurso.atendimentoId}'`,
    );
    expect(a.stage_code).toBe('finalizado');
    expect(a.in_service).toBe(false);
  });

  it('nenhuma sala ficou ocupada', async () => {
    const presas = await c.linhas<{ name: string }>(
      `select name from public.rooms
        where tenant_id = '${c.tenant}' and current_attendance_id is not null`,
    );
    expect(presas.map((s) => s.name)).toEqual([]);
  });

  it('todos os exames foram concluídos', async () => {
    const abertos = await c.linhas<{ code: string; status: string }>(`
      select et.code, pe.status from public.patient_exams pe
        join public.exam_types et on et.id = pe.exam_type_id
       where pe.attendance_id = '${percurso.atendimentoId}'
         and pe.status not in ('concluido','cancelado','nao_realizado')`);
    expect(abertos).toEqual([]);
  });

  it('a consulta foi assinada', async () => {
    const mc = await c.um<{ finished_at: string | null; verdict: string | null }>(
      `select finished_at, verdict from public.medical_consultations
        where attendance_id = '${percurso.atendimentoId}'`,
    );
    expect(mc?.finished_at).not.toBeNull();
    expect(mc?.verdict).toBe('apto');
  });

  it('o A.S.O. foi emitido', async () => {
    const docs = await c.linhas<{ kind: string }>(
      `select kind from public.documents where attendance_id = '${percurso.atendimentoId}'`,
    );
    expect(docs.map((d) => d.kind)).toContain('aso');
  });

  it('a cobrança existe e foi quitada', async () => {
    const pagamentos = await c.linhas<{ status: string; net_amount: string }>(
      `select status, net_amount::text from public.payments where attendance_id = '${percurso.atendimentoId}'`,
    );
    expect(pagamentos.length).toBeGreaterThan(0);
    expect(pagamentos.every((p) => p.status === 'pago')).toBe(true);
  });
});
