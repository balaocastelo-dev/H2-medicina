/**
 * Um dia inteiro de clinica, com centenas de pacientes, pelas acoes reais.
 *
 * Cada paciente atravessa recepcao, triagem, salas, consultorio, documentos
 * e caixa chamando as mesmas funcoes que a tela chama, com o papel de quem
 * faz aquilo na clinica. Depois, o dia fechado e conferido por invariantes
 * -- afirmacoes que precisam valer para TODO mundo, nao para o caso feliz.
 *
 * A diferenca para o pente fino de 21/09 e o que esta sendo exercitado. La
 * o teste escrevia SQL para simular as telas; aqui ele usa as telas. Os
 * defeitos da ultima semana estavam todos no meio do caminho.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { montarClinica, type Clinica } from './clinica';
import { lerCatalogo, passarPeloSistema, type Equipe, type Percurso } from './percurso';
import { gerarPerfis } from './perfis';

/** Quantos pacientes passam pelo dia. */
const QUANTOS = Number(process.env.PACIENTES ?? 120);

let c: Clinica;
let equipe: Equipe;
let percursos: Percurso[] = [];
let empresas: { id: string; nome: string }[] = [];

beforeAll(async () => {
  c = await montarClinica();

  equipe = {
    recepcao: await c.criarPessoa('Recepção do dia', 'recepcao@dia.teste', 'atendimento'),
    triagista: await c.criarPessoa('Triagem do dia', 'triagem@dia.teste', 'medico_examinador'),
    examinador: await c.criarPessoa('Examinador do dia', 'exame@dia.teste', 'medico_examinador'),
    medico: await c.criarPessoa('Dr. do dia', 'medico@dia.teste', 'medico_examinador'),
  };

  // Duas empresas: uma com tabela propria de precos, outra sem. O preco por
  // empresa foi reclamado em 29/09 e precisa de as duas para ser provado.
  for (const [nome, doc] of [
    ['Metalurgica Aurora Ltda', '11222333000181'],
    // Os dois CNPJ tem digito verificador correto: o banco recusa invalido,
    // e com razao — foi assim que o teste descobriu que estava inventando.
    ['Transportes Boa Vista SA', '44555666000181'],
  ] as const) {
    const e = await c.um<{ id: string }>(`
      insert into public.companies (tenant_id, legal_name, document)
      values ('${c.tenant}', '${nome}', '${doc}') returning id`);
    empresas.push({ id: e.id, nome });
  }

  // A primeira empresa tem preco proprio para a audiometria: metade da
  // tabela. A segunda nao tem nenhum, e deve usar o preco de tabela.
  await c.db.exec(`
    insert into public.company_exam_prices (tenant_id, company_id, exam_type_id, price)
    select '${c.tenant}', '${empresas[0]!.id}', et.id, round(et.price / 2, 2)
      from public.exam_types et
     where et.tenant_id = '${c.tenant}' and et.code = 'AUDIO'`);

  const catalogo = await lerCatalogo(c);
  const perfis = gerarPerfis(
    QUANTOS,
    empresas.map((e) => e.id),
  );

  for (const perfil of perfis) {
    percursos.push(await passarPeloSistema(c, equipe, perfil, catalogo));
  }

  // O rastro completo fica em disco: quando uma invariante falha, o
  // diagnostico comeca por aqui e nao por adivinhacao.
  try {
    writeFileSync(
      'tests/sistema/ultimo-dia.json',
      JSON.stringify({ quantos: QUANTOS, percursos }, null, 1),
    );
  } catch {
    // Gravar o rastro e conveniencia, nao requisito do teste.
  }
}, 900_000);

afterAll(async () => {
  await c?.fechar();
});

/* ================================================================== */
/* 1. Nenhuma ação foi recusada                                        */
/* ================================================================== */

describe('1. o sistema aceitou tudo que a clínica mandou', () => {
  it('nenhum passo falhou em nenhum paciente', () => {
    const falhas = percursos.flatMap((p) =>
      p.falhas.map(
        (f) =>
          `${p.perfil.nome} (${p.perfil.porque}) -> ${f.acao}` +
          `${f.detalhe ? ` [${f.detalhe}]` : ''}: ${f.erro}`,
      ),
    );
    // Uma linha por defeito, com o paciente e o porque dele: a mensagem da
    // falha JA e o relatorio.
    expect(falhas).toEqual([]);
  });

  it('nenhuma ação escondeu falha dentro de uma mensagem de sucesso', () => {
    // "Consulta finalizada. (nao consegui gerar o A.S.O.)" respondia `ok`.
    // Um teste que so olha o `ok` da verde sobre documento que nao existe.
    //
    // A unica excecao e o A.S.O. de quem nunca passou por medico: sem
    // parecer de aptidao o documento nao pode existir, e a mensagem esta
    // certa. Essa situacao tem afirmacao propria logo abaixo.
    const semConsulta = /A\.S\.O\..*parecer de aptidão/;

    const suspeitas = percursos.flatMap((p) =>
      p.passos
        .filter(
          (s) =>
            s.mensagem &&
            /não saiu|nao saiu|falhou|falharam|não consegui|nao consegui|erro/i.test(s.mensagem) &&
            !(semConsulta.test(s.mensagem) && !p.perfil.exames.includes('CLINICO')),
        )
        .map((s) => `${p.perfil.nome} -> ${s.acao}: ${s.mensagem}`),
    );
    expect(suspeitas).toEqual([]);
  });

  it('quem passou pelo médico não recebe recusa de A.S.O. por falta de parecer', () => {
    // O defeito de 29/09: a recepcao nao enxerga a consulta, concluia "nao
    // ha parecer" e o kit acusava o medico de nao ter preenchido uma
    // consulta que ele tinha assinado.
    const acusados = percursos.flatMap((p) =>
      p.passos
        .filter(
          (s) =>
            p.perfil.exames.includes('CLINICO') &&
            s.mensagem &&
            /A\.S\.O\..*parecer de aptidão/.test(s.mensagem),
        )
        .map((s) => `${p.perfil.nome} -> ${s.acao}: ${s.mensagem}`),
    );
    expect(acusados).toEqual([]);
  });
});

/* ================================================================== */
/* 2. Ninguém fica preso                                               */
/* ================================================================== */

describe('2. ninguém ficou preso em lugar nenhum', () => {
  it('nenhum atendimento ficou no meio do caminho', async () => {
    const presos = await c.linhas<{ nome: string; stage_code: string }>(`
      select p.full_name as nome, a.stage_code
        from public.attendances a join public.patients p on p.id = a.patient_id
       where a.tenant_id = '${c.tenant}'
         and a.stage_code not in ('finalizado','cancelado','ausente')`);
    expect(presos).toEqual([]);
  });

  it('nenhuma sala ficou ocupada', async () => {
    const ocupadas = await c.linhas<{ name: string; status: string }>(`
      select name, status from public.rooms
       where tenant_id = '${c.tenant}'
         and (current_attendance_id is not null or status = 'ocupada')`);
    expect(ocupadas).toEqual([]);
  });

  it('ninguém ficou marcado como em atendimento', async () => {
    const emServico = await c.linhas<{ nome: string }>(`
      select p.full_name as nome from public.attendances a
        join public.patients p on p.id = a.patient_id
       where a.tenant_id = '${c.tenant}' and a.in_service`);
    expect(emServico).toEqual([]);
  });

  it('nenhum exame ficou pendente em atendimento encerrado', async () => {
    const abertos = await c.linhas<{ nome: string; code: string; status: string }>(`
      select p.full_name as nome, et.code, pe.status
        from public.patient_exams pe
        join public.attendances a on a.id = pe.attendance_id
        join public.patients p on p.id = pe.patient_id
        join public.exam_types et on et.id = pe.exam_type_id
       where a.tenant_id = '${c.tenant}'
         and a.stage_code = 'finalizado'
         and pe.status not in ('concluido','cancelado','nao_realizado')`);
    expect(abertos.map((a) => `${a.nome}: ${a.code} ficou ${a.status}`)).toEqual([]);
  });

  it('ninguém foi chamado em duas salas ao mesmo tempo', async () => {
    const duplos = await c.linhas<{ nome: string; salas: number }>(`
      select p.full_name as nome, count(distinct pe.room_id)::int as salas
        from public.patient_exams pe
        join public.patients p on p.id = pe.patient_id
       where pe.tenant_id = '${c.tenant}' and pe.status in ('chamado','em_andamento')
       group by p.full_name having count(distinct pe.room_id) > 1`);
    expect(duplos).toEqual([]);
  });
});

/* ================================================================== */
/* 3. O dinheiro fecha                                                 */
/* ================================================================== */

describe('3. o dinheiro fecha', () => {
  it('todo atendimento finalizado com valor a cobrar tem cobrança', async () => {
    // "Com exame" nao basta: Raio X e coleta podem nao ter preco de tabela,
    // e o Estado, o SISPER e o ingresso sao custeados pelo orgao de origem.
    // Cobrar zero nao e cobranca; o que seria defeito e ter valor a cobrar
    // e nenhum lancamento.
    const semCobranca = await c.linhas<{ nome: string; valor: string }>(`
      select p.full_name as nome, sum(coalesce(cep.price, et.price, 0))::text as valor
        from public.attendances a
        join public.patients p on p.id = a.patient_id
        join public.patient_exams pe on pe.attendance_id = a.id
        join public.exam_types et on et.id = pe.exam_type_id
        left join public.company_exam_prices cep
               on cep.company_id = a.company_id and cep.exam_type_id = et.id
              and cep.contract_id is null
       where a.tenant_id = '${c.tenant}' and a.stage_code = 'finalizado'
         and coalesce(a.origin_kind::text, 'particular') = 'particular'
         and not exists (select 1 from public.payments pg where pg.attendance_id = a.id)
       group by a.id, p.full_name
      having sum(coalesce(cep.price, et.price, 0)) > 0`);
    expect(semCobranca.map((x) => `${x.nome}: ${x.valor} a cobrar e nenhuma cobrança`)).toEqual([]);
  });

  it('atendimento cancelado não gerou cobrança paga', async () => {
    const cobrados = await c.linhas<{ nome: string }>(`
      select p.full_name as nome
        from public.attendances a
        join public.patients p on p.id = a.patient_id
        join public.payments pg on pg.attendance_id = a.id
       where a.tenant_id = '${c.tenant}' and a.stage_code = 'cancelado' and pg.status = 'pago'`);
    expect(cobrados).toEqual([]);
  });

  it('nenhuma cobrança ficou negativa', async () => {
    const negativas = await c.linhas<{ id: string; net_amount: string }>(`
      select id, net_amount::text from public.payments
       where tenant_id = '${c.tenant}' and net_amount < 0`);
    expect(negativas).toEqual([]);
  });

  it('o valor cobrado é o valor negociado da empresa, não o de tabela', async () => {
    // "os valores de cada atendimento de paciente nao estao de acordo com
    //  os cadastrados na aba empresa" -- Isabella, 29/09.
    //
    // A cobranca guarda o total, nao uma linha por exame. Entao o total e
    // recalculado aqui pela regra que a clinica descreveu -- preco da
    // empresa quando existe, preco de tabela quando nao -- e comparado com
    // o que o sistema cobrou. Se o sistema ignorar a tabela da empresa, a
    // diferenca aparece exatamente nos pacientes dela.
    const divergentes = await c.linhas<{
      nome: string;
      empresa: string;
      cobrado: string;
      esperado: string;
    }>(`
      with esperado as (
        select a.id as attendance_id,
               co.legal_name as empresa,
               sum(coalesce(cep.price, et.price, 0)) as valor
          from public.attendances a
          join public.companies co on co.id = a.company_id
          join public.patient_exams pe on pe.attendance_id = a.id
          join public.exam_types et on et.id = pe.exam_type_id
          left join public.company_exam_prices cep
                 on cep.company_id = a.company_id
                and cep.exam_type_id = et.id
                and cep.contract_id is null
         where a.tenant_id = '${c.tenant}'
         group by a.id, co.legal_name
      )
      select p.full_name as nome, e.empresa,
             pg.net_amount::text as cobrado, e.valor::text as esperado
        from esperado e
        join public.payments pg on pg.attendance_id = e.attendance_id
        join public.attendances a on a.id = e.attendance_id
        join public.patients p on p.id = a.patient_id
       where pg.status <> 'cancelado'
         and pg.net_amount is distinct from e.valor`);

    expect(
      divergentes.map(
        (d) => `${d.nome} (${d.empresa}): cobrado ${d.cobrado}, negociado ${d.esperado}`,
      ),
    ).toEqual([]);
  });

  it('a empresa com desconto pagou menos que a sem desconto', async () => {
    // Uma conferencia grosseira de proposito: se o valor negociado deixasse
    // de ser aplicado, os dois grupos passariam a pagar igual e a
    // comparacao acima poderia passar por coincidencia de arredondamento.
    const r = await c.um<{ com_desconto: string | null; sem_desconto: string | null }>(`
      select
        (select avg(pg.net_amount)::text from public.payments pg
           join public.attendances a on a.id = pg.attendance_id
           join public.patient_exams pe on pe.attendance_id = a.id
           join public.exam_types et on et.id = pe.exam_type_id
          where a.company_id = '${empresas[0]!.id}' and et.code = 'AUDIO'
            and pg.status <> 'cancelado') as com_desconto,
        (select avg(pg.net_amount)::text from public.payments pg
           join public.attendances a on a.id = pg.attendance_id
           join public.patient_exams pe on pe.attendance_id = a.id
           join public.exam_types et on et.id = pe.exam_type_id
          where a.company_id = '${empresas[1]!.id}' and et.code = 'AUDIO'
            and pg.status <> 'cancelado') as sem_desconto`);

    if (r.com_desconto === null || r.sem_desconto === null) {
      // O lote sorteado nao produziu os dois grupos: nada a comparar.
      return;
    }
    expect(Number(r.com_desconto)).toBeLessThan(Number(r.sem_desconto));
  });
});

/* ================================================================== */
/* 4. O repasse do médico                                              */
/* ================================================================== */

describe('4. o repasse do médico', () => {
  it('toda consulta assinada gerou lançamento para quem assinou', async () => {
    // Ate 29/09 nenhuma gerava: a gravacao era barrada pelo RLS em silencio.
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

  it('nenhum repasse aponta para quem não assinou a consulta', async () => {
    const trocados = await c.linhas<{ id: string }>(`
      select fe.id from public.fee_entries fe
        join public.medical_consultations mc on mc.attendance_id = fe.attendance_id
       where fe.tenant_id = '${c.tenant}' and mc.doctor_id is not null
         and fe.profile_id is distinct from mc.doctor_id`);
    expect(trocados).toEqual([]);
  });

  it('nenhum repasse duplicado para o mesmo atendimento', async () => {
    const dobrados = await c.linhas<{ attendance_id: string; quantos: number }>(`
      select attendance_id, count(*)::int as quantos from public.fee_entries
       where tenant_id = '${c.tenant}'
       group by attendance_id having count(*) > 1`);
    expect(dobrados).toEqual([]);
  });
});

/* ================================================================== */
/* 5. Os documentos                                                    */
/* ================================================================== */

describe('5. os documentos', () => {
  it('todo particular com parecer tem A.S.O.', async () => {
    const sem = await c.linhas<{ nome: string }>(`
      select p.full_name as nome
        from public.attendances a
        join public.patients p on p.id = a.patient_id
        join public.medical_consultations mc on mc.attendance_id = a.id
       where a.tenant_id = '${c.tenant}'
         and coalesce(a.origin_kind::text, 'particular') = 'particular'
         and a.stage_code = 'finalizado'
         and mc.verdict is not null
         and not exists (select 1 from public.documents d
                          where d.attendance_id = a.id and d.kind = 'aso'
                            and d.deleted_at is null)`);
    expect(sem).toEqual([]);
  });

  it('nenhum atendimento tem dois A.S.O.', async () => {
    // Dois A.S.O. validos para o mesmo exame, com codigos de verificacao
    // diferentes, e pior que nenhum.
    const dobrados = await c.linhas<{ attendance_id: string; quantos: number }>(`
      select attendance_id, count(*)::int as quantos from public.documents
       where tenant_id = '${c.tenant}' and kind = 'aso' and deleted_at is null
       group by attendance_id having count(*) > 1`);
    expect(dobrados).toEqual([]);
  });

  it('todo documento visível ao paciente diz de quem é', async () => {
    const orfaos = await c.linhas<{ id: string; kind: string }>(`
      select id, kind from public.documents
       where tenant_id = '${c.tenant}' and is_patient_visible and patient_id is null`);
    expect(orfaos).toEqual([]);
  });

  it('nenhum código de verificação se repete', async () => {
    const repetidos = await c.linhas<{ verification_code: string; quantos: number }>(`
      select verification_code, count(*)::int as quantos from public.documents
       where tenant_id = '${c.tenant}' and verification_code is not null
       group by verification_code having count(*) > 1`);
    expect(repetidos).toEqual([]);
  });

  it('todo exame concluído com ficha virou laudo', async () => {
    const semLaudo = await c.linhas<{ nome: string; code: string }>(`
      select p.full_name as nome, et.code
        from public.patient_exams pe
        join public.patients p on p.id = pe.patient_id
        join public.exam_types et on et.id = pe.exam_type_id
        join public.attendances a on a.id = pe.attendance_id
       where pe.tenant_id = '${c.tenant}' and pe.status = 'concluido'
         and a.stage_code = 'finalizado'
         -- CLINICO e PSICO sao respondidos dentro do formulario da consulta
         -- e tem documento proprio (ficha clinica e avaliacao psicossocial);
         -- os de fora da clinica e os que vem laudados do aparelho nao tem
         -- ficha para virar laudo.
         and et.code not in ('CLINICO','PSICO','RAIOX','LAB','EEG','ECG','ESPIRO')
         and not exists (
           select 1 from public.documents d
            where d.attendance_id = pe.attendance_id and d.kind = 'resultado_exame'
              and d.payload->>'patient_exam_id' = pe.id::text)`);
    expect(semLaudo).toEqual([]);
  });
});

/* ================================================================== */
/* 6. As filas e o painel                                              */
/* ================================================================== */

describe('6. as filas e o painel', () => {
  it('toda chamada de sala foi ao painel com senha', async () => {
    const semSenha = await c.linhas<{ id: string }>(`
      select id from public.tv_calls
       where tenant_id = '${c.tenant}' and (ticket_code is null or ticket_code = '')`);
    expect(semSenha).toEqual([]);
  });

  it('nenhuma senha do dia se repete', async () => {
    const repetidas = await c.linhas<{ code: string; quantos: number }>(`
      select code, count(*)::int as quantos from public.queue_tickets
       where tenant_id = '${c.tenant}'
       group by code having count(*) > 1`);
    expect(repetidas).toEqual([]);
  });

  it('todo exame concluído registrou em que sala aconteceu', async () => {
    const semSala = await c.linhas<{ code: string; quantos: number }>(`
      select et.code, count(*)::int as quantos
        from public.patient_exams pe
        join public.exam_types et on et.id = pe.exam_type_id
       where pe.tenant_id = '${c.tenant}' and pe.status = 'concluido'
         and et.ocupa_sala and pe.room_id is null
       group by et.code`);
    expect(semSala).toEqual([]);
  });

  it('nenhum exame terminou antes de ser chamado', async () => {
    const invertidos = await c.linhas<{ id: string }>(`
      select id from public.patient_exams
       where tenant_id = '${c.tenant}' and called_at is not null and finished_at is not null
         and finished_at < called_at`);
    expect(invertidos).toEqual([]);
  });
});

/* ================================================================== */
/* 7. Integridade                                                      */
/* ================================================================== */

describe('7. integridade do que ficou gravado', () => {
  it('todo exame pertence ao paciente do atendimento', async () => {
    const trocados = await c.linhas<{ id: string }>(`
      select pe.id from public.patient_exams pe
        join public.attendances a on a.id = pe.attendance_id
       where pe.tenant_id = '${c.tenant}' and pe.patient_id is distinct from a.patient_id`);
    expect(trocados).toEqual([]);
  });

  it('toda consulta pertence ao paciente do atendimento', async () => {
    const trocadas = await c.linhas<{ id: string }>(`
      select mc.id from public.medical_consultations mc
        join public.attendances a on a.id = mc.attendance_id
       where mc.tenant_id = '${c.tenant}' and mc.patient_id is distinct from a.patient_id`);
    expect(trocadas).toEqual([]);
  });

  it('nenhum registro do dia ficou sem clínica', async () => {
    const orfaos = await c.linhas<{ tabela: string; quantos: number }>(`
      select 'patient_exams' as tabela, count(*)::int as quantos from public.patient_exams where tenant_id is null
      union all select 'attendances', count(*)::int from public.attendances where tenant_id is null
      union all select 'documents', count(*)::int from public.documents where tenant_id is null
      union all select 'payments', count(*)::int from public.payments where tenant_id is null`);
    expect(orfaos.filter((o) => o.quantos > 0)).toEqual([]);
  });

  it('nenhum atendimento terminou antes de começar', async () => {
    const invertidos = await c.linhas<{ id: string }>(`
      select id from public.attendances
       where tenant_id = '${c.tenant}' and finished_at is not null and finished_at < checkin_at`);
    expect(invertidos).toEqual([]);
  });

  it('o RLS continua ligado e forçado em todas as tabelas', async () => {
    const soltas = await c.linhas<{ tabela: string }>(`
      select c.relname as tabela from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
         and (not c.relrowsecurity or not c.relforcerowsecurity)`);
    expect(soltas).toEqual([]);
  });
});

/* ================================================================== */
/* 8. O dia em números                                                 */
/* ================================================================== */

describe('8. o dia em números', () => {
  it('todos os pacientes do lote existem e passaram', async () => {
    const criados = percursos.filter((p) => p.pacienteId).length;
    expect(criados).toBe(QUANTOS);

    const atendimentos = await c.um<{ total: number }>(
      `select count(*)::int as total from public.attendances where tenant_id = '${c.tenant}'`,
    );
    expect(atendimentos.total).toBe(QUANTOS);
  });

  it('os cancelados são exatamente os que desistiram', async () => {
    const esperados = percursos.filter((p) => p.perfil.desiste).length;
    const cancelados = await c.um<{ total: number }>(
      `select count(*)::int as total from public.attendances
        where tenant_id = '${c.tenant}' and stage_code = 'cancelado'`,
    );
    expect(cancelados.total).toBe(esperados);
  });
});
