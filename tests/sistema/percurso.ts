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
import { valoresDaFicha, conclusaoDaFicha } from './fichas-realistas';
import { moveAttendanceStage, recallTicket, atribuirSalaAoExame } from '@/modules/queue/actions';
import { devolverParaFilaDoMedico } from '@/modules/queue/consultorio-actions';
import { repetirChamadaDaTriagem } from '@/modules/clinical/triagem-actions';
import { confirmarPagamentoRecepcao } from '@/modules/queue/reception-actions';
import { emitirGuiaDeExame } from '@/modules/documents/guia-actions';
import { emitirTermoAutorizacao } from '@/modules/documents/authorization-actions';
import { anexarExame } from '@/modules/patients/anexos-actions';
import type { Clinica, Pessoa } from './clinica';
import type { Desvio } from './rotas';

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
  /** Posicao no lote. Decide qual quadro clinico o paciente recebe. */
  indice: number;
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
  indice = 0,
  desvios: Desvio[] = [],
): Promise<Percurso> {
  const tem = (d: Desvio) => desvios.includes(d);
  const p: Percurso = {
    perfil,
    indice,
    pacienteId: null,
    atendimentoId: null,
    passos: [],
    falhas: [],
  };

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

    // Clicar de novo em "gerar cobrança" nao pode empilhar lancamento: a
    // acao reaproveita a pendente quando o valor nao mudou.
    if (tem('cobrar_duas_vezes')) {
      await passo(
        p,
        'gerarCobrancaRecepcao (2a vez)',
        () => gerarCobrancaRecepcao(at, exameIds),
        undefined,
        ['Selecione ao menos um exame', 'nao possuem preco', /não gera cobrança/],
      );
    }

    // Pagamento confirmado no balcao, e nao so no caixa do fim.
    if (tem('pagar_no_balcao')) {
      const cobranca = await c.um<{ id: string } | undefined>(
        `select id from public.payments
          where attendance_id = '${at}' and status = 'pendente' limit 1`,
      );
      if (cobranca?.id) {
        await passo(p, 'confirmarPagamentoRecepcao', () =>
          confirmarPagamentoRecepcao(cobranca.id, at),
        );
      }
    }

    // Raio X e coleta saem como guia impressa, e nao entram em fila.
    if (tem('guia_de_exame')) {
      const deFora = perfil.exames.filter((e) => ['RAIOX', 'LAB'].includes(e));
      if (deFora.length > 0) {
        await passo(p, 'emitirGuiaDeExame', () =>
          emitirGuiaDeExame({
            attendanceId: at,
            exames: deFora.map((e) => (e === 'RAIOX' ? 'Raio X de tórax' : 'Hemograma completo')),
            destino: deFora.includes('RAIOX') ? 'laboratorio' : 'clinica',
          }),
        );
      }
    }

    // O termo que autoriza enviar o resultado a empresa. Sem o registro de
    // consentimento, o termo nao prova autorizacao nenhuma.
    if (tem('termo_de_autorizacao')) {
      // Assinar na tela exige assinatura de verdade: recusar sem ela e a
      // regra, nao defeito. Um PNG minimo faz as vezes do traco do quadro.
      const TRACO =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      await passo(p, 'emitirTermoAutorizacao', () =>
        emitirTermoAutorizacao({
          attendanceId: at,
          method: 'tela',
          signerName: perfil.nome,
          signatureDataUrl: TRACO,
        }),
      );
    }
  });

  /* ---------------- não compareceu ---------------- */
  if (tem('marcar_ausente')) {
    await c.como(equipe.recepcao, () =>
      passo(p, 'moveAttendanceStage(ausente)', () =>
        moveAttendanceStage(at, 'ausente', 'Não compareceu'),
      ),
    );
    return p;
  }

  /* ---------------- voltar o cartão no CRM ---------------- */
  if (tem('voltar_etapa_no_crm')) {
    // Voltar o cartao nao pode deixar data de encerramento para tras: o
    // atendimento sumia de todas as telas, que filtram por "em aberto".
    await c.como(equipe.recepcao, async () => {
      await passo(p, 'moveAttendanceStage(finalizado)', () =>
        moveAttendanceStage(at, 'finalizado', 'Encerrado por engano'),
      );
      await passo(p, 'moveAttendanceStage(volta)', () =>
        moveAttendanceStage(at, 'aguardando_medico', 'Trazido de volta'),
      );
    });
  }

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

      // O paciente nao ouviu: chamar de novo nao pode duplicar nada.
      if (tem('repetir_chamada_triagem')) {
        await passo(p, 'repetirChamadaDaTriagem', () => repetirChamadaDaTriagem(at));
      }

      const sinaisVitais = {
        attendance_id: at,
        blood_pressure_systolic: 120,
        blood_pressure_diastolic: 80,
        temperature_c: 36.5,
        weight_kg: 74,
        height_cm: 172,
        heart_rate: 72,
        respiratory_rate: 16,
        oxygen_saturation: 98,
      };

      // Salvar rascunho e finalizar depois. Foi por aqui que uma triagem
      // ja concluida voltava a ficar em aberto: gravar de novo zerava a
      // conclusao sem avisar ninguem.
      if (tem('rascunho_de_triagem')) {
        await passo(p, 'saveTriage (rascunho)', () =>
          saveTriage(null, form({ ...sinaisVitais, observations: 'Rascunho.' })),
        );
      }

      await passo(p, 'saveTriage', () =>
        saveTriage(null, form({ ...sinaisVitais, finalizar: 'sim' })),
      );

      // Gravar mais uma vez DEPOIS de finalizar: nao pode desfazer.
      if (tem('rascunho_de_triagem')) {
        await passo(p, 'saveTriage (correção depois)', () =>
          saveTriage(null, form({ ...sinaisVitais, observations: 'Corrigido depois.' })),
        );
      }
    });
  }

  /* ---------------- salas de exame ---------------- */
  await percorrerAsSalas(c, equipe, p, perfil, catalogo, desvios);

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

        // Chamou o paciente errado: devolve para a fila e chama de novo.
        // Sem isto o consultorio seguia ocupado por quem voltou a esperar.
        if (tem('devolver_da_consulta_para_fila')) {
          await passo(p, 'devolverParaFilaDoMedico', () =>
            devolverParaFilaDoMedico(at, consultorio.id),
          );
          await passo(p, 'chamarProximoNoConsultorio (de novo)', () =>
            chamarProximoNoConsultorio(consultorio.id),
          );
        }

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
            () =>
              saveExamResult(
                f.id,
                valoresDaFicha(f.code, p.indice),
                conclusaoDaFicha(f.code, p.indice),
                false,
                true,
              ),
            f.code,
          );
          await passo(p, 'gerarLaudoDeExame', () => gerarLaudoDeExame(f.id), f.code);
        }
        const consulta = {
          attendance_id: at,
          chief_complaint: 'Exame ocupacional',
          conclusion: 'Sem alteracoes dignas de nota.',
          verdict: 'apto',
        };

        // Rascunho antes de assinar: o caminho de quem preenche aos poucos.
        if (tem('rascunho_de_consulta')) {
          await passo(p, 'saveConsultation (rascunho)', () =>
            saveConsultation(null, form({ ...consulta, verdict: '' })),
          );
        }

        await passo(p, 'saveConsultation', () =>
          saveConsultation(null, form({ ...consulta, finalizar: 'sim' })),
        );

        // Corrigir uma observacao DEPOIS de assinar. Era o defeito de
        // 22/09: o medico desfazia a propria assinatura sem perceber, e o
        // paciente voltava a ficar parado em "aguardando documentos".
        if (tem('rascunho_de_consulta')) {
          await passo(p, 'saveConsultation (correção depois)', () =>
            saveConsultation(
              null,
              form({ ...consulta, recommendations: 'Retorno em 12 meses.' }),
            ),
          );
        }
      });
    }
  }

  /* ---------------- caixa e encerramento ---------------- */
  await c.como(equipe.recepcao, async () => {
    await passo(p, 'quitarAtendimento', () => quitarAtendimento(at));
    await passo(p, 'encerrarAtendimento', () => encerrarAtendimento(at));
  });

  /* ---------------- o laudo que chega dias depois ---------------- */
  if (tem('anexar_laudo_depois')) {
    // "alguns exames sao laudados depois de alguns dias, ter a opcao de
    //  anexar exames no cadastro do paciente". Acontece com o atendimento
    //  ja encerrado -- e precisa funcionar assim mesmo.
    const fd = new FormData();
    fd.set('titulo', 'Laudo de raio X — Tiradentes');
    fd.set('kind', 'laudo_externo');
    fd.set(
      'arquivo',
      new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])], 'laudo.pdf', {
        type: 'application/pdf',
      }),
    );
    await c.como(equipe.examinador, () =>
      passo(p, 'anexarExame', () => anexarExame(p.pacienteId!, null, fd)),
    );
  }

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
  desvios: Desvio[] = [],
): Promise<void> {
  const tem = (d: Desvio) => desvios.includes(d);
  let jaDesviou = false;
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

    let sala = pendente.room_id;

    // O equipamento mudou de lugar: a sala nova passa a chamar, a antiga
    // para. Feito ANTES da chamada, como na tela de Salas e exames.
    if (tem('remanejar_sala_do_exame') && !jaDesviou) {
      jaDesviou = true;
      const outra = await c.um<{ id: string }>(
        `select id from public.rooms
          where tenant_id = '${c.tenant}' and kind = 'exame' and is_active
            and id <> '${sala}' order by sort_order limit 1`,
      );
      if (outra?.id) {
        await c.como(equipe.examinador, () =>
          passo(
            p,
            'atribuirSalaAoExame',
            () => atribuirSalaAoExame(pendente.exam_id, outra.id),
            pendente.code,
          ),
        );
        sala = outra.id;
      }
    }

    // A sala pode estar ocupada por outro paciente do lote: libera-se pelo
    // caminho normal, concluindo quem estiver la.
    const chamou = await c.como(equipe.examinador, () =>
      passo(p, 'callNextForRoom', () => callNextForRoom(sala), pendente.code),
    );
    if (chamou === null) return;

    // O paciente nao ouviu a senha: chamar de novo nao duplica nada.
    if (tem('repetir_chamada_sala') && !jaDesviou) {
      jaDesviou = true;
      await c.como(equipe.examinador, () =>
        passo(p, 'recallTicket', () => recallTicket(at, sala), pendente.code),
      );
    }

    // Chamou errado: devolve o exame para a fila e chama de novo. A sala
    // precisa soltar, senao o proximo nunca e chamado.
    if (tem('devolver_exame_para_fila') && !jaDesviou) {
      jaDesviou = true;
      await c.como(equipe.examinador, async () => {
        await passo(
          p,
          'updateExamStatus(pendente)',
          () => updateExamStatus(pendente.exam_id, 'pendente'),
          pendente.code,
        );
        await passo(p, 'callNextForRoom (de novo)', () => callNextForRoom(sala), pendente.code);
      });
    }

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
          // Valores do tipo que a clinica digita de verdade, e nao um
          // "normal" generico. Sem isto o laudo de audiometria sai com os
          // dois audiogramas desenhados e VAZIOS -- foi o que aconteceu na
          // primeira exportacao de cem pacientes.
          await passo(
            p,
            'saveExamResult',
            () =>
              saveExamResult(
                ch.id,
                valoresDaFicha(ch.code, p.indice),
                conclusaoDaFicha(ch.code, p.indice),
                false,
                false,
              ),
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
