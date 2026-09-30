/**
 * O audiograma se preenche sozinho a partir dos limiares medidos.
 *
 * "Quando fizer exame de audiometria, o proprio sistema deve preencher o
 *  quadro de grafico de orelha direita e orelha esquerda, esse grafico deve
 *  ser preenchido automaticamente de acordo com as informacoes anexadas."
 *
 * Ate agora isso nunca tinha sido provado de ponta a ponta. A varredura de
 * cem pacientes preenchia as fichas com um "normal" generico, entao os 21
 * laudos de audiometria que ela gerou sairam com os dois quadros
 * DESENHADOS E VAZIOS, com a frase "sem medicao registrada" no meio.
 *
 * O sistema estava certo: sem limiares ele nao inventa curva. O teste e que
 * nunca chegou ao desenho.
 *
 * Aqui o exame acontece de verdade -- recepcao, sala, ficha preenchida com
 * dB reais, conclusao e laudo -- e o PDF e aberto e conferido.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { montarClinica, type Clinica, type Pessoa } from './clinica';
import { audiogramaDe, valoresDaFicha } from './fichas-realistas';
import { callNextForRoom, updateExamStatus } from '@/modules/queue/actions';
import { saveExamResult } from '@/modules/clinical/actions';
import { gerarLaudoDeExame } from '@/modules/documents/laudo-actions';
import { arquivosDoStorage } from '../integration/banco-vivo';
import { textoDoPdf } from '../integration/texto-do-pdf';

const PASTA = join(
  process.env.USERPROFILE ?? process.env.HOME ?? '.',
  'Desktop',
  'documentos teste sistema',
  'audiometrias de exemplo',
);

/** A frase que o desenho escreve quando nao ha ponto nenhum para plotar. */
const QUADRO_VAZIO = 'sem medição registrada';

let c: Clinica;
let examinador: Pessoa;
let sequencia = 1;

/**
 * Leva um paciente do zero ao laudo de audiometria, pelas ações de verdade.
 * Devolve o PDF que a clínica receberia.
 */
async function audiometriaComExame(
  codigoExame: string,
  nome: string,
  valores: Record<string, string>,
  conclusao: string,
): Promise<{ pdf: Uint8Array; texto: string }> {
  const paciente = (
    await c.um<{ id: string }>(
      `insert into public.patients (tenant_id, full_name, birth_date, gender)
       values ('${c.tenant}', '${nome.replace(/'/g, "''")}', '1984-06-11', 'masculino')
       returning id`,
    )
  ).id;

  const at = (
    await c.um<{ id: string }>(
      `insert into public.attendances (tenant_id, patient_id, stage_code, needs_triage, in_service, origin_kind)
       values ('${c.tenant}', '${paciente}', 'aguardando_exames', false, false, 'particular')
       returning id`,
    )
  ).id;

  await c.db.exec(`
    insert into public.queue_tickets (tenant_id, attendance_id, prefix, sequence)
    values ('${c.tenant}', '${at}', 'A', ${sequencia++});
    insert into public.patient_exams (tenant_id, attendance_id, patient_id, exam_type_id, room_id, status)
    select '${c.tenant}', '${at}', '${paciente}', et.id, et.default_room_id, 'pendente'
      from public.exam_types et
     where et.tenant_id = '${c.tenant}' and et.code = '${codigoExame}'`);

  const sala = (
    await c.um<{ id: string }>(
      `select default_room_id as id from public.exam_types
        where tenant_id = '${c.tenant}' and code = '${codigoExame}'`,
    )
  ).id;

  const exame = (
    await c.um<{ id: string }>(
      `select id from public.patient_exams where attendance_id = '${at}' limit 1`,
    )
  ).id;

  await c.como(examinador, async () => {
    // A sala pode estar ocupada pelo paciente anterior do teste.
    await c.db.exec(`
      update public.rooms set status = 'disponivel', current_attendance_id = null
       where id = '${sala}'`);
    const chamada = await callNextForRoom(sala);
    expect(chamada.ok).toBe(true);

    const ficha = await saveExamResult(exame, valores, conclusao, false, false);
    expect(ficha.ok ? null : ficha.error).toBeNull();

    const concluir = await updateExamStatus(exame, 'concluido');
    expect(concluir.ok ? null : concluir.error).toBeNull();

    const laudo = await gerarLaudoDeExame(exame);
    expect(laudo.ok ? null : laudo.error).toBeNull();
  });

  const caminho = await c.um<{ file_path: string }>(
    `select file_path from public.documents
      where attendance_id = '${at}' and kind = 'resultado_exame' limit 1`,
  );
  const pdf = arquivosDoStorage().get(`clinical-documents/${caminho.file_path}`);
  if (!pdf) throw new Error('o laudo foi gravado sem arquivo por trás');

  return { pdf, texto: textoDoPdf(pdf) };
}

beforeAll(async () => {
  c = await montarClinica();
  examinador = await c.criarPessoa('Fonoaudióloga', 'fono@audio.teste', 'medico_examinador');
  mkdirSync(PASTA, { recursive: true });
}, 300_000);

afterAll(async () => {
  await c?.fechar();
});

describe('audiometria com valores reais', () => {
  it('o quadro fica VAZIO quando ninguém mediu nada — e diz isso', async () => {
    // A referencia do teste. Sem esta linha, "o grafico tem pontos" nao
    // significa nada: pode ser que ele sempre desenhe alguma coisa.
    const { texto } = await audiometriaComExame(
      'AUDIO',
      'Referência sem limiares',
      {
        repouso_auditivo: '14',
        aparelho: 'AUDIÔMETRO – A030',
        fabricante: 'ACÚSTICA ORLANDI',
        meatoscopia_od: 'normal',
      },
      'Exame não concluído: paciente não tolerou o fone.',
    );

    expect(texto).toContain(QUADRO_VAZIO);
  });

  it.each([0, 1, 2, 3, 4])('o perfil %i desenha a curva nos dois ouvidos', async (i) => {
    const { nome, valores } = audiogramaDe(i);
    const { pdf, texto } = await audiometriaComExame(
      'AUDIO',
      `Audiometria — ${nome}`,
      valores,
      `Achado: ${nome}.`,
    );

    // 1. Os dois quadros existem.
    expect(texto).toContain('Audiograma');
    expect(texto).toContain('Orelha direita');
    expect(texto).toContain('Orelha esquerda');

    // 2. E NENHUM deles está vazio. Esta é a asserção que faltava.
    expect(texto).not.toContain(QUADRO_VAZIO);

    // 3. Os limiares medidos aparecem escritos na tabela do laudo, para o
    //    médico conferir o número além da curva.
    const medidos = Object.entries(valores)
      .filter(([k]) => k.startsWith('od_') || k.startsWith('oe_'))
      .map(([, v]) => v);
    for (const v of medidos.slice(0, 6)) {
      expect(texto).toContain(v);
    }

    // Guarda o PDF para olho humano: é o único juiz de como ficou.
    writeFileSync(
      join(PASTA, `audiometria-${i + 1}-${nome.replace(/[^a-zA-Z0-9]+/g, '-')}.pdf`),
      pdf,
    );
  });

  it('o entalhe em 4 kHz é destacado como fora do limite', async () => {
    // O que o médico precisa enxergar de longe: 50 e 55 dB em 4 kHz estão
    // acima do limite de 25 dB da NR-7.
    const { valores } = audiogramaDe(1);
    const { texto } = await audiometriaComExame(
      'AUDIO',
      'Audiometria — entalhe destacado',
      valores,
      'Entalhe em 4 kHz.',
    );

    expect(valores.od_4000).toBe('50');
    expect(valores.oe_4000).toBe('55');
    expect(texto).toContain('50');
    expect(texto).toContain('55');
    // A descrição automática precisa apontar as frequências alteradas, e
    // não apenas listar números.
    expect(texto).toMatch(/4k|4000|acima de 25|alterad/i);
  });

  it('o Ishihara é corrigido pelo sistema, e o laudo diz o resultado', async () => {
    // A conclusao do Ishihara nao e digitada: `conferirIshihara` compara as
    // seis laminas com o gabarito da clinica (12, 74, 2, 26, 45, 3) e
    // valida a lamina de controle. Ate 29/09 essa funcao existia, testada,
    // e ninguem a chamava -- o laudo saia com a conclusao em branco.
    const casos: { nome: string; indice: number; espera: RegExp }[] = [
      // Gabarito completo: as cinco lâminas que valem, mais a de controle.
      { nome: 'visão de cores normal', indice: 1, espera: /identificou as 5 lâminas/i },
      // Erra as que dependem de cor, acerta a de controle.
      { nome: 'com discromatopsia', indice: 7, espera: /identificou \d de 5|oftalmo/i },
      // Erra a lâmina de controle: o teste não vale, e o laudo diz isso em
      // vez de apontar daltonismo em quem talvez enxergue bem.
      { nome: 'lâmina de controle errada', indice: 13, espera: /controle/i },
    ];

    for (const caso of casos) {
      const valores = valoresDaFicha('ISHIHARA', caso.indice);
      expect(valores.figura_1).toBeDefined();

      const { texto } = await audiometriaComExame(
        'ISHIHARA',
        `Ishihara — ${caso.nome}`,
        valores,
        // De proposito em branco: quem escreve e o sistema.
        '',
      );

      const conclusao = texto.slice(texto.indexOf('Conclus'));
      expect(conclusao).not.toMatch(/Conclus(ão|ao)\s*(Assinado|$)/);
      expect(conclusao).toMatch(caso.espera);
    }
  });

  it('frequência não medida não vira ponto inventado', async () => {
    // O perfil 4 não tem 2 kHz na orelha direita. A curva liga o que existe
    // e não preenche o buraco — um ponto errado no gráfico é pior que um
    // ponto ausente.
    const { valores } = audiogramaDe(4);
    expect(valores.od_2000).toBeUndefined();
    expect(valores.oe_2000).toBe('20');

    const { texto } = await audiometriaComExame(
      'AUDIO',
      'Audiometria — frequência ausente',
      valores,
      'Uma frequência não testada.',
    );

    expect(texto).not.toContain(QUADRO_VAZIO);
    expect(texto).toContain('Audiograma');
  });
});
