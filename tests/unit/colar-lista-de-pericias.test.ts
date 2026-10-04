import { describe, expect, it } from 'vitest';
import { lerTextoColado } from '@/modules/import/texto-livre';

/**
 * A lista do eSisla copiada DA TELA, com o mouse.
 *
 * ---------------------------------------------------------------------
 * O defeito que este teste tranca
 * ---------------------------------------------------------------------
 * A recepcao abre o eSisla (Sistemas de Pericias Medicas do Estado),
 * seleciona a tabela de "Pericias Agendadas Clinicas" e cola na caixa do
 * proximo dia. O navegador entrega a tabela separada por TABULACAO, uma
 * celula por coluna, e normalmente SEM a linha de cabecalho — quem arrasta
 * o mouse pelo corpo da tabela raramente pega os titulos.
 *
 * Sem cabecalho, o leitor de tabela avaliava celula por celula e aceitava a
 * primeira que parecesse nome. A coluna "Tipo" vem antes da coluna "Nome" e
 * tem valor "JM REAP": duas palavras, so letras, passa no teste de nome.
 *
 * Resultado em producao, 02/10: 108 linhas lidas, 108 pessoas chamadas
 * "Jm Reap", e o nome de verdade descartado. A agenda do dia seguinte
 * nasceria com 108 pacientes de nome errado.
 *
 * E havia o segundo erro embaixo do primeiro: o eSisla repete a mesma
 * pericia uma vez por SEQUENCIA. Mara Lucia aparece tres vezes (Seq 1, 2 e
 * 3), mesmo horario, mesmo protocolo — tres avaliacoes da mesma pericia,
 * nao tres visitas. 108 linhas sao 36 pessoas.
 *
 * As colunas, na ordem em que o portal as entrega:
 *   Periciado(caixa) · Hora · Tipo · Protocolo · Seq · Read · Pessoa · NI ·
 *   Nome · Compareceu(pontilhado) · Observacao
 */
const T = '\t';

/** Monta uma linha como o navegador entrega ao copiar a tabela. */
function linha(
  hora: string,
  protocolo: string,
  seq: string,
  read: string,
  ni: string,
  nome: string,
): string {
  // A primeira celula e a caixa de marcar: vem vazia. "Pessoa" tambem.
  return ['', hora, 'JM REAP', protocolo, seq, read, '', ni, nome, '.....................', ''].join(
    T,
  );
}

const COLADO_DA_TELA = [
  linha('07:30', '954364891', '1', 'S', '584435', 'MARA LUCIA TADEU STEFANO LOPES'),
  linha('07:30', '954364891', '2', 'S', '584435', 'MARA LUCIA TADEU STEFANO LOPES'),
  linha('07:30', '954364891', '3', 'S', '584435', 'MARA LUCIA TADEU STEFANO LOPES'),
  linha('07:45', '954365494', '1', '', '1493275', 'IVANIA ROCHA DA SILVA'),
  linha('07:45', '954365494', '2', '', '1493275', 'IVANIA ROCHA DA SILVA'),
  linha('07:45', '954365494', '3', '', '1493275', 'IVANIA ROCHA DA SILVA'),
  linha('08:00', '954366083', '1', 'S', '1126006', 'FABIANA CASSIA V CASAGRANDE'),
  linha('08:00', '954366083', '2', 'S', '1126006', 'FABIANA CASSIA V CASAGRANDE'),
  linha('08:00', '954366083', '3', 'S', '1126006', 'FABIANA CASSIA V CASAGRANDE'),
].join('\n');

describe('lista de perícias colada da tela do eSisla', () => {
  it('lê o nome da pessoa, e não a coluna Tipo', () => {
    const r = lerTextoColado(COLADO_DA_TELA);

    const nomes = r.registros.map((x) => x.nome);
    expect(nomes).not.toContain('Jm Reap');
    expect(nomes).toContain('Mara Lucia Tadeu Stefano Lopes');
    // "da" fica minusculo: `tituloDeNome` trata as particulas.
    expect(nomes).toContain('Ivania Rocha da Silva');
    expect(nomes).toContain('Fabiana Cassia V Casagrande');
  });

  it('a mesma perícia repetida por sequência vira UMA pessoa', () => {
    const r = lerTextoColado(COLADO_DA_TELA);
    // Nove linhas na tela, tres pessoas na agenda.
    expect(r.registros).toHaveLength(3);
    expect(r.formato).toBe('pericias');
  });

  it('diz na observação quantas avaliações a perícia tem', () => {
    const r = lerTextoColado(COLADO_DA_TELA);
    const mara = r.registros.find((x) => x.nome?.startsWith('Mara'));
    expect(mara?.observacoes).toContain('3 avaliações');
  });

  it('guarda hora, protocolo e matrícula de cada um', () => {
    const r = lerTextoColado(COLADO_DA_TELA);
    const ivania = r.registros.find((x) => x.nome?.startsWith('Ivania'));
    expect(ivania?.hora).toBe('07:45');
    expect(ivania?.protocolo).toBe('954365494');
    expect(ivania?.matricula).toBe('1493275');
  });

  it('avisa que não veio CPF — a recepção confere na chegada', () => {
    const r = lerTextoColado(COLADO_DA_TELA);
    for (const reg of r.registros) {
      expect(reg.cpf).toBeNull();
      expect(reg.avisos.join(' ')).toContain('Sem CPF');
    }
  });

  it('continua lendo a mesma lista quando vem sem tabulação', () => {
    // Colada de um PDF ou da impressao, a linha vem posicional. Este era o
    // unico caminho que funcionava antes, e tem de continuar funcionando.
    const posicional = [
      '07:30 LICENCA 954364891 1 S 584435 MARA LUCIA TADEU STEFANO LOPES ..........',
      '07:45 LICENCA 954365494 1 1493275 IVANIA ROCHA DA SILVA ..........',
    ].join('\n');

    const r = lerTextoColado(posicional);
    expect(r.formato).toBe('pericias');
    expect(r.registros.map((x) => x.nome)).toEqual([
      'Mara Lucia Tadeu Stefano Lopes',
      'Ivania Rocha da Silva',
    ]);
  });
});

describe('coluna constante não vira nome de pessoa', () => {
  it('ignora a coluna de categoria numa tabela sem cabeçalho', () => {
    // Mesmo sem ser a lista de pericias: qualquer relatorio com uma coluna
    // de categoria antes do nome caia no mesmo buraco.
    const texto = [
      `ADMISSIONAL${T}JOAO DA SILVA SANTOS${T}123.456.789-09`,
      `ADMISSIONAL${T}MARIA APARECIDA SOUZA${T}987.654.321-00`,
      `ADMISSIONAL${T}PEDRO HENRIQUE LIMA${T}111.444.777-35`,
    ].join('\n');

    const r = lerTextoColado(texto);
    const nomes = r.registros.map((x) => x.nome);
    expect(nomes).not.toContain('Admissional');
    expect(nomes).toContain('Joao da Silva Santos');
  });
});
