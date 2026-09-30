/**
 * Cem pacientes pelo sistema inteiro, com os documentos salvos em disco.
 *
 * "gere os pacientes, passe pelo sistema em diferentes situacoes e os
 *  documentos gerados deixa na pasta (documentos teste sistema). gere
 *  relatorios de pagamentos dos medicos referente a esses pacientes."
 *
 * Nao e uma amostra montada a mao: os PDFs sao os mesmos que a clinica
 * recebe, gerados pelo mesmo codigo, a partir de atendimentos que
 * atravessaram recepcao, triagem, salas, consultorio, documentos e caixa
 * pelas acoes de verdade.
 *
 * Quatro medicos atendem em rodizio, para o repasse se dividir de verdade e
 * o relatorio de pagamento ter o que somar.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { montarClinica, type Clinica, type Pessoa } from './clinica';
import { lerCatalogo, passarPeloSistema, type Equipe, type Percurso } from './percurso';
import { gerarPerfis } from './perfis';
import {
  agruparPorMedico,
  CATALOGO_PADRAO,
  type LancamentoRepasse,
} from '@/modules/finance/repasse';
import { arquivosDoStorage } from '../integration/banco-vivo';
import { construirRelatorioDeRepasse } from './relatorio-repasse';

const QUANTOS = Number(process.env.PACIENTES_EXPORT ?? 100);

/** Onde os documentos vao parar, na area de trabalho. */
const PASTA = join(
  process.env.USERPROFILE ?? process.env.HOME ?? '.',
  'Desktop',
  'documentos teste sistema',
);

let c: Clinica;
let equipes: Equipe[] = [];
let medicos: Pessoa[] = [];
let percursos: Percurso[] = [];
let empresas: { id: string; nome: string }[] = [];

/** Nome de arquivo seguro, sem acento nem caractere proibido no Windows. */
function nomeDeArquivo(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9 ._-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60);
}

beforeAll(async () => {
  c = await montarClinica();

  const recepcao = await c.criarPessoa('Isabella Recepção', 'recepcao@export.teste', 'atendimento');
  const triagista = await c.criarPessoa('Técnica de Triagem', 'triagem@export.teste', 'medico_examinador');
  const examinador = await c.criarPessoa('Técnico de Exames', 'exames@export.teste', 'medico_examinador');

  for (const nome of [
    'Dra. Wania Sanches Picasso',
    'Dr. Antônio Ribeiro Martins',
    'Dra. Helena Couto Vilar',
    'Dr. Márcio Tanaka Ferraz',
  ]) {
    const m = await c.criarPessoa(nome, `${nomeDeArquivo(nome).toLowerCase()}@export.teste`, 'medico_examinador');
    medicos.push(m);
    equipes.push({ recepcao, triagista, examinador, medico: m });
  }

  // Duas empresas com valores negociados diferentes, e uma sem nenhum:
  // o relatorio de pagamento precisa refletir isso.
  for (const [nome, doc, desconto] of [
    ['Metalurgica Aurora Ltda', '11222333000181', 0.5],
    ['Transportes Boa Vista SA', '44555666000181', 0.8],
    ['Construtora Sete Pedras ME', '19131243000197', 0],
  ] as const) {
    const e = await c.um<{ id: string }>(`
      insert into public.companies (tenant_id, legal_name, document)
      values ('${c.tenant}', '${nome}', '${doc}') returning id`);
    empresas.push({ id: e.id, nome });
    if (desconto > 0) {
      await c.db.exec(`
        insert into public.company_exam_prices (tenant_id, company_id, exam_type_id, price)
        select '${c.tenant}', '${e.id}', et.id, round(et.price * ${desconto}, 2)
          from public.exam_types et
         where et.tenant_id = '${c.tenant}' and et.price > 0`);
    }
  }

  // ------------------------------------------------------------------
  // Catalogo de procedimentos e valores de repasse.
  //
  // No catalogo real da clinica a "Consulta ocupacional" esta com R$ 0,00 --
  // o comentario no codigo diz "os itens em zero aguardam o valor que ainda
  // nao foi informado". Como ela e o procedimento de quase todo atendimento,
  // o repasse dos medicos sai zerado em producao ate alguem informar o
  // valor. Isso NAO e defeito do sistema; e um cadastro em branco, e esta
  // apontado no relatorio.
  //
  // Aqui os valores sao de AMOSTRA, so para o relatorio ter o que somar.
  // ------------------------------------------------------------------
  for (const p of CATALOGO_PADRAO) {
    const valor = p.code === 'consulta_ocupacional' ? 45 : p.default_fee;
    await c.db.exec(`
      insert into public.procedure_types
        (tenant_id, code, name, default_fee, sort_order, emite_ficha_clinica)
      values ('${c.tenant}', '${p.code}', '${p.name.replace(/'/g, "''")}',
              ${valor}, ${p.sort_order}, ${p.emite_ficha_clinica})
      on conflict (tenant_id, code) do update
         set default_fee = excluded.default_fee,
             emite_ficha_clinica = excluded.emite_ficha_clinica`);
  }

  // Dois medicos com valor proprio negociado, dois no valor de tabela: e
  // assim que a clinica trabalha, e o relatorio precisa mostrar a diferenca.
  for (const [medico, fator] of [
    [medicos[0]!, 1.2],
    [medicos[1]!, 0.9],
  ] as const) {
    await c.db.exec(`
      insert into public.medical_fees (tenant_id, profile_id, procedure_type_id, fee)
      select '${c.tenant}', '${medico.id}', pt.id, round(pt.default_fee * ${fator}, 2)
        from public.procedure_types pt
       where pt.tenant_id = '${c.tenant}' and pt.default_fee > 0`);
  }

  const catalogo = await lerCatalogo(c);
  const perfis = gerarPerfis(
    QUANTOS,
    empresas.map((e) => e.id),
    // Semente diferente da varredura anterior: sao cem pacientes NOVOS.
    20260930,
  );

  for (let i = 0; i < perfis.length; i++) {
    percursos.push(await passarPeloSistema(c, equipes[i % equipes.length]!, perfis[i]!, catalogo));
  }
}, 1_800_000);

afterAll(async () => {
  await c?.fechar();
});

describe('a varredura de cem pacientes', () => {
  it('nenhuma ação foi recusada', () => {
    const falhas = percursos.flatMap((p) =>
      p.falhas.map(
        (f) => `${p.perfil.nome} (${p.perfil.porque}) -> ${f.acao}: ${f.erro}`,
      ),
    );
    expect(falhas).toEqual([]);
  });

  it('ninguém ficou preso e nenhuma sala ficou ocupada', async () => {
    const presos = await c.linhas<{ nome: string; stage_code: string }>(`
      select p.full_name as nome, a.stage_code from public.attendances a
        join public.patients p on p.id = a.patient_id
       where a.tenant_id = '${c.tenant}'
         and a.stage_code not in ('finalizado','cancelado','ausente')`);
    const salas = await c.linhas<{ name: string }>(`
      select name from public.rooms
       where tenant_id = '${c.tenant}' and current_attendance_id is not null`);
    expect({ presos, salas }).toEqual({ presos: [], salas: [] });
  });

  it('cada médico recebeu o valor da tabela dele, e não o da clínica', async () => {
    // Dois medicos tem valor proprio cadastrado e dois nao. Se o sistema
    // ignorasse `medical_fees`, os quatro receberiam igual -- e ninguem
    // perceberia ate o fim do mes.
    const fora = await c.linhas<{ medico: string; lancado: string; esperado: string }>(`
      select pr.full_name as medico, fe.fee::text as lancado,
             coalesce(mf.fee, pt.default_fee)::text as esperado
        from public.fee_entries fe
        join public.profiles pr on pr.id = fe.profile_id
        join public.procedure_types pt
          on pt.tenant_id = fe.tenant_id and pt.code = fe.procedure_code
        left join public.medical_fees mf
          on mf.procedure_type_id = pt.id and mf.profile_id = fe.profile_id
       where fe.tenant_id = '${c.tenant}'
         and fe.fee is distinct from coalesce(mf.fee, pt.default_fee)`);
    expect(
      fora.map((f) => `${f.medico}: lançou ${f.lancado}, tabela dele diz ${f.esperado}`),
    ).toEqual([]);
  });

  it('toda consulta assinada gerou repasse', async () => {
    const sem = await c.linhas<{ nome: string }>(`
      select p.full_name as nome
        from public.medical_consultations mc
        join public.patients p on p.id = mc.patient_id
        join public.attendances a on a.id = mc.attendance_id
        join public.procedure_types pt
          on pt.tenant_id = mc.tenant_id
         and pt.code = coalesce(a.procedure_code, 'consulta_ocupacional')
       where mc.tenant_id = '${c.tenant}' and mc.finished_at is not null
         and pt.default_fee > 0
         and not exists (select 1 from public.fee_entries fe
                          where fe.attendance_id = mc.attendance_id
                            and fe.profile_id = mc.doctor_id)`);
    expect(sem).toEqual([]);
  });

  it('todo documento gravado tem arquivo de verdade por trás', async () => {
    // Um documento no banco apontando para um arquivo que nao existe e o
    // pior tipo de "deu certo": a clinica so descobre ao clicar.
    const docs = await c.linhas<{ id: string; kind: string; file_path: string | null }>(
      `select id, kind, file_path from public.documents where tenant_id = '${c.tenant}'`,
    );
    const arquivos = arquivosDoStorage();
    const semArquivo = docs.filter(
      (d) => !d.file_path || !arquivos.has(`clinical-documents/${d.file_path}`),
    );
    expect(semArquivo.map((d) => `${d.kind}: ${d.file_path ?? 'sem caminho'}`)).toEqual([]);
  });
});

describe('os documentos e os relatórios saem para a pasta', () => {
  it('grava tudo em "documentos teste sistema"', async () => {
    rmSync(PASTA, { recursive: true, force: true });
    mkdirSync(join(PASTA, 'documentos por paciente'), { recursive: true });
    mkdirSync(join(PASTA, 'relatorios de pagamento'), { recursive: true });

    const arquivos = arquivosDoStorage();

    // ------------------------------------------------------------------
    // Um subdiretorio por paciente, com o nome do documento em portugues.
    // ------------------------------------------------------------------
    const docs = await c.linhas<{
      paciente: string;
      atendimento: string;
      kind: string;
      title: string;
      file_path: string | null;
      verification_code: string | null;
      signer_name: string | null;
    }>(`
      select p.full_name as paciente, d.attendance_id::text as atendimento,
             d.kind, d.title, d.file_path, d.verification_code, d.signer_name
        from public.documents d
        join public.patients p on p.id = d.patient_id
       where d.tenant_id = '${c.tenant}' and d.file_path is not null
       order by p.full_name, d.kind`);

    let gravados = 0;
    const porPaciente = new Map<string, number>();

    for (const doc of docs) {
      const bytes = arquivos.get(`clinical-documents/${doc.file_path}`);
      if (!bytes) continue;

      const pasta = join(PASTA, 'documentos por paciente', nomeDeArquivo(doc.paciente));
      mkdirSync(pasta, { recursive: true });

      const n = (porPaciente.get(doc.paciente) ?? 0) + 1;
      porPaciente.set(doc.paciente, n);

      writeFileSync(join(pasta, `${String(n).padStart(2, '0')}-${nomeDeArquivo(doc.title)}.pdf`), bytes);
      gravados++;
    }

    expect(gravados).toBeGreaterThan(0);

    // ------------------------------------------------------------------
    // Relatorio de pagamento dos medicos: um por medico, mais o consolidado.
    // ------------------------------------------------------------------
    const lancamentos = await c.linhas<LancamentoRepasse & { competencia: string }>(`
      select fe.profile_id::text as profile_id,
             pr.full_name as medico,
             fe.procedure_name,
             fe.fee::text as fee,
             fe.status,
             to_char(fe.competencia, 'YYYY-MM-DD') as competencia
        from public.fee_entries fe
        join public.profiles pr on pr.id = fe.profile_id
       where fe.tenant_id = '${c.tenant}'`);

    const resumos = agruparPorMedico(lancamentos);
    expect(resumos.length).toBeGreaterThan(0);

    const clinica = await c.um<{ nome: string; cnpj: string | null }>(
      `select trade_name as nome, document as cnpj from public.tenants where id = '${c.tenant}'`,
    );

    for (const resumo of resumos) {
      const pdf = await construirRelatorioDeRepasse({
        clinica: clinica?.nome ?? 'Clínica',
        titulo: `Repasse — ${resumo.medico}`,
        subtitulo: `${resumo.atendimentos} atendimento(s) · gerado a partir de ${QUANTOS} pacientes de teste`,
        resumos: [resumo],
      });
      writeFileSync(
        join(PASTA, 'relatorios de pagamento', `repasse-${nomeDeArquivo(resumo.medico)}.pdf`),
        pdf,
      );
    }

    const consolidado = await construirRelatorioDeRepasse({
      clinica: clinica?.nome ?? 'Clínica',
      titulo: 'Repasse médico — consolidado',
      subtitulo: `${resumos.length} médico(s) · ${QUANTOS} pacientes de teste`,
      resumos,
    });
    writeFileSync(join(PASTA, 'relatorios de pagamento', '00-consolidado.pdf'), consolidado);

    // ------------------------------------------------------------------
    // Planilha de conferencia: quem e quem, e quanto cada um rendeu.
    // ------------------------------------------------------------------
    const linhas = await c.linhas<{
      paciente: string;
      nascimento: string | null;
      empresa: string | null;
      procedencia: string | null;
      etapa: string;
      exames: string | null;
      medico: string | null;
      parecer: string | null;
      cobrado: string | null;
      repasse: string | null;
      documentos: number;
    }>(`
      select p.full_name as paciente,
             to_char(p.birth_date, 'DD/MM/YYYY') as nascimento,
             co.legal_name as empresa,
             coalesce(a.origin_kind::text, 'particular') as procedencia,
             a.stage_code as etapa,
             (select string_agg(et.code, '+' order by et.code)
                from public.patient_exams pe
                join public.exam_types et on et.id = pe.exam_type_id
               where pe.attendance_id = a.id) as exames,
             pr.full_name as medico,
             mc.verdict::text as parecer,
             (select sum(pg.net_amount)::text from public.payments pg
               where pg.attendance_id = a.id and pg.status <> 'cancelado') as cobrado,
             (select sum(fe.fee)::text from public.fee_entries fe
               where fe.attendance_id = a.id) as repasse,
             (select count(*)::int from public.documents d where d.attendance_id = a.id) as documentos
        from public.attendances a
        join public.patients p on p.id = a.patient_id
        left join public.companies co on co.id = a.company_id
        left join public.medical_consultations mc on mc.attendance_id = a.id
        left join public.profiles pr on pr.id = mc.doctor_id
       where a.tenant_id = '${c.tenant}'
       order by p.full_name`);

    const csv = [
      'Paciente;Nascimento;Empresa;Procedencia;Etapa final;Exames;Medico;Parecer;Cobrado;Repasse;Documentos',
      ...linhas.map((l) =>
        [
          l.paciente,
          l.nascimento ?? '',
          l.empresa ?? 'particular',
          l.procedencia ?? '',
          l.etapa,
          l.exames ?? 'sem exame',
          l.medico ?? '',
          l.parecer ?? '',
          l.cobrado ?? '0',
          l.repasse ?? '0',
          String(l.documentos),
        ]
          .map((x) => String(x).replace(/;/g, ','))
          .join(';'),
      ),
    ].join('\r\n');

    // BOM para o Excel abrir com acento certo.
    writeFileSync(join(PASTA, 'planilha-dos-100-pacientes.csv'), '﻿' + csv, 'utf8');

    // ------------------------------------------------------------------
    // Um LEIA-ME que explica o que e cada coisa.
    // ------------------------------------------------------------------
    const totalRepasse = resumos.reduce((s, r) => s + r.total, 0);
    const totalCobrado = linhas.reduce((s, l) => s + Number(l.cobrado ?? 0), 0);

    writeFileSync(
      join(PASTA, 'LEIA-ME.txt'),
      [
        'DOCUMENTOS DE TESTE DO SISTEMA — H2 Medicina Ocupacional',
        '',
        `Gerado em ${new Date().toLocaleString('pt-BR')}.`,
        '',
        'ATENÇÃO: todos os pacientes, empresas e médicos aqui são FICTÍCIOS.',
        'Nenhum dado real da clínica foi usado. Os documentos são válidos como',
        'amostra do que o sistema produz, e não valem para nenhuma finalidade',
        'legal ou trabalhista.',
        '',
        '--------------------------------------------------------------------',
        'O QUE TEM AQUI',
        '--------------------------------------------------------------------',
        '',
        'documentos por paciente/',
        '   Uma pasta por paciente, com os PDFs que o sistema emitiu para ele:',
        '   A.S.O., ficha clínica, laudos de exame, guia de exame, comprovantes',
        '   e recibo. São os mesmos arquivos que a clínica recebe — gerados pelo',
        '   mesmo código, a partir de atendimentos que passaram pela recepção,',
        '   triagem, salas, consultório e caixa.',
        '',
        'relatorios de pagamento/',
        '   00-consolidado.pdf   — todos os médicos numa folha só.',
        '   repasse-<medico>.pdf — um por médico, com o detalhe por procedimento.',
        '',
        'planilha-dos-100-pacientes.csv',
        '   Abre no Excel. Uma linha por paciente: exames marcados, procedência,',
        '   médico que atendeu, parecer, quanto foi cobrado, quanto virou repasse',
        '   e quantos documentos saíram. Serve para conferir o conjunto de uma vez.',
        '',
        '--------------------------------------------------------------------',
        'O DIA EM NÚMEROS',
        '--------------------------------------------------------------------',
        '',
        `Pacientes:            ${QUANTOS}`,
        `Documentos emitidos:  ${gravados}`,
        `Médicos com repasse:  ${resumos.length}`,
        `Total cobrado:        R$ ${totalCobrado.toFixed(2).replace('.', ',')}`,
        `Total de repasse:     R$ ${totalRepasse.toFixed(2).replace('.', ',')}`,
        '',
        'Os pacientes incluem, de propósito, os casos difíceis: quem desiste no',
        'meio do atendimento, quem falta a um exame, quem não tem data de',
        'nascimento, quem tem seis exames em cinco salas, perícia, SISPER,',
        'ingresso escolar e convênio com valor negociado.',
        '',
      ].join('\r\n'),
      'utf8',
    );

    console.log(`\nPasta: ${PASTA}`);
    console.log(`Documentos gravados: ${gravados} de ${docs.length}`);
    console.log(`Relatórios de repasse: ${resumos.length + 1}`);
  });
});
