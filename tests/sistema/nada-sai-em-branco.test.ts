/**
 * Nenhum documento sai em branco, e nenhum registro se perde calado.
 *
 * Esta e a familia de defeito mais perigosa do sistema, porque ela nao
 * quebra nada: produz papel assinado com os campos vazios, e registros que
 * simplesmente nao existem. A clinica so descobre quando a empresa
 * contratante reclama, ou quando alguem pergunta o que o titular autorizou.
 *
 * Todos os casos aqui vieram de uma auditoria das politicas de RLS cruzadas
 * com os papeis reais. Cada um ja aconteceu.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { montarClinica, type Clinica, type Pessoa } from './clinica';
import { updateExamStatus } from '@/modules/queue/actions';
import { saveExamResult, saveConsultation } from '@/modules/clinical/actions';
import { gerarLaudoDeExame } from '@/modules/documents/laudo-actions';
import { emitirDocumentosDeSaida } from '@/modules/documents/actions';

let c: Clinica;
let recepcao: Pessoa;
let medico: Pessoa;
let sequencia = 1;

function form(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  return fd;
}

async function atendimentoCom(codigos: string[], etapa = 'aguardando_exames'): Promise<string> {
  const paciente = (
    await c.um<{ id: string }>(
      `insert into public.patients (tenant_id, full_name, birth_date)
       values ('${c.tenant}', 'Paciente em branco ${sequencia}', '1985-03-04') returning id`,
    )
  ).id;
  const at = (
    await c.um<{ id: string }>(
      `insert into public.attendances (tenant_id, patient_id, stage_code, origin_kind)
       values ('${c.tenant}', '${paciente}', '${etapa}', 'particular') returning id`,
    )
  ).id;
  await c.db.exec(`
    insert into public.queue_tickets (tenant_id, attendance_id, prefix, sequence)
    values ('${c.tenant}', '${at}', 'B', ${sequencia++})`);
  if (codigos.length) {
    await c.db.exec(`
      insert into public.patient_exams (tenant_id, attendance_id, patient_id, exam_type_id, room_id, status)
      select '${c.tenant}', '${at}', '${paciente}', et.id, et.default_room_id, 'pendente'
        from public.exam_types et
       where et.tenant_id = '${c.tenant}' and et.code in (${codigos.map((x) => `'${x}'`).join(',')})`);
  }
  return at;
}

beforeAll(async () => {
  c = await montarClinica();
  recepcao = await c.criarPessoa('Recepção', 'recepcao@branco.teste', 'atendimento');
  medico = await c.criarPessoa('Dra.', 'medica@branco.teste', 'medico_examinador');
}, 300_000);

afterAll(async () => {
  await c?.fechar();
});

describe('laudo em branco', () => {
  it('a recepção não emite laudo de exame que ela não enxerga', async () => {
    // A recepcao ganhou `exames.concluir` para poder devolver a sala. Mas
    // ela nao le `exam_results` (exige `clinico.ver`): se emitisse o laudo,
    // sairia um PDF com todos os campos vazios, assinado com o nome dela,
    // com codigo de verificacao, e iria para a empresa contratante.
    const at = await atendimentoCom(['AUDIO']);
    const exame = await c.um<{ id: string }>(
      `select id from public.patient_exams where attendance_id = '${at}' limit 1`,
    );

    await c.como(medico, () =>
      saveExamResult(exame.id, { od_1000: '15', oe_1000: '20' }, 'Normal.', false, true),
    );

    const r = await c.como(recepcao, () => gerarLaudoDeExame(exame.id));
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.error).toMatch(/só quem faz o exame enxerga|não foi preenchida/);

    const docs = await c.linhas<{ id: string }>(
      `select id from public.documents where attendance_id = '${at}' and kind = 'resultado_exame'`,
    );
    expect(docs).toEqual([]);
  });

  it('nem quem enxerga emite laudo de ficha vazia', async () => {
    const at = await atendimentoCom(['AUDIO']);
    const exame = await c.um<{ id: string }>(
      `select id from public.patient_exams where attendance_id = '${at}' limit 1`,
    );
    await c.como(medico, () => updateExamStatus(exame.id, 'concluido'));

    const r = await c.como(medico, () => gerarLaudoDeExame(exame.id));
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.error).toMatch(/não foi preenchida/);
  });

  it('quem preencheu emite o laudo normalmente', async () => {
    // O conserto nao pode ter fechado a porta de quem deve passar.
    const at = await atendimentoCom(['AUDIO']);
    const exame = await c.um<{ id: string }>(
      `select id from public.patient_exams where attendance_id = '${at}' limit 1`,
    );
    await c.como(medico, () =>
      saveExamResult(exame.id, { od_1000: '10', oe_1000: '15' }, 'Normal.', false, true),
    );

    const r = await c.como(medico, () => gerarLaudoDeExame(exame.id));
    expect(r.ok ? null : r.error).toBeNull();
  });
});

describe('ficha clínica em branco', () => {
  it('a recepção não emite ficha clínica: ela não enxerga triagem nem consulta', async () => {
    const at = await atendimentoCom([], 'aguardando_documentos');

    // A consulta existe e esta assinada, mas a ficha nao foi emitida -- e o
    // que acontece quando a emissao automatica do medico falha e a recepcao
    // tenta de novo pelo kit. Gravada direto para nao disparar a emissao.
    await c.db.exec(`
      insert into public.medical_consultations
        (tenant_id, attendance_id, patient_id, verdict, diagnosis, conclusion, finished_at)
      select '${c.tenant}', '${at}', a.patient_id, 'apto', 'Reservado', 'Sem alterações.', now()
        from public.attendances a where a.id = '${at}'`);

    const r = await c.como(recepcao, () => emitirDocumentosDeSaida(at));

    const texto = r.ok ? (r.message ?? '') : (r.error ?? '');
    expect(texto).toMatch(/só o médico enxerga/);

    const fichas = await c.linhas<{ id: string }>(
      `select id from public.documents where attendance_id = '${at}' and kind = 'ficha_clinica'`,
    );
    expect(fichas).toEqual([]);
  });

  it('o médico emite a ficha clínica com o conteúdo dentro', async () => {
    const at = await atendimentoCom([], 'aguardando_medico');
    await c.como(medico, () =>
      saveConsultation(
        null,
        form({
          attendance_id: at,
          conclusion: 'Sem alterações dignas de nota.',
          verdict: 'apto',
          finalizar: 'sim',
        }),
      ),
    );

    const r = await c.como(medico, () => emitirDocumentosDeSaida(at));
    expect(r.ok).toBe(true);

    const fichas = await c.linhas<{ id: string }>(
      `select id from public.documents where attendance_id = '${at}' and kind = 'ficha_clinica'`,
    );
    expect(fichas.length).toBe(1);
  });
});

describe('o que a regra dispensa não é anunciado como falha', () => {
  it('SISPER não gera ficha clínica, e o kit diz "não se aplica"', async () => {
    // A clinica lia "Nao saiu: ficha clinica" em todo SISPER, e ia procurar
    // defeito onde ha regra.
    const at = await atendimentoCom([], 'aguardando_documentos');
    await c.db.exec(`update public.attendances set origin_kind = 'sisper' where id = '${at}'`);

    const r = await c.como(medico, () => emitirDocumentosDeSaida(at));
    const texto = r.ok ? (r.message ?? '') : (r.error ?? '');
    expect(texto).toContain('Não se aplica');
    expect(texto).not.toMatch(/Não saiu:.*ficha clínica/);
  });
});

describe('registros que se perdiam calados', () => {
  it('abrir um prontuário deixa rastro na trilha de LGPD', async () => {
    // `clinical_access_logs` exige `logs.ver` para ler E para escrever.
    // Nenhum papel clinico tem `logs.ver`, entao toda gravacao era barrada
    // e o erro nunca era lido: a trilha ficou vazia desde que existe.
    const at = await atendimentoCom([], 'aguardando_medico');
    const antes = await c.um<{ total: number }>(
      `select count(*)::int as total from public.clinical_access_logs`,
    );

    await c.como(medico, () =>
      saveConsultation(
        null,
        form({ attendance_id: at, conclusion: 'ok', verdict: 'apto', finalizar: 'sim' }),
      ),
    );

    const depois = await c.um<{ total: number }>(
      `select count(*)::int as total from public.clinical_access_logs`,
    );
    expect(depois.total).toBeGreaterThan(antes.total);
  });

  it('a trilha continua visível só para quem pode auditar', async () => {
    // Escrever sem poder ler: quem abriu o prontuário registra, mas não lê
    // a trilha dos outros.
    const visto = await c.como(medico, async () => {
      const r = await c.db.query(`select id from public.clinical_access_logs`);
      return r.rows;
    });
    expect(visto).toEqual([]);
  });
});
