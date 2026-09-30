/**
 * Todas as rotas do sistema, uma por paciente.
 *
 * Nao sao cinquenta pacientes: sao cinquenta e dois CAMINHOS distintos,
 * cada um escolhido porque exercita um ponto onde o sistema pode errar. O
 * mapa que originou a lista esta em `docs/o-que-se-espera-do-sistema.md`;
 * as rotas, com o que se espera de cada uma, em `rotas.ts`.
 *
 * A diferenca para as varreduras anteriores e o que esta sendo exercitado.
 * Ate aqui os pacientes percorriam o caminho feliz com variacoes de dados.
 * Aqui entram as ROTAS DE EXCECAO -- repetir chamada, devolver exame para a
 * fila, remanejar sala, salvar rascunho e finalizar depois, cobrar duas
 * vezes, voltar o cartao no CRM, marcar ausente, anexar laudo depois. Sao
 * elas que quase nunca se testa, e e onde os defeitos moram.
 *
 * Cada rota declara o que precisa ser verdade no fim. A afirmacao que falha
 * ja diz qual rota, por que ela existe e o que era esperado.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { montarClinica, type Clinica, type Pessoa } from './clinica';
import { lerCatalogo, passarPeloSistema, type Equipe, type Percurso } from './percurso';
import { todasAsRotas, type Rota } from './rotas';
import { CATALOGO_PADRAO } from '@/modules/finance/repasse';

let c: Clinica;
let equipes: Equipe[] = [];
let rotas: Rota[] = [];
let resultados: { rota: Rota; percurso: Percurso }[] = [];
let empresas: string[] = [];

beforeAll(async () => {
  c = await montarClinica();

  const recepcao = await c.criarPessoa('Recepção', 'recepcao@rotas.teste', 'atendimento');
  const triagista = await c.criarPessoa('Triagem', 'triagem@rotas.teste', 'medico_examinador');
  const examinador = await c.criarPessoa('Examinador', 'exames@rotas.teste', 'medico_examinador');

  // Tres medicos em rodizio: o repasse precisa se dividir de verdade.
  for (const nome of ['Dra. Wania', 'Dr. Antônio', 'Dra. Helena']) {
    const m = await c.criarPessoa(
      nome,
      `${nome.replace(/[^a-zA-Z]/g, '').toLowerCase()}@rotas.teste`,
      'medico_examinador',
    );
    equipes.push({ recepcao, triagista, examinador, medico: m });
  }

  // O catalogo real de procedimentos, com a consulta ocupacional recebendo
  // um valor de amostra -- no cadastro da clinica ela esta em R$ 0,00.
  for (const p of CATALOGO_PADRAO) {
    await c.db.exec(`
      insert into public.procedure_types
        (tenant_id, code, name, default_fee, sort_order, emite_ficha_clinica)
      values ('${c.tenant}', '${p.code}', '${p.name.replace(/'/g, "''")}',
              ${p.code === 'consulta_ocupacional' ? 45 : p.default_fee},
              ${p.sort_order}, ${p.emite_ficha_clinica})
      on conflict (tenant_id, code) do update
         set default_fee = excluded.default_fee,
             emite_ficha_clinica = excluded.emite_ficha_clinica`);
  }

  // Uma empresa com valor negociado e uma sem.
  for (const [nome, doc, fator] of [
    ['Metalurgica Aurora Ltda', '11222333000181', 0.6],
    ['Transportes Boa Vista SA', '44555666000181', 0],
  ] as const) {
    const e = await c.um<{ id: string }>(`
      insert into public.companies (tenant_id, legal_name, document)
      values ('${c.tenant}', '${nome}', '${doc}') returning id`);
    empresas.push(e.id);
    if (fator > 0) {
      await c.db.exec(`
        insert into public.company_exam_prices (tenant_id, company_id, exam_type_id, price)
        select '${c.tenant}', '${e.id}', et.id, round(et.price * ${fator}, 2)
          from public.exam_types et
         where et.tenant_id = '${c.tenant}' and et.price > 0`);
    }
  }

  const catalogo = await lerCatalogo(c);
  rotas = todasAsRotas(empresas);

  for (let i = 0; i < rotas.length; i++) {
    const rota = rotas[i]!;
    const percurso = await passarPeloSistema(
      c,
      equipes[i % equipes.length]!,
      rota.perfil,
      catalogo,
      i,
      rota.desvios ?? [],
    );
    resultados.push({ rota, percurso });
  }

  try {
    writeFileSync(
      'tests/sistema/ultimas-rotas.json',
      JSON.stringify({ total: rotas.length, resultados }, null, 1),
    );
  } catch {
    // Gravar o rastro e conveniencia, nao requisito.
  }
}, 1_800_000);

afterAll(async () => {
  await c?.fechar();
});

/* ================================================================== */

describe('1. nenhuma rota foi recusada pelo sistema', () => {
  it('nenhum passo falhou, em nenhuma das rotas', () => {
    const falhas = resultados.flatMap(({ rota, percurso }) =>
      percurso.falhas.map(
        (f) => `${rota.nome}: ${f.acao}${f.detalhe ? ` [${f.detalhe}]` : ''} -> ${f.erro}`,
      ),
    );
    expect(falhas).toEqual([]);
  });

  it('nenhuma ação escondeu falha dentro de uma mensagem de sucesso', () => {
    const semConsultaMedica = /A\.S\.O\..*parecer de aptidão/;
    const suspeitas = resultados.flatMap(({ rota, percurso }) =>
      percurso.passos
        .filter(
          (s) =>
            s.mensagem &&
            /não saiu|nao saiu|falhou|falharam|não consegui|nao consegui/i.test(s.mensagem) &&
            !(semConsultaMedica.test(s.mensagem) && !rota.espera.temConsulta),
        )
        .map((s) => `${rota.nome}: ${s.acao} -> ${s.mensagem}`),
    );
    expect(suspeitas).toEqual([]);
  });
});

describe('2. cada rota terminou onde tinha de terminar', () => {
  it('a etapa final de cada rota é a esperada', async () => {
    const fora: string[] = [];
    for (const { rota, percurso } of resultados) {
      if (!percurso.atendimentoId) {
        fora.push(`${rota.nome}: o atendimento nem chegou a existir`);
        continue;
      }
      const a = await c.um<{ stage_code: string }>(
        `select stage_code from public.attendances where id = '${percurso.atendimentoId}'`,
      );
      if (a.stage_code !== rota.espera.etapa) {
        fora.push(`${rota.nome}: terminou em "${a.stage_code}", esperado "${rota.espera.etapa}"`);
      }
    }
    expect(fora).toEqual([]);
  });

  it('quem tinha de passar pelo médico passou, e quem não tinha não passou', async () => {
    const fora: string[] = [];
    for (const { rota, percurso } of resultados) {
      if (rota.espera.temConsulta === undefined || !percurso.atendimentoId) continue;
      const r = await c.um<{ total: number }>(
        `select count(*)::int as total from public.medical_consultations
          where attendance_id = '${percurso.atendimentoId}' and finished_at is not null`,
      );
      const passou = r.total > 0;
      if (passou !== rota.espera.temConsulta) {
        fora.push(
          `${rota.nome}: ${passou ? 'passou' : 'não passou'} pelo médico, esperado ${rota.espera.temConsulta ? 'passar' : 'não passar'}`,
        );
      }
    }
    expect(fora).toEqual([]);
  });

  it('o A.S.O. saiu exatamente onde devia sair', async () => {
    const fora: string[] = [];
    for (const { rota, percurso } of resultados) {
      if (rota.espera.temAso === undefined || !percurso.atendimentoId) continue;
      const r = await c.um<{ total: number }>(
        `select count(*)::int as total from public.documents
          where attendance_id = '${percurso.atendimentoId}' and kind = 'aso' and deleted_at is null`,
      );
      if ((r.total > 0) !== rota.espera.temAso) {
        fora.push(`${rota.nome}: ${r.total} A.S.O., esperado ${rota.espera.temAso ? '1' : 'nenhum'}`);
      }
      if (r.total > 1) fora.push(`${rota.nome}: ${r.total} A.S.O. para o mesmo atendimento`);
    }
    expect(fora).toEqual([]);
  });

  it('os laudos de exame saíram na quantidade mínima esperada', async () => {
    const fora: string[] = [];
    for (const { rota, percurso } of resultados) {
      if (rota.espera.laudosMinimos === undefined || !percurso.atendimentoId) continue;
      const r = await c.um<{ total: number }>(
        `select count(*)::int as total from public.documents
          where attendance_id = '${percurso.atendimentoId}'
            and kind = 'resultado_exame' and deleted_at is null`,
      );
      if (r.total < rota.espera.laudosMinimos) {
        fora.push(`${rota.nome}: ${r.total} laudo(s), esperado ao menos ${rota.espera.laudosMinimos}`);
      }
    }
    expect(fora).toEqual([]);
  });

  it('a cobrança existe onde tem de existir, e não existe onde não pode', async () => {
    const fora: string[] = [];
    for (const { rota, percurso } of resultados) {
      if (rota.espera.temCobranca === undefined || rota.espera.temCobranca === null) continue;
      if (!percurso.atendimentoId) continue;
      const r = await c.um<{ total: number }>(
        `select count(*)::int as total from public.payments
          where attendance_id = '${percurso.atendimentoId}' and status <> 'cancelado'`,
      );
      if ((r.total > 0) !== rota.espera.temCobranca) {
        fora.push(
          `${rota.nome}: ${r.total} cobrança(s), esperado ${rota.espera.temCobranca ? 'cobrar' : 'não cobrar'}`,
        );
      }
    }
    expect(fora).toEqual([]);
  });

  it('o repasse do médico nasceu onde a consulta foi assinada', async () => {
    const fora: string[] = [];
    for (const { rota, percurso } of resultados) {
      if (!rota.espera.temRepasse || !percurso.atendimentoId) continue;
      const r = await c.um<{ total: number }>(
        `select count(*)::int as total from public.fee_entries
          where attendance_id = '${percurso.atendimentoId}'`,
      );
      if (r.total === 0) fora.push(`${rota.nome}: consulta assinada e nenhum repasse lançado`);
    }
    expect(fora).toEqual([]);
  });
});

/* ================================================================== */

describe('3. as invariantes do dia, com todas as rotas juntas', () => {
  it('ninguém ficou preso no meio do caminho', async () => {
    const presos = await c.linhas<{ nome: string; stage_code: string }>(`
      select p.full_name as nome, a.stage_code from public.attendances a
        join public.patients p on p.id = a.patient_id
       where a.tenant_id = '${c.tenant}'
         and a.stage_code not in ('finalizado','cancelado','ausente')`);
    expect(presos).toEqual([]);
  });

  it('nenhuma sala ficou ocupada', async () => {
    const salas = await c.linhas<{ name: string; status: string }>(`
      select name, status from public.rooms
       where tenant_id = '${c.tenant}'
         and (current_attendance_id is not null or status = 'ocupada')`);
    expect(salas).toEqual([]);
  });

  it('ninguém ficou marcado como em atendimento', async () => {
    const r = await c.linhas<{ nome: string }>(`
      select p.full_name as nome from public.attendances a
        join public.patients p on p.id = a.patient_id
       where a.tenant_id = '${c.tenant}' and a.in_service`);
    expect(r).toEqual([]);
  });

  it('nenhum exame ficou pendente em atendimento encerrado', async () => {
    const abertos = await c.linhas<{ nome: string; code: string; status: string }>(`
      select p.full_name as nome, et.code, pe.status
        from public.patient_exams pe
        join public.attendances a on a.id = pe.attendance_id
        join public.patients p on p.id = pe.patient_id
        join public.exam_types et on et.id = pe.exam_type_id
       where a.tenant_id = '${c.tenant}' and a.stage_code = 'finalizado'
         and pe.status not in ('concluido','cancelado','nao_realizado')`);
    expect(abertos.map((x) => `${x.nome}: ${x.code} ficou ${x.status}`)).toEqual([]);
  });

  it('nenhuma consulta assinada foi desassinada depois', async () => {
    // O defeito de 22/09: corrigir uma observação desfazia a assinatura.
    // Duas rotas gravam a consulta DEPOIS de finalizar, de propósito.
    const soltas = await c.linhas<{ nome: string }>(`
      select p.full_name as nome from public.medical_consultations mc
        join public.patients p on p.id = mc.patient_id
       where mc.tenant_id = '${c.tenant}'
         and mc.verdict is not null and mc.finished_at is null`);
    expect(soltas).toEqual([]);
  });

  it('nenhuma triagem concluída voltou a ficar em aberto', async () => {
    const soltas = await c.linhas<{ nome: string }>(`
      select p.full_name as nome from public.triages t
        join public.patients p on p.id = t.patient_id
        join public.attendances a on a.id = t.attendance_id
       where t.tenant_id = '${c.tenant}'
         and a.stage_code = 'finalizado' and t.finished_at is null`);
    expect(soltas).toEqual([]);
  });

  it('nenhum atendimento gerou duas cobranças em aberto', async () => {
    // A rota D5 clica duas vezes em "gerar cobrança" de propósito.
    const dobradas = await c.linhas<{ attendance_id: string; quantas: number }>(`
      select attendance_id, count(*)::int as quantas from public.payments
       where tenant_id = '${c.tenant}' and status = 'pendente'
       group by attendance_id having count(*) > 1`);
    expect(dobradas).toEqual([]);
  });

  it('nenhum repasse duplicado para o mesmo atendimento', async () => {
    const dobrados = await c.linhas<{ attendance_id: string; quantos: number }>(`
      select attendance_id, count(*)::int as quantos from public.fee_entries
       where tenant_id = '${c.tenant}'
       group by attendance_id having count(*) > 1`);
    expect(dobrados).toEqual([]);
  });

  it('nenhuma senha do dia se repete', async () => {
    const repetidas = await c.linhas<{ code: string; quantas: number }>(`
      select code, count(*)::int as quantas from public.queue_tickets
       where tenant_id = '${c.tenant}' group by code having count(*) > 1`);
    expect(repetidas).toEqual([]);
  });

  it('nenhum código de verificação de documento se repete', async () => {
    const repetidos = await c.linhas<{ verification_code: string }>(`
      select verification_code from public.documents
       where tenant_id = '${c.tenant}' and verification_code is not null
       group by verification_code having count(*) > 1`);
    expect(repetidos).toEqual([]);
  });

  it('nenhum documento visível ao paciente ficou sem dono', async () => {
    const orfaos = await c.linhas<{ kind: string }>(`
      select kind from public.documents
       where tenant_id = '${c.tenant}' and is_patient_visible and patient_id is null`);
    expect(orfaos).toEqual([]);
  });

  it('o RLS continua ligado e forçado em todas as tabelas', async () => {
    const soltas = await c.linhas<{ tabela: string }>(`
      select c.relname as tabela from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
         and (not c.relrowsecurity or not c.relforcerowsecurity)`);
    expect(soltas).toEqual([]);
  });

  it('a trilha de acesso a prontuário registrou os acessos', async () => {
    const r = await c.um<{ total: number }>(
      `select count(*)::int as total from public.clinical_access_logs`,
    );
    expect(r.total).toBeGreaterThan(0);
  });
});

describe('4. o lote em números', () => {
  it('todas as rotas produziram um atendimento', () => {
    const semAtendimento = resultados
      .filter((r) => !r.percurso.atendimentoId)
      .map((r) => r.rota.nome);
    expect(semAtendimento).toEqual([]);
    expect(resultados.length).toBe(rotas.length);
  });

  it('as rotas de exceção foram de fato exercitadas', () => {
    // Uma rota de exceção que não executou o desvio testa o caminho feliz
    // com outro nome — e daria verde sem provar nada.
    const esperadas = rotas.filter((r) => (r.desvios ?? []).length > 0);
    const naoExercitadas = esperadas.filter(({ nome, desvios }) => {
      const { percurso } = resultados.find((x) => x.rota.nome === nome)!;
      const acoes = percurso.passos.map((p) => p.acao).join(' ');
      return (desvios ?? []).some((d) => {
        const marca: Record<string, RegExp> = {
          repetir_chamada_sala: /recallTicket/,
          repetir_chamada_triagem: /repetirChamadaDaTriagem/,
          devolver_exame_para_fila: /updateExamStatus\(pendente\)/,
          remanejar_sala_do_exame: /atribuirSalaAoExame/,
          devolver_da_consulta_para_fila: /devolverParaFilaDoMedico/,
          rascunho_de_triagem: /saveTriage \(rascunho\)/,
          rascunho_de_consulta: /saveConsultation \(rascunho\)/,
          cobrar_duas_vezes: /gerarCobrancaRecepcao \(2a vez\)/,
          pagar_no_balcao: /confirmarPagamentoRecepcao/,
          guia_de_exame: /emitirGuiaDeExame/,
          termo_de_autorizacao: /emitirTermoAutorizacao/,
          anexar_laudo_depois: /anexarExame/,
          voltar_etapa_no_crm: /moveAttendanceStage\(volta\)/,
          marcar_ausente: /moveAttendanceStage\(ausente\)/,
        };
        return marca[d] ? !marca[d]!.test(acoes) : false;
      });
    });
    expect(naoExercitadas.map((r) => r.nome)).toEqual([]);
  });
});
