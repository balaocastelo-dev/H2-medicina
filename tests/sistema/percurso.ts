/**
 * Um paciente atravessando o sistema inteiro, pelas acoes de verdade.
 *
 * Cada passo daqui e a MESMA funcao que roda quando alguem clica na tela.
 * Nada e simulado com SQL: se `finishReception` deixar o paciente numa fila
 * que ninguem opera, este percurso trava exatamente como a clinica trava.
 *
 * Cada passo e registrado com o resultado que a acao devolveu. Um passo com
 * `ok: false` e um defeito -- nao uma excecao a tratar no teste.
 */
import { performCheckin, callNextForRoom, updateExamStatus } from '@/modules/queue/actions';
import {
  startReception,
  definirProcedencia,
  finishReception,
  gerarCobrancaRecepcao,
} from '@/modules/queue/reception-actions';
import { chamarParaTriagem } from '@/modules/clinical/triagem-actions';
import { saveTriage, saveConsultation, saveExamResult } from '@/modules/clinical/actions';
import { chamarProximoNoConsultorio } from '@/modules/queue/consultorio-actions';
import { quitarAtendimento, encerrarAtendimento } from '@/modules/finance/attendance-actions';
import { createPatient } from '@/modules/patients/actions';
import { gerarLaudoDeExame } from '@/modules/documents/laudo-actions';
import { fichaDoExame } from '@/modules/clinical/fichas-de-exame';
import { moveAttendanceStage } from '@/modules/queue/actions';
import type { Clinica, Pessoa } from './clinica';

export interface Equipe {
  recepcao: Pessoa;
  triagista: Pessoa;
  examinador: Pessoa;
  medico: Pessoa;
}

export interface Perfil {
  /** Por que este paciente existe no teste. Aparece na falha. */
  porque: string;
  nome: string;
  cpf?: string | null;
  nascimento?: string | null;
  sexo?: 'masculino' | 'feminino' | 'outro' | 'nao_informado';
  empresaId?: string | null;
  cargo?: string | null;
  /** Codigos dos exames marcados na recepcao. */
  exames: string[];
  procedencia?: string;
  triagem?: boolean;
  prioridade?: 'normal' | 'prioritario' | 'encaixe';
  procedimento?: string | null;
  /** Desiste no meio: precisa sumir das filas e nao gerar cobranca. */
  desiste?: boolean;
  /** Um exame nao acontece: o percurso tem de seguir mesmo assim. */
  naoRealiza?: string;
}

export interface Passo {
  acao: string;
  ok: boolean;
  erro?: string;
  detalhe?: string;
  /**
   * A mensagem de sucesso, guardada de proposito.
   *
   * Algumas acoes devolvem `ok` com a falha escondida no texto -- assinar a
   * consulta responde "Consulta finalizada. (nao consegui gerar o A.S.O.)".
   * Um teste que so olhasse `ok` daria verde sobre um documento que nao
   * existe.
   */
  mensagem?: string;
  /** A acao recusou, e a recusa era a regra funcionando. */
  recusaEsperada?: boolean;
}

export interface Percurso {
  perfil: Perfil;
  pacienteId: string | null;
  atendimentoId: string | null;
  passos: Passo[];
  /** Passos que a acao recusou. Vazio e o unico resultado aceitavel. */
  falhas: Passo[];
}

type Acao<T> = () => Promise<{ ok: boolean; error?: string; message?: string; data?: T }>;

/** Executa uma acao e registra o que ela respondeu. */
async function passo<T>(
  p: Percurso,
  nome: string,
  acao: Acao<T>,
  detalhe?: string,
  /**
   * Recusas que sao a regra funcionando, e nao defeito.
   *
   * A lista e explicita e curta de proposito: qualquer recusa que nao
   * esteja aqui continua sendo defeito. Aceitar "qualquer erro" nesta acao
   * transformaria o simulador num carimbo de aprovacao.
   */
  recusasEsperadas: (string | RegExp)[] = [],
): Promise<T | null> {
  let resultado: { ok: boolean; error?: string; message?: string; data?: T };
  try {
    resultado = await acao();
  } catch (e) {
    // Uma excecao que escapa da acao vira "Erro inesperado" na tela.
    resultado = { ok: false, error: `exceção: ${(e as Error).message}` };
  }
  const erro = resultado.ok ? null : (resultado.error ?? 'sem mensagem');
  const esperada =
    erro !== null &&
    recusasEsperadas.some((r) => (typeof r === 'string' ? erro.includes(r) : r.test(erro)));

  const registro: Passo = {
    acao: nome,
    ok: resultado.ok,
    ...(erro !== null ? { erro } : {}),
    ...(esperada ? { recusaEsperada: true } : {}),
    ...(resultado.message ? { mensagem: resultado.message } : {}),
    ...(detalhe ? { detalhe } : {}),
  };
  p.passos.push(registro);
  if (!registro.ok && !esperada) p.falhas.push(registro);
  return resultado.ok ? ((resultado.data ?? null) as T | null) : null;
}

function form(campos: Record<string, string | number | boolean | null | undefined>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) {
    if (v === null || v === undefined) continue;
    fd.set(k, String(v));
  }
  return fd;
}

/**
 * Leva o perfil do cadastro ate o encerramento.
 *
 * A ordem e a da clinica de verdade, e cada etapa roda com o papel que a
 * executa la: a recepcao nao assina consulta, o medico nao fecha caixa.
 */
export async function passarPeloSistema(
  c: Clinica,
  equipe: Equipe,
  perfil: Perfil,
  catalogo: Map<string, { id: string; ocupaSala: boolean; respondidoPeloMedico: boolean }>,
): Promise<Percurso> {
  const p: Percurso = { perfil, pacienteId: null, atendimentoId: null, passos: [], falhas: [] };

  /* ---------------- cadastro ---------------- */
  const paciente = await c.como(equipe.recepcao, () =>
    passo(p, 'createPatient', () =>
      createPatient(
        null,
        form({
          full_name: perfil.nome,
          cpf: perfil.cpf ?? '',
          birth_date: perfil.nascimento ?? '',
          gender: perfil.sexo ?? 'nao_informado',
          company_id: perfil.empresaId ?? '',
          job_title: perfil.cargo ?? '',
          confirmar_duplicidade: 'sim',
        }),
      ),
    ),
  );
  if (!paciente) return p;
  p.pacienteId = (paciente as { id: string }).id;

  /* ---------------- chegada pelo totem ---------------- */
  const checkin = await c.como(equipe.recepcao, () =>
    passo(p, 'performCheckin', () =>
      performCheckin({
        appointmentId: null,
        patientId: p.pacienteId!,
        priority: (perfil.prioridade ?? 'normal') as 'normal',
      }),
    ),
  );
  if (!checkin) return p;
  p.atendimentoId = (checkin as { attendanceId: string }).attendanceId;
  const at = p.atendimentoId;

  /* ---------------- recepção ---------------- */
  const exameIds = perfil.exames
    .map((codigo) => catalogo.get(codigo)?.id)
    .filter((x): x is string => !!x);

  await c.como(equipe.recepcao, async () => {
    await passo(p, 'startReception', () => startReception(at));
    if (perfil.procedencia) {
      await passo(p, 'definirProcedencia', () => definirProcedencia(at, perfil.procedencia!));
    }
    await passo(
      p,
      'finishReception',
      () =>
        finishReception({
          attendanceId: at,
          needsTriage: perfil.triagem ?? false,
          priority: perfil.prioridade ?? 'normal',
          examTypeIds: exameIds,
          originKind: perfil.procedencia,
          procedureCode: perfil.procedimento ?? null,
        }),
      perfil.exames.join('+') || 'sem exame',
    );
    await passo(
      p,
      'gerarCobrancaRecepcao',
      () => gerarCobrancaRecepcao(at, exameIds),
      undefined,
      // Recusar cobranca sem exame, sem preco ou de quem o orgao custeia nao
      // e defeito: e a regra. O que seria defeito e cobrar nesses casos, ou
      // recusar por outro motivo qualquer -- e ai a falha aparece.
      [
        'Selecione ao menos um exame para cobrar.',
        'Os exames selecionados nao possuem preco cadastrado.',
        /não gera cobrança/,
      ],
    );
  });

  /* ---------------- desistência no meio ---------------- */
  if (perfil.desiste) {
    await c.como(equipe.recepcao, () =>
      passo(p, 'moveAttendanceStage(cancelado)', () =>
        moveAttendanceStage(at, 'cancelado', 'Desistiu no teste'),
      ),
    );
    return p;
  }

  /* ---------------- triagem ---------------- */
  const etapaAposRecepcao = await c.um<{ stage_code: string }>(
    `select stage_code from public.attendances where id = '${at}'`,
  );

  if (etapaAposRecepcao.stage_code === 'aguardando_triagem') {
    await c.como(equipe.triagista, async () => {
      await passo(p, 'chamarParaTriagem', () => chamarParaTriagem(at, null));
      await passo(p, 'saveTriage', () =>
        saveTriage(
          null,
          form({
            attendance_id: at,
            blood_pressure_systolic: 120,
            blood_pressure_diastolic: 80,
            temperature_c: 36.5,
            weight_kg: 74,
            height_cm: 172,
            heart_rate: 72,
            respiratory_rate: 16,
            oxygen_saturation: 98,
            finalizar: 'sim',
          }),
        ),
      );
    });
  }

  /* ---------------- salas de exame ---------------- */
  await percorrerAsSalas(c, equipe, p, perfil, catalogo);

  /* ---------------- consultório ---------------- */
  const antesDoMedico = await c.um<{ stage_code: string }>(
    `select stage_code from public.attendances where id = '${at}'`,
  );

  if (antesDoMedico.stage_code === 'aguardando_medico') {
    // Um consultorio livre. Se nao houver nenhum, e porque um paciente
    // anterior ficou preso dentro de um -- e isso e defeito, nao motivo para
    // pular a consulta em silencio. Pular esconderia o problema e ainda
    // faria o paciente ser encerrado sem parecer.
    const consultorio = await c.um<{ id: string }>(
      `select id from public.rooms
        where tenant_id = '${c.tenant}' and kind = 'consultorio' and is_active
          and current_attendance_id is null
        order by sort_order limit 1`,
    );

    if (!consultorio?.id) {
      const presos = await c.linhas<{ name: string }>(
        `select name from public.rooms
          where tenant_id = '${c.tenant}' and kind = 'consultorio'
            and current_attendance_id is not null`,
      );
      p.falhas.push({
        acao: 'consultório livre',
        ok: false,
        erro:
          'o paciente esperava o médico e nenhum consultório estava livre; ' +
          `ocupados: ${presos.map((x) => x.name).join(', ') || 'nenhum — não há consultório ativo'}`,
      });
    }

    if (consultorio?.id) {
      await c.como(equipe.medico, async () => {
        await passo(p, 'chamarProximoNoConsultorio', () =>
          chamarProximoNoConsultorio(consultorio.id),
        );

        // As fichas que o medico preenche na propria consulta — hoje o
        // Romberg. A tela mostra o quadro "Para preencher na consulta"; sem
        // isto o exame seria concluido pelo gatilho ao assinar, mas com a
        // ficha vazia, e o laudo dele nao poderia existir.
        const naConsulta = await c.linhas<{ id: string; code: string }>(`
          select pe.id, et.code from public.patient_exams pe
            join public.exam_types et on et.id = pe.exam_type_id
           where pe.attendance_id = '${at}'
             and coalesce(et.respondido_pelo_medico, false)
             and et.code not in ('CLINICO','PSICO')
             and pe.status not in ('concluido','cancelado','nao_realizado')`);

        for (const f of naConsulta) {
          await passo(
            p,
            'saveExamResult(na consulta)',
            () => saveExamResult(f.id, { resultado: 'sem alteração' }, 'Sem alterações.', false, true),
            f.code,
          );
          await passo(p, 'gerarLaudoDeExame', () => gerarLaudoDeExame(f.id), f.code);
        }
        await passo(p, 'saveConsultation', () =>
          saveConsultation(
            null,
            form({
              attendance_id: at,
              chief_complaint: 'Exame ocupacional',
              conclusion: 'Sem alteracoes dignas de nota.',
              verdict: 'apto',
              finalizar: 'sim',
            }),
          ),
        );
      });
    }
  }

  /* ---------------- caixa e encerramento ---------------- */
  await c.como(equipe.recepcao, async () => {
    await passo(p, 'quitarAtendimento', () => quitarAtendimento(at));
    await passo(p, 'encerrarAtendimento', () => encerrarAtendimento(at));
  });

  return p;
}

/**
 * Esvazia as salas chamando o proximo ate nao haver mais ninguem.
 *
 * E o que o operador faz o dia inteiro. Se uma sala nunca esvaziar, o laco
 * para no teto e o teste acusa -- em vez de rodar para sempre.
 */
async function percorrerAsSalas(
  c: Clinica,
  equipe: Equipe,
  p: Percurso,
  perfil: Perfil,
  catalogo: Map<string, { id: string; ocupaSala: boolean; respondidoPeloMedico: boolean }>,
): Promise<void> {
  const at = p.atendimentoId!;
  const TETO = 40;

  for (let volta = 0; volta < TETO; volta++) {
    const pendente = await c.um<{ exam_id: string; room_id: string | null; code: string }>(`
      select pe.id as exam_id, coalesce(pe.room_id, et.default_room_id) as room_id, et.code
        from public.patient_exams pe
        join public.exam_types et on et.id = pe.exam_type_id
       where pe.attendance_id = '${at}'
         and pe.status in ('pendente','em_fila')
         and et.ocupa_sala
       order by et.code
       limit 1`);

    if (!pendente) return;

    if (!pendente.room_id) {
      p.falhas.push({
        acao: 'sala do exame',
        ok: false,
        erro: `o exame ${pendente.code} nao tem sala nenhuma: ficaria preso na fila`,
      });
      return;
    }

    const sala = pendente.room_id;

    // A sala pode estar ocupada por outro paciente do lote: libera-se pelo
    // caminho normal, concluindo quem estiver la.
    const chamou = await c.como(equipe.examinador, () =>
      passo(p, 'callNextForRoom', () => callNextForRoom(sala), pendente.code),
    );
    if (chamou === null) return;

    // Quem foi chamado nesta sala agora — pode ser outro paciente do lote.
    const chamados = await c.linhas<{ id: string; attendance_id: string; code: string }>(`
      select pe.id, pe.attendance_id, et.code
        from public.patient_exams pe
        join public.exam_types et on et.id = pe.exam_type_id
       where pe.room_id = '${sala}' and pe.status in ('chamado','em_andamento')`);

    if (chamados.length === 0) {
      p.falhas.push({
        acao: 'callNextForRoom',
        ok: false,
        erro: `a sala do ${pendente.code} aceitou a chamada mas nenhum exame ficou chamado`,
      });
      return;
    }

    for (const ch of chamados) {
      const naoRealiza = perfil.naoRealiza === ch.code && ch.attendance_id === at;

      await c.como(equipe.examinador, async () => {
        if (!naoRealiza) {
          await passo(
            p,
            'saveExamResult',
            () => saveExamResult(ch.id, { observacao: 'normal' }, 'Sem alteracoes.', false, false),
            ch.code,
          );
        }
        await passo(
          p,
          naoRealiza ? 'updateExamStatus(nao_realizado)' : 'updateExamStatus(concluido)',
          () =>
            updateExamStatus(
              ch.id,
              naoRealiza ? 'nao_realizado' : 'concluido',
              naoRealiza ? 'Paciente nao compareceu a sala' : undefined,
            ),
          ch.code,
        );

        // O laudo sai na sala, por quem preencheu a ficha — e o quadro de
        // Filas faz exatamente isto logo apos concluir. Deixar para o kit
        // de saida nao funciona: quem encerra o atendimento e a recepcao, e
        // ela nao enxerga a ficha do exame.
        if (!naoRealiza && fichaDoExame(ch.code)) {
          await passo(p, 'gerarLaudoDeExame', () => gerarLaudoDeExame(ch.id), ch.code);
        }
      });
    }
  }

  p.falhas.push({
    acao: 'percorrerAsSalas',
    ok: false,
    erro: `${TETO} chamadas e ainda ha exame pendente: a fila nao esvazia`,
  });
}

/** Le o catalogo de exames uma vez, para o percurso nao consultar a cada passo. */
export async function lerCatalogo(
  c: Clinica,
): Promise<Map<string, { id: string; ocupaSala: boolean; respondidoPeloMedico: boolean }>> {
  const linhas = await c.linhas<{
    code: string;
    id: string;
    ocupa_sala: boolean;
    respondido_pelo_medico: boolean;
  }>(
    `select code, id, coalesce(ocupa_sala, true) as ocupa_sala,
            coalesce(respondido_pelo_medico, false) as respondido_pelo_medico
       from public.exam_types where tenant_id = '${c.tenant}' and is_active`,
  );
  return new Map(
    linhas.map((l) => [
      l.code,
      { id: l.id, ocupaSala: l.ocupa_sala, respondidoPeloMedico: l.respondido_pelo_medico },
    ]),
  );
}
