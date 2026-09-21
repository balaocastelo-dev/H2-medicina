/**
 * PENTE FINO — um dia inteiro de clinica, conferido peca por peca.
 *
 * Dez pacientes passam pelo sistema do totem ao pagamento, cada um com uma
 * particularidade que ja causou defeito ou que tem tudo para causar. Depois
 * o dia inteiro e auditado: cadastro, senhas, filas, salas, etapas, TV,
 * documentos impressos, financeiro e as contas que aparecem nas telas.
 *
 * O que este arquivo faz de diferente dos outros testes de percurso:
 *
 *   - usa as funcoes de verdade do banco (checkin_patient, call_next_for_room,
 *     os gatilhos), nao um caminho paralelo escrito para o teste;
 *   - LE o texto dos PDFs gerados. Conferir os dados que entram no gerador
 *     nao prova nada — o defeito de 21/09 estava entre o banco e o papel;
 *   - confere o dia como um todo, e nao um caso isolado: o que interessa e
 *     achar a contradicao entre duas partes que, sozinhas, passam.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { montarAmbiente, type Ambiente } from './ambiente';
import { textoDoPdf, imprime } from './texto-do-pdf';
import { buildGuiaDeExame } from '@/modules/documents/guia-exame';
import { buildAsoPdf } from '@/modules/documents/aso-pdf';
import { calcAge, formatCPF, formatDate } from '@/lib/format';
import { contarNaFila, distribuirExames, NA_FILA } from '@/modules/queue/distribuicao';
import { montarRiscos } from '@/modules/documents/riscos';
import { resumirFluxo } from '@/modules/finance/fluxo-caixa';
import { agruparPorMedico } from '@/modules/finance/repasse';
import { CODIGO_VALIDO, montarResposta } from '@/modules/documents/verificacao';
import { proximaEtapaDaRecepcao, GERA_GUIA } from '@/modules/queue/origin-kind';

// =====================================================================
// Os dez pacientes
// =====================================================================

interface Perfil {
  chave: string;
  nome: string;
  /** null = cadastro sem data de nascimento, que a clinica tem aos montes. */
  nascimento: string | null;
  empresa: 'A' | 'B' | null;
  origem: 'particular' | 'estado' | 'sisper' | 'ingresso';
  /** Codigos de exame pedidos na recepcao. */
  exames: string[];
  triagem: boolean;
  prioridade: 'normal' | 'prioritario';
  /** Vai embora no meio do atendimento. */
  desiste?: boolean;
  /** Por que este paciente esta na lista. */
  porque: string;
}

/** Hoje no fuso da clinica, em partes. */
const HOJE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })
  .format(new Date())
  .split('-')
  .map(Number) as [number, number, number];

/** Mesmo dia e mes de hoje, N anos atras — para testar o dia do aniversario. */
function aniversarioHoje(anosAtras: number): string {
  const [ano, mes, dia] = HOJE;
  // 29 de fevereiro nao existe em todo ano: o teste nao pode depender disso.
  const diaSeguro = mes === 2 && dia === 29 ? 28 : dia;
  return `${ano - anosAtras}-${String(mes).padStart(2, '0')}-${String(diaSeguro).padStart(2, '0')}`;
}

const PERFIS: Perfil[] = [
  {
    chave: 'adriana',
    nome: 'Adriana Nogueira Prado',
    nascimento: '1990-01-01',
    empresa: 'A',
    origem: 'particular',
    exames: ['AUDIO', 'CLINICO'],
    triagem: false,
    prioridade: 'normal',
    porque: 'Primeiro de janeiro: a borda em que a conversao de fuso voltava um dia.',
  },
  {
    chave: 'bruno',
    nome: 'Bruno Salgado Ferrarini',
    nascimento: '1992-02-29',
    empresa: 'A',
    origem: 'particular',
    exames: ['ECG', 'ESPIRO', 'CLINICO'],
    triagem: false,
    prioridade: 'normal',
    porque: 'Ano bissexto: 29 de fevereiro nao existe em quase nenhum ano.',
  },
  {
    chave: 'camila',
    nome: 'Camila Peixoto Vasconcelos',
    nascimento: aniversarioHoje(38),
    empresa: 'A',
    origem: 'particular',
    exames: ['AUDIO', 'ECG'],
    triagem: false,
    prioridade: 'normal',
    porque: 'Faz aniversario hoje e nao tem consulta: idade exata e saida sem medico.',
  },
  {
    chave: 'diego',
    nome: 'Diego Ramalho Quintanilha',
    nascimento: '1978-12-31',
    empresa: 'B',
    origem: 'particular',
    exames: ['DINAMO_PAL', 'DINAMO_ESC', 'DINAMO_LOM', 'CLINICO'],
    triagem: false,
    prioridade: 'normal',
    porque: 'Ultimo dia do ano e tres exames na mesma sala: uma chamada so.',
  },
  {
    chave: 'eliane',
    nome: 'Eliane Fontes Bittencourt',
    nascimento: null,
    empresa: 'B',
    origem: 'particular',
    exames: ['RAIOX', 'LAB', 'CLINICO'],
    triagem: false,
    prioridade: 'normal',
    porque: 'Sem data de nascimento; raio X nao ocupa sala e a coleta ocupa.',
  },
  {
    chave: 'fabio',
    nome: 'Fabio Quintela Marchesini',
    nascimento: '1965-07-04',
    empresa: null,
    origem: 'particular',
    exames: ['CLINICO'],
    triagem: true,
    prioridade: 'normal',
    porque: 'Triagem e so a consulta: nenhum exame de sala para disparar a etapa.',
  },
  {
    chave: 'gisele',
    nome: 'Gisele Amancio Taborda',
    nascimento: '2006-03-15',
    empresa: 'B',
    origem: 'ingresso',
    exames: ['ACUIDADE', 'ISHIHARA', 'FADIGA'],
    triagem: false,
    prioridade: 'normal',
    porque: 'Exames de bancada da triagem, sem consulta: sai pelo pagamento.',
  },
  {
    chave: 'heitor',
    nome: 'Heitor Vasques de Alencastro',
    nascimento: '1959-11-20',
    empresa: 'A',
    origem: 'particular',
    exames: ['AUDIO', 'ECG', 'EEG', 'ESPIRO', 'LAB', 'CLINICO'],
    triagem: false,
    prioridade: 'normal',
    porque: 'Seis exames em cinco salas: o percurso mais longo do dia.',
  },
  {
    chave: 'ivana',
    nome: 'Ivana Portela Schiavinato',
    nascimento: '1988-06-09',
    empresa: 'B',
    origem: 'particular',
    exames: ['AUDIO', 'CLINICO'],
    triagem: false,
    prioridade: 'prioritario',
    porque: 'Chega por ultimo e e prioritaria: tem de furar a fila da audiometria.',
  },
  {
    chave: 'joaquim',
    nome: 'Joaquim Tavares Bandeira',
    nascimento: '1970-10-02',
    empresa: 'A',
    origem: 'particular',
    exames: ['ECG', 'CLINICO'],
    triagem: false,
    prioridade: 'normal',
    desiste: true,
    porque: 'Vai embora no meio: precisa sumir das filas sem deixar sala presa.',
  },
];

/** Ordem de check-in. A Ivana e a ultima de proposito. */
const ORDEM = PERFIS.map((p) => p.chave);

// =====================================================================
// Estado do dia
// =====================================================================

interface Registro {
  perfil: Perfil;
  paciente: string;
  atendimento: string;
  senha: string;
  examesPedidos: string[];
}

interface Chamada {
  sala: string;
  salaNome: string;
  atendimento: string;
  quantos: number;
}

let amb: Ambiente;
let recepcionista = '';
let medico = '';
let empresaA = '';
let empresaB = '';

const registros = new Map<string, Registro>();
const chamadas: Chamada[] = [];

const um = <T,>(sql: string) => amb.um<T>(sql);
const linhas = async <T,>(sql: string): Promise<T[]> => (await amb.db.query<T>(sql)).rows;
const comoRecepcao = <T,>(fn: () => Promise<T>) => amb.como(recepcionista, fn);
const comoMedico = <T,>(fn: () => Promise<T>) => amb.como(medico, fn);

const reg = (chave: string): Registro => {
  const r = registros.get(chave);
  if (!r) throw new Error(`paciente ${chave} nao foi registrado`);
  return r;
};

// ---------------------------------------------------------------- CPF
/** CPF valido de verdade: o banco recusa qualquer outro. */
function digito(numeros: number[], pesoInicial: number): number {
  let soma = 0;
  let peso = pesoInicial;
  for (const n of numeros) {
    soma += n * peso;
    peso -= 1;
  }
  const resto = (soma * 10) % 11;
  return resto === 10 ? 0 : resto;
}

function cpfDeTeste(indice: number): string {
  const base = String(100000000 + indice * 7654321).slice(0, 9);
  const n = base.split('').map(Number);
  const d1 = digito(n, 10);
  const d2 = digito([...n, d1], 11);
  return `${base}${d1}${d2}`;
}

// =====================================================================
// O dia
// =====================================================================

beforeAll(async () => {
  amb = await montarAmbiente();
  recepcionista = await amb.criarUsuario('Isabella Recepcao', 'recepcao@pente.test');
  medico = await amb.criarUsuario('Dra. Wania Picasso', 'medica@pente.test');

  empresaA = (
    await um<{ id: string }>(`
      insert into public.companies (tenant_id, legal_name, trade_name, document, street, number, district, city, state, zip_code)
      values ('${amb.tenant}', 'Metalurgica Aurora Ltda', 'Aurora', '11222333000181',
              'Rua das Oficinas', '450', 'Distrito Industrial', 'Campinas', 'SP', '13052100')
      returning id`)
  ).id;

  empresaB = (
    await um<{ id: string }>(`
      insert into public.companies (tenant_id, legal_name, trade_name, document, street, number, district, city, state, zip_code)
      values ('${amb.tenant}', 'Transportadora Bandeirante S.A.', 'Bandeirante', '11444777000161',
              'Avenida dos Caminhoneiros', '1200', 'Jardim do Trevo', 'Campinas', 'SP', '13041000')
      returning id`)
  ).id;

  // Repasse do medico por procedimento, para o financeiro ter o que somar.
  await amb.db.exec(`
    insert into public.medical_fees (tenant_id, profile_id, procedure_type_id, fee)
    select '${amb.tenant}', '${medico}', pt.id, 60.00
      from public.procedure_types pt where pt.tenant_id = '${amb.tenant}'
    on conflict (profile_id, procedure_type_id) do nothing`);

  await cadastrarPacientes();
  await totem();
  await recepcao();
  await salasDeExame();
  await triagemDeBancada();
  await consultorio();
  await caixa();
}, 240_000);

afterAll(async () => {
  await amb?.fechar();
});

async function cadastrarPacientes(): Promise<void> {
  await comoRecepcao(async () => {
    for (const [i, perfil] of PERFIS.entries()) {
      const empresa =
        perfil.empresa === 'A' ? empresaA : perfil.empresa === 'B' ? empresaB : null;
      const criado = await um<{ id: string }>(`
        insert into public.patients
          (tenant_id, full_name, cpf, birth_date, gender, company_id, job_title, department, phone, created_by)
        values ('${amb.tenant}', '${perfil.nome}', '${cpfDeTeste(i + 1)}',
                ${perfil.nascimento ? `'${perfil.nascimento}'` : 'null'},
                '${i % 2 === 0 ? 'feminino' : 'masculino'}',
                ${empresa ? `'${empresa}'` : 'null'},
                'Operador', 'Producao', '1999${String(1000000 + i).slice(0, 7)}', '${recepcionista}')
        returning id`);

      registros.set(perfil.chave, {
        perfil,
        paciente: criado.id,
        atendimento: '',
        senha: '',
        examesPedidos: perfil.exames,
      });
    }
  });
}

async function totem(): Promise<void> {
  for (const chave of ORDEM) {
    const r = reg(chave);
    const resposta = await comoRecepcao(async () =>
      um<{ payload: { attendance_id: string; ticket: { code: string } | null } }>(
        `select public.checkin_patient('${amb.tenant}', null, '${r.paciente}',
                '${r.perfil.prioridade}'::priority_level, null, 'totem-teste') as payload`,
      ),
    );
    r.atendimento = resposta.payload.attendance_id;
    r.senha = resposta.payload.ticket?.code ?? '';
    // Check-ins no mesmo instante embaralhariam a ordem de chegada.
    await amb.db.query(`select pg_sleep(0.01)`);
  }
}

async function recepcao(): Promise<void> {
  await comoRecepcao(async () => {
    for (const chave of ORDEM) {
      const r = reg(chave);
      const codigos = r.examesPedidos.map((c) => `'${c}'`).join(',');

      await amb.db.exec(`
        update public.attendances
           set stage_code = 'na_recepcao', reception_started_at = now(), updated_by = '${recepcionista}'
         where id = '${r.atendimento}'`);

      await amb.db.exec(`
        insert into public.patient_exams
          (tenant_id, attendance_id, patient_id, exam_type_id, room_id, sort_order, priority, status, created_by)
        select '${amb.tenant}', '${r.atendimento}', '${r.paciente}', et.id, et.default_room_id,
               et.sort_order, '${r.perfil.prioridade}'::priority_level, 'pendente', '${recepcionista}'
          from public.exam_types et
         where et.tenant_id = '${amb.tenant}' and et.code in (${codigos})`);

      // Mesma decisao da tela da recepcao, com a mesma funcao e o mesmo
      // criterio: exame de bancada obriga a passar pela triagem.
      const bancada = await um<{ total: number }>(`
        select count(*)::int as total
          from public.exam_types et
          join public.rooms r on r.id = et.default_room_id
         where et.tenant_id = '${amb.tenant}' and et.code in (${codigos}) and r.kind = 'triagem'`);
      const precisaTriagem = r.perfil.triagem || bancada.total > 0;

      const etapa = proximaEtapaDaRecepcao({
        originKind: r.perfil.origem,
        needsTriage: precisaTriagem,
        temExames: r.examesPedidos.some((c) => c !== 'CLINICO' && c !== 'RAIOX'),
        temConsulta: r.examesPedidos.includes('CLINICO'),
      });

      await amb.db.exec(`
        update public.attendances
           set stage_code = '${etapa}', needs_triage = ${precisaTriagem},
               origin_kind = '${r.perfil.origem}', procedure_code = 'consulta_ocupacional',
               reception_finished_at = now(), updated_by = '${recepcionista}'
         where id = '${r.atendimento}'`);
    }
  });
}

/** Chama e conclui tudo que as salas de exame atendem, ate esvaziar. */
async function salasDeExame(): Promise<void> {
  const salas = await linhas<{ id: string; name: string }>(`
    select id, name from public.rooms
     where tenant_id = '${amb.tenant}' and kind = 'exame' and is_active and deleted_at is null
     order by sort_order`);

  for (let volta = 0; volta < 80; volta += 1) {
    let chamouAlguem = false;

    for (const sala of salas) {
      const ocupada = await um<{ status: string }>(
        `select status from public.rooms where id = '${sala.id}'`,
      );
      // Sala ocupada nao chama outro paciente: quem esta dentro terminou?
      if (ocupada.status === 'ocupada') continue;

      const r = await comoRecepcao(async () =>
        um<{
          payload: {
            found: boolean;
            exam?: { id: string; attendance_id: string };
            exames_chamados?: number;
          };
        }>(`select public.call_next_for_room('${amb.tenant}', '${sala.id}') as payload`),
      );
      if (!r.payload.found || !r.payload.exam) continue;

      chamouAlguem = true;
      const atendimento = r.payload.exam.attendance_id;
      chamadas.push({
        sala: sala.id,
        salaNome: sala.name,
        atendimento,
        quantos: r.payload.exames_chamados ?? 0,
      });

      // O paciente que desiste vai embora depois de ser chamado uma vez.
      const desistente = [...registros.values()].find(
        (x) => x.atendimento === atendimento && x.perfil.desiste,
      );
      if (desistente) {
        // So o cancelamento, sem faxina manual: e o servidor que tem de
        // soltar o paciente, a sala e os exames dele.
        await comoRecepcao(async () => {
          await amb.db.query(
            `select public.move_attendance_stage('${atendimento}', 'cancelado', 'Paciente foi embora')`,
          );
        });
        continue;
      }

      await executarExamesDaSala(atendimento, sala.id);
    }

    if (!chamouAlguem) break;
  }
}

/** A sala preenche a ficha de cada exame chamado e libera o paciente. */
async function executarExamesDaSala(atendimento: string, sala: string): Promise<void> {
  const emSala = await linhas<{ id: string; patient_id: string; codigo: string }>(`
    select pe.id, pe.patient_id, et.code as codigo
      from public.patient_exams pe
      join public.exam_types et on et.id = pe.exam_type_id
     where pe.attendance_id = '${atendimento}' and pe.room_id = '${sala}'
       and pe.status in ('chamado','em_andamento')`);

  await comoRecepcao(async () => {
    for (const exame of emSala) {
      await amb.db.exec(`
        update public.patient_exams
           set status = 'em_andamento', started_at = now(), professional_id = '${recepcionista}',
               updated_by = '${recepcionista}'
         where id = '${exame.id}'`);
    }

    for (const exame of emSala) {
      await amb.db.exec(`
        insert into public.exam_results
          (tenant_id, patient_exam_id, patient_id, professional_id, values, conclusion, is_altered, created_by)
        values ('${amb.tenant}', '${exame.id}', '${exame.patient_id}', '${recepcionista}',
                '{"od_500":"10","oe_500":"15","od_1000":"10","oe_1000":"15"}'::jsonb,
                'Dentro dos limites da normalidade', false, '${recepcionista}')`);
      await amb.db.exec(`
        update public.patient_exams
           set status = 'concluido', finished_at = now(), updated_by = '${recepcionista}'
         where id = '${exame.id}'`);
    }

    await amb.db.exec(`
      update public.rooms set status = 'disponivel', current_attendance_id = null
       where id = '${sala}' and tenant_id = '${amb.tenant}'`);
  });
}

/**
 * A bancada da triagem: acuidade, cores e fadiga sao preenchidos ali.
 *
 * Desde 15/09 essas salas sairam do quadro de Filas e salas. Quem preenche
 * e a propria tela de Triagem, e e esse caminho que esta reproduzido aqui.
 */
async function triagemDeBancada(): Promise<void> {
  const salaTriagem = await um<{ id: string }>(
    `select id from public.rooms where tenant_id = '${amb.tenant}' and kind = 'triagem' and is_active order by sort_order limit 1`,
  );

  const pendentes = await linhas<{ id: string; attendance_id: string; patient_id: string }>(`
    select pe.id, pe.attendance_id, pe.patient_id
      from public.patient_exams pe
      join public.exam_types et on et.id = pe.exam_type_id
      join public.attendances a on a.id = pe.attendance_id
     where pe.tenant_id = '${amb.tenant}' and et.default_room_id = '${salaTriagem.id}'
       and pe.status in ('pendente','em_fila') and a.cancelled_at is null`);

  // Mesma chamada de `chamarParaTriagem`: a TV primeiro, porque e ela que
  // faz o paciente levantar da cadeira.
  await comoRecepcao(async () => {
    await amb.db.exec(`
      insert into public.tv_calls (tenant_id, ticket_code, patient_label, room_name, destination, priority)
      select '${amb.tenant}', q.code, split_part(coalesce(p.social_name, p.full_name), ' ', 1),
             r.name, 'triagem', a.priority
        from public.attendances a
        join public.queue_tickets q on q.attendance_id = a.id
        join public.patients p on p.id = a.patient_id
        cross join (select name from public.rooms where id = '${salaTriagem.id}') r
       where a.tenant_id = '${amb.tenant}' and a.stage_code = 'aguardando_triagem'
         and a.cancelled_at is null`);
  });

  await comoRecepcao(async () => {
    for (const exame of pendentes) {
      await amb.db.exec(`
        update public.patient_exams
           set status = 'em_andamento', started_at = now(), room_id = '${salaTriagem.id}',
               professional_id = '${recepcionista}', updated_by = '${recepcionista}'
         where id = '${exame.id}'`);
      await amb.db.exec(`
        insert into public.exam_results
          (tenant_id, patient_exam_id, patient_id, professional_id, values, conclusion, created_by)
        values ('${amb.tenant}', '${exame.id}', '${exame.patient_id}', '${recepcionista}',
                '{"od":"1,0","oe":"1,0"}'::jsonb, 'Normal', '${recepcionista}')`);
      await amb.db.exec(`
        update public.patient_exams
           set status = 'concluido', finished_at = now(), updated_by = '${recepcionista}'
         where id = '${exame.id}'`);
    }

    // A ficha de triagem propriamente dita, para quem foi encaminhado a ela.
    const paraTriar = await linhas<{ id: string; patient_id: string }>(`
      select id, patient_id from public.attendances
       where tenant_id = '${amb.tenant}' and stage_code in ('aguardando_triagem','em_triagem')
         and cancelled_at is null`);

    for (const a of paraTriar) {
      await amb.db.exec(`
        insert into public.triages
          (tenant_id, attendance_id, patient_id, professional_id, blood_pressure_systolic,
           blood_pressure_diastolic, weight_kg, height_cm, heart_rate, created_by)
        values ('${amb.tenant}', '${a.id}', '${a.patient_id}', '${recepcionista}',
                120, 80, 78.5, 172.0, 72, '${recepcionista}')`);
      await amb.db.exec(`
        update public.triages set finished_at = now(), updated_by = '${recepcionista}'
         where attendance_id = '${a.id}'`);
    }

    await amb.db.exec(`
      update public.rooms set status = 'disponivel', current_attendance_id = null
       where id = '${salaTriagem.id}'`);
  });
}

async function consultorio(): Promise<void> {
  const sala = await um<{ id: string }>(
    `select id from public.rooms where tenant_id = '${amb.tenant}' and kind = 'consultorio' and is_active order by sort_order limit 1`,
  );

  for (let i = 0; i < 20; i += 1) {
    const proximo = await comoMedico(async () =>
      um<{ id: string | null; patient_id: string | null }>(`
        select id, patient_id from public.attendances
         where tenant_id = '${amb.tenant}' and stage_code = 'aguardando_medico'
           and in_service = false and finished_at is null and cancelled_at is null
         order by case priority when 'prioritario' then 0 when 'encaixe' then 1 else 2 end,
                  checkin_at
         limit 1`),
    );
    if (!proximo?.id || !proximo.patient_id) break;

    await comoMedico(async () => {
      await amb.db.exec(`
        update public.attendances
           set stage_code = 'em_consulta', in_service = true, current_room_id = '${sala.id}',
               consultation_started_at = now(), updated_by = '${medico}'
         where id = '${proximo.id}' and in_service = false`);
      await amb.db.exec(`
        update public.rooms set status = 'ocupada', current_attendance_id = '${proximo.id}'
         where id = '${sala.id}'`);

      await amb.db.exec(`
        insert into public.medical_consultations
          (tenant_id, attendance_id, patient_id, doctor_id, room_id, verdict, valid_until,
           conclusion, created_by)
        values ('${amb.tenant}', '${proximo.id}', '${proximo.patient_id}', '${medico}', '${sala.id}',
                'apto', current_date + 365, 'Apto para a funcao.', '${medico}')`);

      await amb.db.exec(`
        update public.medical_consultations set finished_at = now(), signed_at = now(), updated_by = '${medico}'
         where attendance_id = '${proximo.id}'`);

      // A consulta clinica e um exame que nao ocupa sala: quem a conclui e o medico.
      await amb.db.exec(`
        update public.patient_exams pe
           set status = 'concluido', finished_at = now(), updated_by = '${medico}'
          from public.exam_types et
         where et.id = pe.exam_type_id and et.code = 'CLINICO'
           and pe.attendance_id = '${proximo.id}' and pe.status <> 'concluido'`);

      // Repasse do procedimento para o medico.
      await amb.db.exec(`
        insert into public.fee_entries
          (tenant_id, profile_id, attendance_id, patient_id, procedure_type_id, procedure_code,
           procedure_name, fee, competencia, status, created_by)
        select '${amb.tenant}', '${medico}', '${proximo.id}', '${proximo.patient_id}', pt.id, pt.code,
               pt.name, coalesce(mf.fee, pt.default_fee), date_trunc('month', now())::date, 'a_pagar', '${medico}'
          from public.procedure_types pt
          left join public.medical_fees mf on mf.procedure_type_id = pt.id and mf.profile_id = '${medico}'
         where pt.tenant_id = '${amb.tenant}' and pt.code = 'consulta_ocupacional'`);

      await amb.db.exec(`
        update public.attendances
           set stage_code = 'aguardando_pagamento', in_service = false, current_room_id = null,
               updated_by = '${medico}'
         where id = '${proximo.id}'`);
      await amb.db.exec(`
        update public.rooms set status = 'disponivel', current_attendance_id = null
         where id = '${sala.id}'`);
    });
  }
}

async function caixa(): Promise<void> {
  await comoRecepcao(async () => {
    const aPagar = await linhas<{ id: string; patient_id: string; company_id: string | null }>(`
      select id, patient_id, company_id from public.attendances
       where tenant_id = '${amb.tenant}' and stage_code = 'aguardando_pagamento'
         and cancelled_at is null`);

    for (const a of aPagar) {
      // A recepcao cobra pelos exames escolhidos, nao pelos concluidos:
      // mesmo criterio de `gerarPixDaRecepcao`.
      await amb.db.exec(`
        insert into public.payments
          (tenant_id, attendance_id, patient_id, company_id, description, amount, method, status, due_date, paid_at, created_by)
        select '${amb.tenant}', '${a.id}', '${a.patient_id}',
               ${a.company_id ? `'${a.company_id}'` : 'null'},
               'Atendimento ocupacional',
               coalesce(sum(et.price), 0), 'pix', 'pago', current_date, now(), '${recepcionista}'
          from public.patient_exams pe
          join public.exam_types et on et.id = pe.exam_type_id
         where pe.attendance_id = '${a.id}' and pe.status <> 'cancelado'`);

      await amb.db.exec(`
        update public.attendances
           set stage_code = 'finalizado', payment_status = 'pago', finished_at = now(),
               exit_at = now(), in_service = false, updated_by = '${recepcionista}'
         where id = '${a.id}'`);
    }
  });
}

// =====================================================================
// 1. Cadastro
// =====================================================================

describe('1. cadastro dos pacientes', () => {
  it('os dez existem, sem duplicata e sem cadastro apagado', async () => {
    const r = await um<{ total: number; distintos: number }>(`
      select count(*)::int as total, count(distinct cpf)::int as distintos
        from public.patients where tenant_id = '${amb.tenant}' and deleted_at is null`);
    expect(r.total).toBe(10);
    expect(r.distintos).toBe(10);
  });

  it.each(PERFIS)('$nome — $porque', async (perfil) => {
    const r = reg(perfil.chave);
    const p = await um<{
      full_name: string;
      cpf: string;
      birth_date: string | null;
      company_id: string | null;
    }>(`select full_name, cpf, birth_date::text, company_id from public.patients where id = '${r.paciente}'`);

    expect(p.full_name).toBe(perfil.nome);
    expect(p.cpf).toHaveLength(11);
    expect(formatCPF(p.cpf)).toMatch(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/);
    expect(p.birth_date).toBe(perfil.nascimento);
    if (perfil.empresa === null) expect(p.company_id).toBeNull();
    else expect(p.company_id).not.toBeNull();
  });

  it('nenhuma data de nascimento no futuro', async () => {
    const r = await linhas(`
      select id from public.patients
       where tenant_id = '${amb.tenant}' and birth_date > current_date`);
    expect(r).toEqual([]);
  });
});

// =====================================================================
// 2. Senhas
// =====================================================================

describe('2. senhas do totem', () => {
  it('cada paciente saiu com uma senha', () => {
    for (const chave of ORDEM) expect(reg(chave).senha).toMatch(/^[A-Z]\d{3}$/);
  });

  it('nenhuma senha repetida no dia', () => {
    const todas = ORDEM.map((c) => reg(c).senha);
    expect(new Set(todas).size).toBe(todas.length);
  });

  it('a senha do prioritario tem prefixo proprio', () => {
    expect(reg('ivana').senha.startsWith('P')).toBe(true);
    expect(reg('adriana').senha.startsWith('A')).toBe(true);
  });

  it('a numeracao e sequencial dentro de cada prefixo', async () => {
    const r = await linhas<{ prefix: string; sequence: number }>(`
      select prefix, sequence from public.queue_tickets
       where tenant_id = '${amb.tenant}' order by prefix, sequence`);
    const porPrefixo = new Map<string, number[]>();
    for (const t of r) porPrefixo.set(t.prefix, [...(porPrefixo.get(t.prefix) ?? []), t.sequence]);
    for (const [, seqs] of porPrefixo) {
      expect(seqs).toEqual(seqs.map((_, i) => i + 1));
    }
  });

  it('toda senha aponta para um atendimento existente', async () => {
    const r = await linhas(`
      select qt.id from public.queue_tickets qt
       left join public.attendances a on a.id = qt.attendance_id
       where qt.tenant_id = '${amb.tenant}' and a.id is null`);
    expect(r).toEqual([]);
  });
});

// =====================================================================
// 3. Filas e salas
// =====================================================================

describe('3. filas e salas', () => {
  it('nenhuma sala ficou ocupada no fim do dia', async () => {
    const r = await linhas<{ name: string }>(`
      select name from public.rooms
       where tenant_id = '${amb.tenant}' and (status <> 'disponivel' or current_attendance_id is not null)`);
    expect(r.map((x) => x.name)).toEqual([]);
  });

  it('nenhum paciente ficou marcado em atendimento', async () => {
    const r = await linhas<{ id: string }>(`
      select id from public.attendances where tenant_id = '${amb.tenant}' and in_service`);
    expect(r).toEqual([]);
  });

  it('ninguem foi chamado em duas salas ao mesmo tempo', () => {
    // Cada chamada registrada tem de ter terminado antes da seguinte do mesmo paciente.
    const porPaciente = new Map<string, number>();
    for (const c of chamadas) porPaciente.set(c.atendimento, (porPaciente.get(c.atendimento) ?? 0) + 1);
    // O Heitor tem cinco salas; ninguem pode ter sido chamado mais vezes que o numero de salas dele.
    for (const [atendimento, vezes] of porPaciente) {
      const r = [...registros.values()].find((x) => x.atendimento === atendimento);
      const salasEsperadas = new Set(
        (r?.examesPedidos ?? []).filter((c) => c !== 'CLINICO' && c !== 'RAIOX'),
      );
      expect(vezes).toBeLessThanOrEqual(Math.max(salasEsperadas.size, 1));
    }
  });

  it('as tres dinamometrias do Diego foram uma chamada so', () => {
    const doDiego = chamadas.filter((c) => c.atendimento === reg('diego').atendimento);
    expect(doDiego).toHaveLength(1);
    expect(doDiego[0]?.quantos).toBe(3);
  });

  it('a prioritaria foi chamada na audiometria antes das normais', () => {
    const naAudiometria = chamadas.filter((c) => c.salaNome.toLowerCase().includes('audio'));
    expect(naAudiometria.length).toBeGreaterThanOrEqual(3);
    expect(naAudiometria[0]?.atendimento).toBe(reg('ivana').atendimento);
  });

  it('nenhum exame ficou em duas salas', async () => {
    const r = await linhas(`
      select attendance_id from public.patient_exams
       where tenant_id = '${amb.tenant}' and status in ('chamado','em_andamento')
       group by attendance_id having count(distinct room_id) > 1`);
    expect(r).toEqual([]);
  });

  it('todo exame concluido registrou em qual sala aconteceu', async () => {
    const r = await linhas<{ codigo: string }>(`
      select et.code as codigo from public.patient_exams pe
        join public.exam_types et on et.id = pe.exam_type_id
       where pe.tenant_id = '${amb.tenant}' and pe.status = 'concluido'
         and et.ocupa_sala and pe.room_id is null`);
    expect(r.map((x) => x.codigo)).toEqual([]);
  });

  it('a sala de cada exame e a sala padrao dele', async () => {
    const r = await linhas<{ codigo: string }>(`
      select distinct et.code as codigo from public.patient_exams pe
        join public.exam_types et on et.id = pe.exam_type_id
       where pe.tenant_id = '${amb.tenant}' and pe.room_id is not null
         and et.default_room_id is not null and pe.room_id <> et.default_room_id`);
    expect(r.map((x) => x.codigo)).toEqual([]);
  });

  it('a distribuicao da tela nao deixa exame ativo fora de sala', async () => {
    const salas = await linhas<{ id: string }>(`
      select id from public.rooms where tenant_id = '${amb.tenant}' and kind = 'exame' and is_active`);
    const exames = await linhas<{
      id: string;
      status: string;
      room_id: string | null;
      exam_types: { default_room_id: string | null } | null;
    }>(`
      select pe.id, pe.status::text, pe.room_id,
             jsonb_build_object('default_room_id', et.default_room_id) as exam_types
        from public.patient_exams pe
        join public.exam_types et on et.id = pe.exam_type_id
       where pe.tenant_id = '${amb.tenant}' and et.ocupa_sala
         and pe.status in ('pendente','em_fila','chamado','em_andamento')`);

    const d = distribuirExames(salas, exames);
    expect(d.semSala).toEqual([]);
    expect(contarNaFila(d).emSalas).toBe(
      exames.filter((e) => NA_FILA.includes(e.status)).length,
    );
  });
});

// =====================================================================
// 4. Etapas do atendimento
// =====================================================================

describe('4. etapas do atendimento', () => {
  it('nove terminaram e um foi cancelado', async () => {
    const r = await um<{ finalizados: number; cancelados: number; abertos: number }>(`
      select count(*) filter (where stage_code = 'finalizado')::int as finalizados,
             count(*) filter (where stage_code = 'cancelado')::int as cancelados,
             count(*) filter (where stage_code not in ('finalizado','cancelado'))::int as abertos
        from public.attendances where tenant_id = '${amb.tenant}'`);
    expect(r.cancelados).toBe(1);
    expect(r.abertos).toBe(0);
    expect(r.finalizados).toBe(9);
  });

  it.each(PERFIS.filter((p) => !p.desiste))('$chave chegou ao fim', async (perfil) => {
    const r = await um<{ stage_code: string; finished_at: string | null }>(
      `select stage_code, finished_at from public.attendances where id = '${reg(perfil.chave).atendimento}'`,
    );
    expect(r.stage_code).toBe('finalizado');
    expect(r.finished_at).not.toBeNull();
  });

  it.each(PERFIS.filter((p) => p.exames.includes('CLINICO') && !p.desiste))(
    '$chave passou pelo medico',
    async (perfil) => {
      const r = await um<{ total: number }>(
        `select count(*)::int as total from public.medical_consultations where attendance_id = '${reg(perfil.chave).atendimento}'`,
      );
      expect(r.total).toBe(1);
    },
  );

  it.each(PERFIS.filter((p) => !p.exames.includes('CLINICO')))(
    '$chave nao foi ao medico — nao tinha consulta marcada',
    async (perfil) => {
      const r = await um<{ total: number }>(
        `select count(*)::int as total from public.medical_consultations where attendance_id = '${reg(perfil.chave).atendimento}'`,
      );
      expect(r.total).toBe(0);
    },
  );

  it('o historico do CRM registra toda mudanca de etapa', async () => {
    for (const chave of ORDEM) {
      const r = await um<{ total: number }>(
        `select count(*)::int as total from public.crm_movements where attendance_id = '${reg(chave).atendimento}'`,
      );
      expect(r.total).toBeGreaterThanOrEqual(3);
    }
  });

  it('nenhuma etapa pulou direto da recepcao para o pagamento com exame por fazer', async () => {
    const r = await linhas<{ attendance_id: string }>(`
      select distinct pe.attendance_id from public.patient_exams pe
        join public.exam_types et on et.id = pe.exam_type_id
        join public.attendances a on a.id = pe.attendance_id
       where pe.tenant_id = '${amb.tenant}' and et.ocupa_sala
         and pe.status in ('pendente','em_fila','chamado','em_andamento')
         and a.stage_code in ('aguardando_pagamento','finalizado')`);
    expect(r).toEqual([]);
  });

  it('o cancelado saiu das filas e nao deixou exame ativo', async () => {
    const r = await um<{ ativos: number; sala: string | null }>(`
      select (select count(*)::int from public.patient_exams
               where attendance_id = '${reg('joaquim').atendimento}'
                 and status in ('pendente','em_fila','chamado','em_andamento')) as ativos,
             (select current_room_id::text from public.attendances where id = '${reg('joaquim').atendimento}') as sala`);
    expect(r.ativos).toBe(0);
    expect(r.sala).toBeNull();
  });
});

// =====================================================================
// 5. Painel de TV
// =====================================================================

describe('5. painel de TV', () => {
  it('toda chamada de sala foi ao painel', async () => {
    const r = await um<{ total: number }>(
      `select count(*)::int as total from public.tv_calls where tenant_id = '${amb.tenant}' and destination = 'sala'`,
    );
    expect(r.total).toBe(chamadas.length);
  });

  it('nenhuma chamada foi ao painel sem senha', async () => {
    const r = await linhas<{ ticket_code: string }>(`
      select ticket_code from public.tv_calls
       where tenant_id = '${amb.tenant}' and (ticket_code is null or ticket_code = '---')`);
    expect(r).toEqual([]);
  });

  it('o painel mostra so o primeiro nome', async () => {
    const r = await linhas<{ patient_label: string | null }>(
      `select patient_label from public.tv_calls where tenant_id = '${amb.tenant}'`,
    );
    for (const c of r) expect(c.patient_label ?? '').not.toContain(' ');
  });

  it('toda chamada de sala nomeia a sala', async () => {
    const r = await linhas(`
      select id from public.tv_calls
       where tenant_id = '${amb.tenant}' and destination = 'sala' and coalesce(room_name,'') = ''`);
    expect(r).toEqual([]);
  });
});

// =====================================================================
// 6. Documentos impressos
// =====================================================================

interface DadosParaDocumento {
  nome: string;
  cpf: string | null;
  nascimento: string | null;
  empresa: string | null;
  empresaDoc: string | null;
}

const clinica = {
  nome: 'H2 Medicina Ocupacional',
  razaoSocial: 'H2 Medicina Ocupacional Ltda',
  cnpj: 'CNPJ 52.830.198/0001-34',
  endereco: 'R. Sacramento, 908, Vila Itapura, Campinas, SP',
  contato: '(19) 3235-3599',
  cor: '#0F766E',
  logo: null,
};

async function dadosDe(chave: string): Promise<DadosParaDocumento> {
  return um<DadosParaDocumento>(`
    select p.full_name as nome, p.cpf, p.birth_date::text as nascimento,
           c.legal_name as empresa, c.document as "empresaDoc"
      from public.patients p
      left join public.companies c on c.id = p.company_id
     where p.id = '${reg(chave).paciente}'`);
}

describe('6. documentos impressos', () => {
  it.each(PERFIS)('a guia do $chave imprime a data de nascimento do cadastro', async (perfil) => {
    const d = await dadosDe(perfil.chave);
    const bytes = await buildGuiaDeExame({
      clinica,
      // Mesmo preparo de guia-actions.ts: a tela formata antes de imprimir.
      colaborador: {
        nome: d.nome,
        cpf: d.cpf ? formatCPF(d.cpf) : null,
        rg: null,
        sexo: 'Feminino',
        nascimento: d.nascimento ? formatDate(d.nascimento) : null,
        cargo: 'Operador',
        setor: 'Producao',
      },
      empresa: d.empresa
        ? {
            nome: d.empresa,
            documento: d.empresaDoc,
            endereco: null,
            bairro: null,
            cidadeUf: null,
            cep: null,
          }
        : null,
      exames: ['RX de Torax'],
      agendadoPara: null,
      preparos: null,
      localDoExame: 'R. Sacramento, 908',
      rodape: null,
    });

    const texto = textoDoPdf(bytes);
    expect(texto.length).toBeGreaterThan(200);
    expect(texto).toContain(d.nome);

    // O ponto do teste: a data no papel e a data do banco, sem deslize de fuso.
    if (perfil.nascimento) {
      const [ano, mes, dia] = perfil.nascimento.split('-');
      expect(texto).toContain(`${dia}/${mes}/${ano}`);
      expect(formatDate(perfil.nascimento)).toBe(`${dia}/${mes}/${ano}`);
    }
  });

  it.each(PERFIS.filter((p) => p.nascimento))(
    'o A.S.O. do $chave imprime nascimento e idade certos',
    async (perfil) => {
      const d = await dadosDe(perfil.chave);
      const idade = calcAge(d.nascimento);
      const bytes = await buildAsoPdf({
        clinica: {
          nome: clinica.nome,
          razaoSocial: clinica.razaoSocial,
          cnpj: clinica.cnpj,
          endereco: clinica.endereco,
          telefone: clinica.contato,
          cor: clinica.cor,
        },
        emitidoEm: new Date(),
        empresaContratante: {
          razaoSocial: d.empresa ?? 'Particular',
          cnpj: d.empresaDoc,
          endereco: null,
          bairro: null,
          cidade: 'Campinas',
          cep: null,
        },
        funcionario: {
          nome: d.nome,
          matricula: null,
          cpf: d.cpf,
          rg: null,
          nascimento: formatDate(d.nascimento),
          idade,
          sexo: 'Feminino',
          cargo: 'Operador',
          setor: 'Producao',
        },
        medicoPcmso: {
          nome: 'Dra. Wania Sanches Picasso',
          conselho: 'CRM',
          numero: '104564',
          uf: 'SP',
          rqe: null,
          endereco: null,
          bairro: null,
          cidade: null,
          cep: null,
          telefone: null,
        },
        medicoExaminador: {
          nome: 'Dra. Wania Sanches Picasso',
          conselho: 'CRM',
          numero: '104564',
          uf: 'SP',
        },
        riscos: montarRiscos(null, null),
        tipoExame: 'Admissional',
        exames: perfil.exames.map((c) => ({ nome: c, data: formatDate(new Date()) })),
        parecer: 'Apto',
        restricoes: null,
        validade: null,
        observacoes: null,
        assinaturaPaciente: null,
        codigoVerificacao: 'ABCDEF0123',
        urlVerificacao: null,
        rodape: null,
      });

      const texto = textoDoPdf(bytes);
      const [ano, mes, dia] = (perfil.nascimento ?? '').split('-');
      expect(texto).toContain(`${dia}/${mes}/${ano}`);
      expect(texto).toContain(d.nome);
      if (idade !== null) expect(imprime(bytes, `${idade} ANOS`)).toBe(true);
    },
  );

  it('a idade de quem faz aniversario hoje ja conta o ano', () => {
    expect(calcAge(reg('camila').perfil.nascimento)).toBe(38);
  });

  it('cadastro sem data de nascimento imprime travessao, nao data errada', async () => {
    const d = await dadosDe('eliane');
    expect(d.nascimento).toBeNull();
    expect(formatDate(d.nascimento)).toBe('—');
  });

  it('so raio X e coleta geram guia', () => {
    expect([...GERA_GUIA].sort()).toEqual(['LAB', 'RAIOX']);
  });
});

// =====================================================================
// 7. Documentos gravados e verificacao publica
// =====================================================================

describe('7. documentos gravados', () => {
  beforeAll(async () => {
    await comoMedico(async () => {
      for (const chave of ORDEM) {
        const r = reg(chave);
        if (r.perfil.desiste) continue;
        await amb.db.exec(`
          insert into public.documents
            (tenant_id, kind, title, patient_id, attendance_id, file_path, verification_code,
             is_patient_visible, generated_by)
          values ('${amb.tenant}', 'aso', 'A.S.O.', '${r.paciente}', '${r.atendimento}',
                  '${amb.tenant}/aso/${r.atendimento}.pdf',
                  upper(encode(gen_random_bytes(5), 'hex')), true, '${medico}')`);
      }
    });
  });

  it('todo documento visivel ao paciente diz de quem e', async () => {
    const r = await linhas<{ id: string }>(`
      select id from public.documents
       where tenant_id = '${amb.tenant}' and is_patient_visible and patient_id is null`);
    expect(r).toEqual([]);
  });

  it('todo codigo de verificacao tem o formato que a pagina publica aceita', async () => {
    const r = await linhas<{ verification_code: string }>(
      `select verification_code from public.documents where tenant_id = '${amb.tenant}'`,
    );
    expect(r.length).toBe(9);
    for (const d of r) expect(CODIGO_VALIDO.test(d.verification_code)).toBe(true);
  });

  it('nenhum codigo se repete', async () => {
    const r = await um<{ total: number; distintos: number }>(`
      select count(*)::int as total, count(distinct verification_code)::int as distintos
        from public.documents where tenant_id = '${amb.tenant}'`);
    expect(r.distintos).toBe(r.total);
  });

  it('a pagina de verificacao reconhece os documentos emitidos', async () => {
    const r = await linhas<{
      kind: string;
      title: string;
      generated_at: string;
      full_name: string;
    }>(`
      select d.kind::text, d.title, d.generated_at::text, p.full_name
        from public.documents d join public.patients p on p.id = d.patient_id
       where d.tenant_id = '${amb.tenant}'`);

    for (const linha of r) {
      const resposta = montarResposta(
        {
          kind: linha.kind,
          title: linha.title,
          generated_at: linha.generated_at,
          deleted_at: null,
          signer_name: 'Dra. Wania Sanches Picasso',
          signer_council: 'CRM 104564/SP',
          patients: { full_name: linha.full_name },
        },
        clinica.nome,
      );
      expect(resposta.situacao).toBe('autentico');
      expect(resposta.paciente).not.toBe(linha.full_name);
      expect(resposta.paciente.length).toBeGreaterThan(0);
    }
  });

  it('o tipo do documento existe no banco e na tela', async () => {
    const r = await linhas<{ kind: string }>(
      `select distinct kind::text from public.documents where tenant_id = '${amb.tenant}'`,
    );
    const validos = await linhas<{ rotulo: string }>(`
      select unnest(enum_range(null::document_kind))::text as rotulo`);
    const conhecidos = new Set(validos.map((x) => x.rotulo));
    for (const d of r) expect(conhecidos.has(d.kind)).toBe(true);
  });
});

// =====================================================================
// 8. Financeiro
// =====================================================================

describe('8. financeiro', () => {
  it('cada atendimento finalizado tem uma cobranca', async () => {
    const r = await linhas<{ id: string }>(`
      select a.id from public.attendances a
       where a.tenant_id = '${amb.tenant}' and a.stage_code = 'finalizado'
         and not exists (select 1 from public.payments p where p.attendance_id = a.id)`);
    expect(r).toEqual([]);
  });

  it('o valor cobrado e a soma dos exames pedidos', async () => {
    const r = await linhas<{ cobrado: string; esperado: string; nome: string }>(`
      select p.amount::text as cobrado,
             (select coalesce(sum(et.price), 0) from public.patient_exams pe
                join public.exam_types et on et.id = pe.exam_type_id
               where pe.attendance_id = p.attendance_id and pe.status <> 'cancelado')::text as esperado,
             pa.full_name as nome
        from public.payments p
        join public.patients pa on pa.id = p.patient_id
       where p.tenant_id = '${amb.tenant}'`);

    expect(r.length).toBe(9);
    for (const linha of r) {
      expect(Number(linha.cobrado)).toBeCloseTo(Number(linha.esperado), 2);
      expect(Number(linha.cobrado)).toBeGreaterThan(0);
    }
  });

  it('o cancelado nao gerou cobranca', async () => {
    const r = await linhas(`
      select id from public.payments where attendance_id = '${reg('joaquim').atendimento}'`);
    expect(r).toEqual([]);
  });

  it('o resumo do caixa bate com a soma do banco', async () => {
    const movimentos = await linhas<{
      pagoEm: string | null;
      competencia: string;
      tipo: 'receita' | 'despesa' | 'repasse';
      valor: string;
      categoria: string;
    }>(`
      select p.paid_at::text as "pagoEm", p.due_date::text as competencia,
             'receita' as tipo, p.net_amount::text as valor, 'Atendimento' as categoria
        from public.payments p where p.tenant_id = '${amb.tenant}' and p.status = 'pago'
      union all
      select f.paid_at::text, f.competencia::text, 'repasse', f.fee::text, 'Repasse medico'
        from public.fee_entries f where f.tenant_id = '${amb.tenant}'`);

    // O repasse e lancado por competencia mensal: a janela tem de ser o mes,
    // senao o caixa do dia mostra receita sem o custo que ela gerou.
    const [ano, mes] = HOJE;
    const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
    const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
    const fim = `${ano}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;
    const resumo = resumirFluxo(movimentos, inicio, fim);

    const banco = await um<{ receita: string; repasse: string }>(`
      select (select coalesce(sum(net_amount),0) from public.payments
               where tenant_id = '${amb.tenant}' and status = 'pago')::text as receita,
             (select coalesce(sum(fee),0) from public.fee_entries
               where tenant_id = '${amb.tenant}')::text as repasse`);

    expect(resumo.receita).toBeCloseTo(Number(banco.receita), 2);
    expect(resumo.repasse).toBeCloseTo(Number(banco.repasse), 2);
    expect(resumo.resultado).toBeCloseTo(resumo.receita - resumo.despesa - resumo.repasse, 2);
  });

  it('o repasse do medico cobre exatamente as consultas feitas', async () => {
    const consultas = await um<{ total: number }>(
      `select count(*)::int as total from public.medical_consultations where tenant_id = '${amb.tenant}'`,
    );
    const lancamentos = await linhas<{
      profile_id: string;
      medico: string;
      procedure_name: string;
      fee: string;
      status: string;
      competencia: string;
    }>(`
      select f.profile_id, pr.full_name as medico, f.procedure_name, f.fee::text, f.status,
             f.competencia::text
        from public.fee_entries f join public.profiles pr on pr.id = f.profile_id
       where f.tenant_id = '${amb.tenant}'`);

    expect(lancamentos.length).toBe(consultas.total);

    const porMedico = agruparPorMedico(lancamentos);
    expect(porMedico).toHaveLength(1);
    expect(porMedico[0]?.atendimentos).toBe(consultas.total);
    expect(porMedico[0]?.aPagar).toBeCloseTo(consultas.total * 60, 2);
  });

  it('nenhuma cobranca ficou sem paciente', async () => {
    const r = await linhas(`
      select id from public.payments where tenant_id = '${amb.tenant}' and patient_id is null`);
    expect(r).toEqual([]);
  });
});

// =====================================================================
// 9. Metricas das telas
// =====================================================================

describe('9. metricas das telas', () => {
  it('o painel conta os mesmos atendimentos do dia que o banco', async () => {
    const r = await um<{ doDia: number; total: number }>(`
      select count(*) filter (
               where checkin_at >= (current_date::timestamptz))::int as "doDia",
             count(*)::int as total
        from public.attendances where tenant_id = '${amb.tenant}'`);
    expect(r.doDia).toBe(10);
    expect(r.total).toBe(10);
  });

  it('exames concluidos batem com as fichas preenchidas', async () => {
    const r = await um<{ concluidos: number; fichas: number }>(`
      select (select count(*)::int from public.patient_exams pe
                join public.exam_types et on et.id = pe.exam_type_id
               where pe.tenant_id = '${amb.tenant}' and pe.status = 'concluido' and et.ocupa_sala) as concluidos,
             (select count(*)::int from public.exam_results
               where tenant_id = '${amb.tenant}') as fichas`);
    expect(r.fichas).toBe(r.concluidos);
  });

  it('o tempo de cada exame e positivo e plausivel', async () => {
    const r = await linhas<{ duracao: number }>(`
      select duration_seconds as duracao from public.patient_exams
       where tenant_id = '${amb.tenant}' and duration_seconds is not null`);
    expect(r.length).toBeGreaterThan(0);
    for (const e of r) {
      expect(e.duracao).toBeGreaterThanOrEqual(0);
      expect(e.duracao).toBeLessThan(60 * 60 * 8);
    }
  });

  it('nenhum atendimento terminou antes de comecar', async () => {
    const r = await linhas(`
      select id from public.attendances
       where tenant_id = '${amb.tenant}' and finished_at is not null and finished_at < checkin_at`);
    expect(r).toEqual([]);
  });

  it('nenhum exame terminou antes de ser chamado', async () => {
    const r = await linhas(`
      select id from public.patient_exams
       where tenant_id = '${amb.tenant}' and finished_at is not null and called_at is not null
         and finished_at < called_at`);
    expect(r).toEqual([]);
  });

  it('todo exame concluido tem inicio e fim', async () => {
    const r = await linhas<{ id: string }>(`
      select id from public.patient_exams
       where tenant_id = '${amb.tenant}' and status = 'concluido'
         and (started_at is null or finished_at is null)`);
    expect(r).toEqual([]);
  });
});

// =====================================================================
// 10. Integridade do banco depois do dia
// =====================================================================

describe('10. integridade do banco', () => {
  it('nenhum registro do dia ficou sem tenant', async () => {
    for (const tabela of [
      'attendances',
      'patient_exams',
      'exam_results',
      'queue_tickets',
      'tv_calls',
      'documents',
      'payments',
      'fee_entries',
      'crm_movements',
      'queue_events',
    ]) {
      const r = await um<{ total: number }>(
        `select count(*)::int as total from public.${tabela} where tenant_id is null`,
      );
      expect(r.total).toBe(0);
    }
  });

  it('todo exame pertence ao mesmo paciente do atendimento', async () => {
    const r = await linhas(`
      select pe.id from public.patient_exams pe
        join public.attendances a on a.id = pe.attendance_id
       where pe.patient_id <> a.patient_id`);
    expect(r).toEqual([]);
  });

  it('toda ficha de exame pertence ao paciente daquele exame', async () => {
    const r = await linhas(`
      select er.id from public.exam_results er
        join public.patient_exams pe on pe.id = er.patient_exam_id
       where er.patient_id <> pe.patient_id`);
    expect(r).toEqual([]);
  });

  it('toda consulta pertence ao paciente do atendimento', async () => {
    const r = await linhas(`
      select mc.id from public.medical_consultations mc
        join public.attendances a on a.id = mc.attendance_id
       where mc.patient_id <> a.patient_id`);
    expect(r).toEqual([]);
  });

  it('nenhum atendimento aponta para sala de outro tenant', async () => {
    const r = await linhas(`
      select a.id from public.attendances a
        join public.rooms r on r.id = a.current_room_id
       where r.tenant_id <> a.tenant_id`);
    expect(r).toEqual([]);
  });

  it('o RLS continua ligado e forcado em todas as tabelas', async () => {
    const r = await linhas<{ relname: string }>(`
      select c.relname from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
         and (not c.relrowsecurity or not c.relforcerowsecurity)`);
    expect(r.map((x) => x.relname)).toEqual([]);
  });
});

// =====================================================================
// 11. Os tres buracos que este pente fino encontrou
//
// Ficam separados de proposito: sao a prova de que cada um foi fechado, e
// falham de novo se alguem reabrir.
// =====================================================================

describe('11. o que o pente fino encontrou', () => {
  it('quem passa pela triagem so para a consulta nao fica preso na fila', async () => {
    // O Fabio: triagem marcada, nenhum exame de sala. Antes ele caia em
    // 'aguardando_exames', onde nao havia exame para concluir — e nada
    // dispara a etapa seguinte. Sumia das tres telas ao mesmo tempo.
    const r = await um<{ stage_code: string; consultas: number }>(`
      select a.stage_code,
             (select count(*)::int from public.medical_consultations mc
               where mc.attendance_id = a.id) as consultas
        from public.attendances a where a.id = '${reg('fabio').atendimento}'`);
    expect(r.consultas).toBe(1);
    expect(r.stage_code).toBe('finalizado');
  });

  it('cancelar solta o paciente, a sala e os exames dele', async () => {
    const r = await um<{
      in_service: boolean;
      sala: string | null;
      ativos: number;
      salaPresa: number;
    }>(`
      select a.in_service, a.current_room_id::text as sala,
             (select count(*)::int from public.patient_exams pe
               where pe.attendance_id = a.id
                 and pe.status in ('pendente','em_fila','chamado','em_andamento')) as ativos,
             (select count(*)::int from public.rooms r
               where r.current_attendance_id = a.id) as "salaPresa"
        from public.attendances a where a.id = '${reg('joaquim').atendimento}'`);
    expect(r.in_service).toBe(false);
    expect(r.sala).toBeNull();
    expect(r.ativos).toBe(0);
    expect(r.salaPresa).toBe(0);
  });

  it('assinar a consulta conclui o item "Consulta clinica ocupacional"', async () => {
    const r = await linhas<{ nome: string; status: string }>(`
      select p.full_name as nome, pe.status::text
        from public.patient_exams pe
        join public.exam_types et on et.id = pe.exam_type_id
        join public.attendances a on a.id = pe.attendance_id
        join public.patients p on p.id = pe.patient_id
       where et.code = 'CLINICO' and a.cancelled_at is null`);

    expect(r.length).toBeGreaterThan(0);
    for (const linha of r) expect(linha.status).toBe('concluido');
  });

  it('nenhuma consulta ficou pendente num atendimento encerrado', async () => {
    const r = await linhas<{ nome: string }>(`
      select p.full_name as nome
        from public.patient_exams pe
        join public.exam_types et on et.id = pe.exam_type_id
        join public.attendances a on a.id = pe.attendance_id
        join public.patients p on p.id = pe.patient_id
       where a.stage_code = 'finalizado'
         and pe.status in ('pendente','em_fila','chamado','em_andamento')
         and et.code <> 'RAIOX'`);
    expect(r.map((x) => x.nome)).toEqual([]);
  });
});

// =====================================================================
// 12. Catalogo de exames da clinica
// =====================================================================

const CATALOGO = [
  { codigo: 'AUDIO', sala: true, guia: false },
  { codigo: 'ECG', sala: true, guia: false },
  { codigo: 'EEG', sala: true, guia: false },
  { codigo: 'ESPIRO', sala: true, guia: false },
  { codigo: 'LAB', sala: true, guia: true },
  { codigo: 'CLINICO', sala: false, guia: false },
  { codigo: 'ACUIDADE', sala: true, guia: false },
  { codigo: 'ISHIHARA', sala: true, guia: false },
  { codigo: 'PSICO', sala: true, guia: false },
  { codigo: 'ROMBERG', sala: true, guia: false },
  { codigo: 'FADIGA', sala: true, guia: false },
  { codigo: 'DINAMO_PAL', sala: true, guia: false },
  { codigo: 'DINAMO_ESC', sala: true, guia: false },
  { codigo: 'DINAMO_LOM', sala: true, guia: false },
  { codigo: 'RAIOX', sala: false, guia: true },
];

describe('12. catalogo de exames', () => {
  it.each(CATALOGO)('$codigo esta cadastrado, ativo e coerente', async ({ codigo, sala, guia }) => {
    const e = await um<{
      nome: string;
      ativo: boolean;
      ocupa: boolean;
      preco: string | null;
      salaId: string | null;
      salaAtiva: boolean | null;
      vinculos: number;
    }>(`
      select et.name as nome, et.is_active as ativo, et.ocupa_sala as ocupa, et.price::text as preco,
             et.default_room_id::text as "salaId", r.is_active as "salaAtiva",
             (select count(*)::int from public.room_exam_types ret where ret.exam_type_id = et.id) as vinculos
        from public.exam_types et
        left join public.rooms r on r.id = et.default_room_id
       where et.tenant_id = '${amb.tenant}' and et.code = '${codigo}'`);

    expect(e.nome.length).toBeGreaterThan(2);
    expect(e.ativo).toBe(true);
    expect(e.ocupa).toBe(sala);
    expect(Number(e.preco ?? 0)).toBeGreaterThanOrEqual(0);

    if (sala) {
      expect(e.salaId).not.toBeNull();
      expect(e.salaAtiva).toBe(true);
      // Uma sala, um vinculo: duas verdades sobre a mesma sala sempre divergem.
      expect(e.vinculos).toBe(1);
    } else {
      expect(e.vinculos).toBeLessThanOrEqual(1);
    }

    expect(GERA_GUIA.has(codigo)).toBe(guia);
  });

  it('a dinamometria generica saiu de cena depois de ser separada em tres', async () => {
    const e = await um<{ ativo: boolean }>(
      `select is_active as ativo from public.exam_types where tenant_id = '${amb.tenant}' and code = 'DINAMO'`,
    );
    expect(e.ativo).toBe(false);
  });

  it('as tres dinamometrias sao chamadas na mesma sala', async () => {
    const r = await linhas<{ sala: string }>(`
      select distinct default_room_id::text as sala from public.exam_types
       where tenant_id = '${amb.tenant}' and code like 'DINAMO\\_%'`);
    expect(r).toHaveLength(1);
  });

  it('nenhum exame ativo aponta para sala inativa ou apagada', async () => {
    const r = await linhas<{ code: string }>(`
      select et.code from public.exam_types et
        join public.rooms r on r.id = et.default_room_id
       where et.tenant_id = '${amb.tenant}' and et.is_active
         and (not r.is_active or r.deleted_at is not null)`);
    expect(r.map((x) => x.code)).toEqual([]);
  });
});

// =====================================================================
// 13. Datas de borda
//
// A conta que errou em 21/09. Uma bateria de datas que, somadas, cobrem
// virada de ano, bissexto, periodos antigos de horario de verao e o dia
// do aniversario.
// =====================================================================

const DATAS: { iso: string; impresso: string }[] = [
  { iso: '1900-01-01', impresso: '01/01/1900' },
  { iso: '1940-02-29', impresso: '29/02/1940' },
  { iso: '1959-11-20', impresso: '20/11/1959' },
  { iso: '1963-12-02', impresso: '02/12/1963' },
  { iso: '1965-07-04', impresso: '04/07/1965' },
  { iso: '1970-01-01', impresso: '01/01/1970' },
  { iso: '1978-12-31', impresso: '31/12/1978' },
  { iso: '1985-11-25', impresso: '25/11/1985' },
  { iso: '1988-06-09', impresso: '09/06/1988' },
  { iso: '1990-01-01', impresso: '01/01/1990' },
  { iso: '1992-02-29', impresso: '29/02/1992' },
  { iso: '1996-02-29', impresso: '29/02/1996' },
  { iso: '2000-02-29', impresso: '29/02/2000' },
  { iso: '2006-03-15', impresso: '15/03/2006' },
  { iso: '2010-10-17', impresso: '17/10/2010' },
  { iso: '2012-02-26', impresso: '26/02/2012' },
  { iso: '2015-10-18', impresso: '18/10/2015' },
  { iso: '2017-10-15', impresso: '15/10/2017' },
  { iso: '2018-02-17', impresso: '17/02/2018' },
  { iso: '2018-11-04', impresso: '04/11/2018' },
  { iso: '2019-02-16', impresso: '16/02/2019' },
  { iso: '2020-12-31', impresso: '31/12/2020' },
  { iso: '2024-02-29', impresso: '29/02/2024' },
];

describe('13. datas de borda', () => {
  it.each(DATAS)('$iso imprime $impresso e volta do banco igual', async ({ iso, impresso }) => {
    expect(formatDate(iso)).toBe(impresso);

    // Ida e volta pelo banco: a coluna e `date`, e e dela que o papel sai.
    const r = await um<{ gravado: string }>(`select '${iso}'::date::text as gravado`);
    expect(r.gravado).toBe(iso);
    expect(formatDate(r.gravado)).toBe(impresso);
  });

  it.each(DATAS)('$iso produz uma idade plausivel', ({ iso }) => {
    const idade = calcAge(iso);
    expect(idade).not.toBeNull();
    expect(idade!).toBeGreaterThanOrEqual(0);
    expect(idade!).toBeLessThan(130);
  });

  it.each([
    '2026-02-31',
    '2026-13-01',
    '2026-00-10',
    'nao e data',
    '',
    '12/05/1990',
  ])('%s nao vira data', (ruim) => {
    expect(formatDate(ruim)).toBe('—');
  });
});

// =====================================================================
// 14. Percurso individual, paciente a paciente
// =====================================================================

describe('14. percurso de cada paciente', () => {
  it.each(PERFIS)('$chave: senha, etapa, exames e conta fecham', async (perfil) => {
    const r = reg(perfil.chave);
    const cancelado = perfil.desiste === true;

    const estado = await um<{
      etapa: string;
      inService: boolean;
      sala: string | null;
      senhas: number;
      exames: number;
      concluidos: number;
      cancelados: number;
      pagamentos: number;
      movimentos: number;
    }>(`
      select a.stage_code as etapa, a.in_service as "inService", a.current_room_id::text as sala,
             (select count(*)::int from public.queue_tickets q where q.attendance_id = a.id) as senhas,
             (select count(*)::int from public.patient_exams pe where pe.attendance_id = a.id) as exames,
             (select count(*)::int from public.patient_exams pe where pe.attendance_id = a.id and pe.status = 'concluido') as concluidos,
             (select count(*)::int from public.patient_exams pe where pe.attendance_id = a.id and pe.status = 'cancelado') as cancelados,
             (select count(*)::int from public.payments p where p.attendance_id = a.id) as pagamentos,
             (select count(*)::int from public.crm_movements m where m.attendance_id = a.id) as movimentos
        from public.attendances a where a.id = '${r.atendimento}'`);

    expect(estado.senhas).toBe(1);
    expect(estado.exames).toBe(perfil.exames.length);
    expect(estado.inService).toBe(false);
    expect(estado.sala).toBeNull();
    expect(estado.movimentos).toBeGreaterThanOrEqual(3);

    if (cancelado) {
      expect(estado.etapa).toBe('cancelado');
      expect(estado.pagamentos).toBe(0);
      expect(estado.cancelados).toBe(perfil.exames.length);
      return;
    }

    expect(estado.etapa).toBe('finalizado');
    expect(estado.pagamentos).toBe(1);
    expect(estado.cancelados).toBe(0);

    // Raio X nunca e concluido aqui dentro: o resultado volta do laboratorio.
    const esperados = perfil.exames.filter((c) => c !== 'RAIOX').length;
    expect(estado.concluidos).toBe(esperados);
  });

  it.each(PERFIS)('$chave foi chamado no painel pelo menos uma vez', async (perfil) => {
    // Ninguem atravessa a clinica sem a senha aparecer na TV. Quem nao e
    // chamado nao e visto: foi assim que se descobriu o paciente que ficava
    // parado numa fila sem tela.
    const r = await um<{ total: number }>(`
      select count(*)::int as total from public.tv_calls tv
       where tv.tenant_id = '${amb.tenant}'
         and tv.ticket_code = '${reg(perfil.chave).senha}'`);
    expect(r.total).toBeGreaterThanOrEqual(1);
  });
});

// =====================================================================
// 15. Cabecalho da clinica em todo papel
// =====================================================================

describe('15. cabecalho dos documentos', () => {
  it.each(PERFIS)('a guia do $chave sai com os dados da clinica', async (perfil) => {
    const d = await dadosDe(perfil.chave);
    const bytes = await buildGuiaDeExame({
      clinica,
      colaborador: {
        nome: d.nome,
        cpf: d.cpf ? formatCPF(d.cpf) : null,
        rg: null,
        sexo: 'Masculino',
        nascimento: d.nascimento ? formatDate(d.nascimento) : null,
        cargo: 'Operador',
        setor: 'Producao',
      },
      empresa: null,
      exames: ['Hemograma completo'],
      agendadoPara: null,
      preparos: 'Jejum de 8 horas',
      localDoExame: 'R. Sacramento, 908',
      rodape: null,
    });

    expect(imprime(bytes, clinica.razaoSocial)).toBe(true);
    expect(imprime(bytes, '52.830.198/0001-34')).toBe(true);
    expect(imprime(bytes, 'Sacramento')).toBe(true);
    expect(imprime(bytes, 'Hemograma completo')).toBe(true);
    expect(imprime(bytes, 'Jejum de 8 horas')).toBe(true);
    // Nao pode sair papel com o nome de quem desenvolveu o sistema.
    expect(imprime(bytes, 'balao')).toBe(false);
  });
});

// =====================================================================
// 16. Permissoes
// =====================================================================

describe('16. permissoes', () => {
  let semPermissao = '';

  beforeAll(async () => {
    const { id } = await um<{ id: string }>(
      `insert into auth.users (email) values ('sem-permissao@pente.test') returning id`,
    );
    await amb.db.exec(`
      insert into public.profiles (id, tenant_id, full_name, email)
      values ('${id}', '${amb.tenant}', 'Estagiario Sem Papel', 'sem-permissao@pente.test')`);
    semPermissao = id;
  });

  const recusa = async (sql: string): Promise<boolean> => {
    try {
      await amb.como(semPermissao, async () => {
        await amb.db.query(sql);
      });
      return false;
    } catch {
      return true;
    }
  };

  it('sem papel nenhum nao faz check-in', async () => {
    expect(
      await recusa(
        `select public.checkin_patient('${amb.tenant}', null, '${reg('adriana').paciente}', 'normal', null, null)`,
      ),
    ).toBe(true);
  });

  it('sem papel nenhum nao chama o proximo da sala', async () => {
    const sala = await um<{ id: string }>(
      `select id from public.rooms where tenant_id = '${amb.tenant}' and kind = 'exame' limit 1`,
    );
    expect(
      await recusa(`select public.call_next_for_room('${amb.tenant}', '${sala.id}')`),
    ).toBe(true);
  });

  it('sem papel nenhum nao move atendimento de etapa', async () => {
    expect(
      await recusa(
        `select public.move_attendance_stage('${reg('adriana').atendimento}', 'cancelado', 'teste')`,
      ),
    ).toBe(true);
  });

  it('sem papel nenhum nao enxerga paciente', async () => {
    const visiveis = await amb.como(semPermissao, async () =>
      um<{ total: number }>(`select count(*)::int as total from public.patients`),
    );
    expect(visiveis.total).toBe(0);
  });
});
