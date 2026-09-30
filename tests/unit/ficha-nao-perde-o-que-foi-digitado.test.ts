import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * As duas fichas longas nao podem voltar a ser formulario nao controlado.
 *
 * ---------------------------------------------------------------------
 * O defeito que esta trava existe para impedir
 * ---------------------------------------------------------------------
 * O React reseta formulario NAO CONTROLADO depois que a server action
 * termina -- inclusive quando ela devolve erro.
 *
 * Na ficha da consulta isso significava: o medico preenchia historia
 * clinica, antecedentes, exame fisico, diagnostico e conduta, esquecia de
 * escolher a conclusao de aptidao, clicava em "Finalizar consulta", o
 * servidor recusava, e TUDO QUE ELE DIGITOU sumia. Com o paciente na sala.
 *
 * Pior: os blocos de selecao sao estado React e sobreviviam, entao a tela
 * voltava meio preenchida e ninguem percebia o que tinha perdido.
 *
 * Na triagem, o mesmo com os sinais vitais ja medidos.
 *
 * ---------------------------------------------------------------------
 * Por que a trava e no texto do arquivo
 * ---------------------------------------------------------------------
 * A suite roda em Node, sem DOM: nao da para montar o componente e provar o
 * comportamento. Entao a trava e sobre a CAUSA, que e verificavel: nestes
 * dois arquivos, campo de digitacao tem de ser controlado (`value` +
 * `onChange`), nunca `defaultValue` / `defaultChecked`.
 *
 * E uma trava grosseira de proposito. Se alguem precisar mesmo de um
 * `defaultValue` aqui um dia, vai ter de ler este comentario antes.
 */
const FICHAS_LONGAS = [
  {
    arquivo: 'src/modules/clinical/consultation-form.tsx',
    oQueSePerde: 'a consulta medica inteira, digitada a mao',
  },
  {
    arquivo: 'src/app/(painel)/triagem/workspace.tsx',
    oQueSePerde: 'os sinais vitais ja medidos',
  },
];

describe('ficha longa nao perde o que foi digitado quando a acao falha', () => {
  for (const { arquivo, oQueSePerde } of FICHAS_LONGAS) {
    it(`${arquivo} usa campo controlado`, () => {
      const fonte = readFileSync(join(process.cwd(), arquivo), 'utf8');

      const naoControlados = [...fonte.matchAll(/default(Value|Checked)=/g)].length;

      expect(
        naoControlados,
        `${arquivo} voltou a usar defaultValue/defaultChecked. ` +
          `Quando a action devolver erro, o React limpa esses campos e ${oQueSePerde} ` +
          `desaparece da tela. Use value + onChange.`,
      ).toBe(0);
    });

    it(`${arquivo} mostra a recusa junto do botao`, () => {
      const fonte = readFileSync(join(process.cwd(), arquivo), 'utf8');

      // O <Alert> de erro no topo do formulario fica varias rolagens acima do
      // botao numa ficha longa: a pessoa clica, nada muda na parte visivel da
      // tela, e ela clica de novo. Na consulta, cada clique e uma tentativa
      // de assinar A.S.O.
      // `\s*\(?\s*` porque o segundo aviso costuma vir quebrado em varias
      // linhas pelo formatador, entre parenteses.
      const avisosDeErro = [
        ...fonte.matchAll(/!state\.ok\s*&&\s*\(?\s*<Alert variant="error"/g),
      ].length;

      expect(
        avisosDeErro,
        `${arquivo} precisa repetir o aviso de erro ao lado do botao de enviar, ` +
          'alem do aviso no topo -- senao a recusa nasce fora da tela.',
      ).toBeGreaterThanOrEqual(2);
    });
  }
});
