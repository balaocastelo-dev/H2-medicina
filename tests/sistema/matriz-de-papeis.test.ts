/**
 * Cada papel consegue fazer o trabalho dele, e nada alem.
 *
 * "login do dr antonio nao esta chamando pacientes" (28/09) e "nao esta
 * chamando paciente / Erro inesperado" (29/09) sao o mesmo tipo de defeito:
 * uma permissao que falta num caminho que ninguem testou com o papel certo.
 *
 * E o jeito mais traicoeiro de falhar. Com o RLS ligado:
 *   - INSERT barrado LEVANTA erro -> vira "Erro inesperado" na tela;
 *   - UPDATE barrado NAO levanta erro, so nao encontra a linha -> vira uma
 *     mensagem errada, do tipo "outro consultorio chamou este paciente".
 *
 * Nenhum dos dois aparece em teste que roda como administrador -- e todos
 * os testes rodavam como administrador.
 *
 * Aqui cada tela e exercitada com o papel de quem a usa de verdade, pelas
 * ACOES de verdade. Se faltar permissao, a acao devolve o erro e o teste
 * diz qual papel, qual acao e qual mensagem.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { montarClinica, type Clinica, type Pessoa } from './clinica';
import { performCheckin, callNextForRoom, updateExamStatus } from '@/modules/queue/actions';
import {
  startReception,
  definirProcedencia,
  finishReception,
  gerarCobrancaRecepcao,
} from '@/modules/queue/reception-actions';
import { chamarParaTriagem } from '@/modules/clinical/triagem-actions';
import { saveTriage, saveExamResult, saveConsultation } from '@/modules/clinical/actions';
import { chamarProximoNoConsultorio } from '@/modules/queue/consultorio-actions';
import { emitirDocumentosDeSaida } from '@/modules/documents/actions';
import { quitarAtendimento, encerrarAtendimento } from '@/modules/finance/attendance-actions';
import { createPatient } from '@/modules/patients/actions';
import { gerarLaudoDeExame } from '@/modules/documents/laudo-actions';
import { emitirGuiaDeExame } from '@/modules/documents/guia-actions';

let c: Clinica;
let atendimento: Pessoa;
let medico: Pessoa;
let admin: Pessoa;

function form(campos: Record<string, string | number>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.set(k, String(v));
  return fd;
}

/** Sequência das senhas do dia, para nenhuma repetir dentro do teste. */
let sequencia = 1;

/** Prepara um paciente esperando, para a ação ter em quem trabalhar. */
async function pacienteEsperando(codigos: string[], etapa: string): Promise<string> {
  const paciente = (
    await c.um<{ id: string }>(
      `insert into public.patients (tenant_id, full_name)
       values ('${c.tenant}', 'Paciente da matriz ${Math.random().toString(36).slice(2, 8)}')
       returning id`,
    )
  ).id;
  const at = (
    await c.um<{ id: string }>(
      `insert into public.attendances (tenant_id, patient_id, stage_code, needs_triage, in_service, origin_kind)
       values ('${c.tenant}', '${paciente}', '${etapa}', false, false, 'particular') returning id`,
    )
  ).id;
  // A senha e gerada pelo banco a partir do prefixo e da sequencia; `code`
  // e coluna calculada e nao se escreve nela.
  await c.db.exec(`
    insert into public.queue_tickets (tenant_id, attendance_id, prefix, sequence)
    values ('${c.tenant}', '${at}', 'M', ${sequencia++})`);
  if (codigos.length > 0) {
    await c.db.exec(`
      insert into public.patient_exams
        (tenant_id, attendance_id, patient_id, exam_type_id, room_id, status)
      select '${c.tenant}', '${at}', '${paciente}', et.id, et.default_room_id, 'pendente'
        from public.exam_types et
       where et.tenant_id = '${c.tenant}' and et.code in (${codigos.map((x) => `'${x}'`).join(',')})`);
  }
  return at;
}

async function salaDe(codigo: string): Promise<string> {
  return (
    await c.um<{ id: string }>(
      `select default_room_id as id from public.exam_types
        where tenant_id = '${c.tenant}' and code = '${codigo}'`,
    )
  ).id;
}

beforeAll(async () => {
  c = await montarClinica();
  atendimento = await c.criarPessoa('Recepção', 'recepcao@matriz.teste', 'atendimento');
  medico = await c.criarPessoa('Dr. Antônio', 'antonio@matriz.teste', 'medico_examinador');
  admin = await c.criarPessoa('Administradora', 'admin@matriz.teste', 'administrativo');
}, 300_000);

afterAll(async () => {
  await c?.fechar();
});

/**
 * Executa a ação e devolve a mensagem de erro, ou null quando deu certo.
 * A mensagem entra na asserção: é ela que diz o que consertar.
 */
async function tentar(
  pessoa: Pessoa,
  acao: () => Promise<{ ok: boolean; error?: string }>,
): Promise<string | null> {
  try {
    const r = await c.como(pessoa, acao);
    return r.ok ? null : (r.error ?? 'recusado sem mensagem');
  } catch (e) {
    return `exceção: ${(e as Error).message}`;
  }
}

/* ================================================================== */

describe('a recepção consegue operar a recepção', () => {
  it('cadastra paciente, faz check-in, encaminha e cobra', async () => {
    const problemas: string[] = [];

    const paciente = await c.como(atendimento, () =>
      createPatient(null, form({ full_name: 'Paciente da recepção', confirmar_duplicidade: 'sim' })),
    );
    if (!paciente.ok) problemas.push(`createPatient: ${paciente.error}`);

    const pid = paciente.ok ? paciente.data?.id : undefined;
    if (pid) {
      const checkin = await c.como(atendimento, () =>
        performCheckin({ appointmentId: null, patientId: pid, priority: 'normal' }),
      );
      if (!checkin.ok) problemas.push(`performCheckin: ${checkin.error}`);

      const at = checkin.ok ? checkin.data?.attendanceId : undefined;
      if (at) {
        const exame = await c.um<{ id: string }>(
          `select id from public.exam_types where tenant_id = '${c.tenant}' and code = 'AUDIO'`,
        );
        for (const [nome, acao] of [
          ['startReception', () => startReception(at)],
          ['definirProcedencia', () => definirProcedencia(at, 'particular')],
          [
            'finishReception',
            () =>
              finishReception({
                attendanceId: at,
                needsTriage: false,
                priority: 'normal',
                examTypeIds: [exame.id],
              }),
          ],
          ['gerarCobrancaRecepcao', () => gerarCobrancaRecepcao(at, [exame.id])],
          ['quitarAtendimento', () => quitarAtendimento(at)],
        ] as const) {
          const erro = await tentar(atendimento, acao);
          if (erro) problemas.push(`${nome}: ${erro}`);
        }
      }
    }

    expect(problemas).toEqual([]);
  });
});

describe('quem opera as filas consegue chamar nas salas', () => {
  it.each([
    ['atendimento', () => atendimento],
    ['medico_examinador', () => medico],
    ['administrativo', () => admin],
  ])('o papel %s chama, preenche e conclui um exame de sala', async (_papel, quem) => {
    const pessoa = quem();
    const problemas: string[] = [];

    const at = await pacienteEsperando(['ESPIRO'], 'aguardando_exames');
    const sala = await salaDe('ESPIRO');

    // "Erro inesperado. Tente novamente." na tela e uma excecao aqui.
    const erroChamada = await tentar(pessoa, () => callNextForRoom(sala));
    if (erroChamada) problemas.push(`callNextForRoom: ${erroChamada}`);

    const exame = await c.um<{ id: string }>(
      `select id from public.patient_exams where attendance_id = '${at}' limit 1`,
    );

    // Preencher a ficha e ato clinico: a recepcao nao faz, e esta certo.
    // O que ela precisa e poder ENCERRAR o exame e devolver a sala.
    if (pessoa.papel !== 'atendimento') {
      const erroFicha = await tentar(pessoa, () =>
        saveExamResult(exame.id, { cvf: '4.1' }, 'Sem alteracoes.', false, false),
      );
      if (erroFicha) problemas.push(`saveExamResult: ${erroFicha}`);
    }

    const erroConcluir = await tentar(pessoa, () => updateExamStatus(exame.id, 'concluido'));
    if (erroConcluir) problemas.push(`updateExamStatus: ${erroConcluir}`);

    // A sala precisa voltar a ficar livre. Esta gravacao e feita pela
    // aplicacao e ja foi barrada em silencio: a sala ficava "ocupada" para
    // sempre e o quadro mentia para quem opera.
    const salaDepois = await c.um<{ status: string; current_attendance_id: string | null }>(
      `select status, current_attendance_id from public.rooms where id = '${sala}'`,
    );
    if (salaDepois.current_attendance_id !== null || salaDepois.status === 'ocupada') {
      problemas.push(
        `a sala continuou ${salaDepois.status} depois de concluir o exame — a liberação foi barrada em silêncio`,
      );
    }

    expect(problemas).toEqual([]);
  });
});

describe('quem faz a triagem consegue fazer a triagem', () => {
  it.each([
    ['medico_examinador', () => medico],
    ['administrativo', () => admin],
  ])('o papel %s chama e finaliza a triagem', async (_papel, quem) => {
    const pessoa = quem();
    const problemas: string[] = [];

    const at = await pacienteEsperando(['CLINICO'], 'aguardando_triagem');

    const erroChamada = await tentar(pessoa, () => chamarParaTriagem(at, null));
    if (erroChamada) problemas.push(`chamarParaTriagem: ${erroChamada}`);

    const erroTriagem = await tentar(pessoa, () =>
      saveTriage(
        null,
        form({
          attendance_id: at,
          blood_pressure_systolic: 120,
          blood_pressure_diastolic: 80,
          heart_rate: 70,
          weight_kg: 70,
          height_cm: 170,
          finalizar: 'sim',
        }),
      ),
    );
    if (erroTriagem) problemas.push(`saveTriage: ${erroTriagem}`);

    // A sala de triagem tambem precisa voltar a ficar livre.
    const presa = await c.linhas<{ name: string }>(
      `select name from public.rooms
        where tenant_id = '${c.tenant}' and current_attendance_id = '${at}'`,
    );
    if (presa.length > 0) {
      problemas.push(`a sala ${presa[0]!.name} ficou presa ao paciente depois da triagem`);
    }

    expect(problemas).toEqual([]);
  });
});

describe('o médico consegue atender', () => {
  it.each([
    ['medico_examinador', () => medico],
    ['administrativo', () => admin],
  ])('o papel %s chama, assina e emite', async (_papel, quem) => {
    const pessoa = quem();
    const problemas: string[] = [];

    // Este caso mede permissao, nao ordem de fila. Entao o paciente do
    // teste precisa ser o unico esperando, e os consultorios precisam
    // comecar livres -- senao `chamarProximoNoConsultorio` traz outro e a
    // falha diria "consultorio ocupado" em vez de dizer a verdade sobre a
    // permissao.
    await c.db.exec(`
      update public.attendances set stage_code = 'aguardando_pagamento'
       where tenant_id = '${c.tenant}' and stage_code = 'aguardando_medico';
      update public.rooms set status = 'disponivel', current_attendance_id = null
       where tenant_id = '${c.tenant}' and kind = 'consultorio';`);

    const at = await pacienteEsperando(['CLINICO'], 'aguardando_medico');
    const consultorio = await c.um<{ id: string }>(
      `select id from public.rooms
        where tenant_id = '${c.tenant}' and kind = 'consultorio' and is_active
          and current_attendance_id is null
        order by sort_order limit 1`,
    );

    if (!consultorio?.id) {
      problemas.push('nenhum consultório livre para o teste');
    } else {
      // Era exatamente isto que falhava: a gravacao era barrada e o codigo
      // lia zero linhas como "alguem chegou primeiro".
      const erroChamada = await tentar(pessoa, () => chamarProximoNoConsultorio(consultorio.id));
      if (erroChamada) problemas.push(`chamarProximoNoConsultorio: ${erroChamada}`);
    }

    const erroConsulta = await tentar(pessoa, () =>
      saveConsultation(
        null,
        form({
          attendance_id: at,
          conclusion: 'Sem alterações.',
          verdict: 'apto',
          finalizar: 'sim',
        }),
      ),
    );
    if (erroConsulta) problemas.push(`saveConsultation: ${erroConsulta}`);

    // Nenhuma consulta finalizada por medico de verdade gerava repasse: a
    // gravacao exigia `financeiro.registrar`.
    const repasse = await c.um<{ total: number }>(
      `select count(*)::int as total from public.fee_entries where attendance_id = '${at}'`,
    );
    const temProcedimento = await c.um<{ fee: string | null }>(
      `select default_fee::text as fee from public.procedure_types
        where tenant_id = '${c.tenant}' and code = 'consulta_ocupacional'`,
    );
    if (Number(temProcedimento?.fee ?? 0) > 0 && repasse.total === 0) {
      problemas.push('a consulta foi assinada e nenhum repasse foi lançado');
    }

    const erroKit = await tentar(pessoa, () => emitirDocumentosDeSaida(at));
    if (erroKit) problemas.push(`emitirDocumentosDeSaida: ${erroKit}`);

    expect(problemas).toEqual([]);
  });
});

describe('quem encerra o atendimento consegue encerrar', () => {
  it.each([
    ['atendimento', () => atendimento],
    ['medico_examinador', () => medico],
  ])('o papel %s encerra e o kit sai', async (_papel, quem) => {
    const pessoa = quem();
    const at = await pacienteEsperando([], 'aguardando_documentos');
    const erro = await tentar(pessoa, () => encerrarAtendimento(at));
    expect(erro).toBeNull();
  });
});

describe('os documentos de balcão', () => {
  it('a recepção imprime a guia de exame', async () => {
    const at = await pacienteEsperando(['RAIOX'], 'aguardando_exames');
    const erro = await tentar(atendimento, () =>
      emitirGuiaDeExame({ attendanceId: at, exames: ['Raio X de tórax'], destino: 'clinica' }),
    );
    expect(erro).toBeNull();
  });

  it('quem preenche a ficha emite o laudo dela', async () => {
    const at = await pacienteEsperando(['AUDIO'], 'aguardando_exames');
    const exame = await c.um<{ id: string }>(
      `select id from public.patient_exams where attendance_id = '${at}' limit 1`,
    );
    const problemas: string[] = [];

    const erroFicha = await tentar(medico, () =>
      saveExamResult(exame.id, { od_1000: '15', oe_1000: '20' }, 'Dentro dos limites.', false, true),
    );
    if (erroFicha) problemas.push(`saveExamResult: ${erroFicha}`);

    const erroLaudo = await tentar(medico, () => gerarLaudoDeExame(exame.id));
    if (erroLaudo) problemas.push(`gerarLaudoDeExame: ${erroLaudo}`);

    expect(problemas).toEqual([]);
  });
});

/* ================================================================== */
/* O outro lado: alargar permissão não pode virar "todo mundo pode tudo" */
/* ================================================================== */

describe('o RLS continua separando o que tem de separar', () => {
  it('a recepção não grava consulta médica', async () => {
    const at = await pacienteEsperando([], 'aguardando_medico');
    const erro = await tentar(atendimento, () =>
      saveConsultation(
        null,
        form({ attendance_id: at, conclusion: 'x', verdict: 'apto', finalizar: 'sim' }),
      ),
    );
    expect(erro).not.toBeNull();
  });

  it('o médico não mexe no cadastro de exames', async () => {
    const antes = await c.um<{ price: string }>(
      `select price::text from public.exam_types where tenant_id = '${c.tenant}' and code = 'AUDIO'`,
    );
    await c.como(medico, async () => {
      await c.db
        .query(
          `update public.exam_types set price = 99999 where tenant_id = '${c.tenant}' and code = 'AUDIO'`,
        )
        .catch(() => undefined);
    });
    const depois = await c.um<{ price: string }>(
      `select price::text from public.exam_types where tenant_id = '${c.tenant}' and code = 'AUDIO'`,
    );
    expect(depois.price).toBe(antes.price);
  });

  it('a recepção não lê o conteúdo da consulta', async () => {
    // Ela precisa SABER se ha parecer, para o A.S.O.; nao precisa ler o
    // prontuario. As duas coisas continuam separadas.
    const at = await pacienteEsperando([], 'aguardando_medico');
    await c.db.exec(`
      insert into public.medical_consultations (tenant_id, attendance_id, patient_id, verdict, diagnosis, finished_at)
      select '${c.tenant}', '${at}', a.patient_id, 'apto', 'Diagnostico sigiloso', now()
        from public.attendances a where a.id = '${at}'`);

    const visto = await c.como(atendimento, async () => {
      const r = await c.db.query<{ diagnosis: string }>(
        `select diagnosis from public.medical_consultations where attendance_id = '${at}'`,
      );
      return r.rows;
    });
    expect(visto).toEqual([]);

    const sabe = await c.como(atendimento, async () => {
      const r = await c.db.query<{ tem: boolean }>(
        `select public.atendimento_tem_parecer('${at}') as tem`,
      );
      return r.rows[0]!.tem;
    });
    expect(sabe).toBe(true);
  });
});
