/**
 * Valores plausiveis para cada ficha de exame.
 *
 * ---------------------------------------------------------------------
 * Por que isto existe
 * ---------------------------------------------------------------------
 * A varredura preenchia toda ficha com `{ observacao: 'normal' }`. O
 * sistema aceitava -- e estava certo em aceitar --, mas o documento que
 * saia era uma casca: os 21 laudos de audiometria da primeira exportacao
 * tinham os dois audiogramas DESENHADOS e VAZIOS, com a frase "sem medicao
 * registrada" no meio.
 *
 * Isso nao era defeito do sistema: sem limiares ele nao inventa curva, e
 * dizer "sem medicao" e melhor do que desenhar uma linha que ninguem mediu.
 * O defeito era do teste, que nunca chegou a exercitar o desenho.
 *
 * Aqui cada exame recebe valores do tipo que a clinica digita de verdade,
 * com casos clinicos distintos -- audicao normal, perda induzida por ruido,
 * assimetria -- para que os documentos gerados sirvam de amostra e para que
 * o preenchimento do grafico fique provado.
 *
 * Nada aqui diagnostica: sao numeros de exemplo. Quem conclui e o medico.
 */

/** Frequencias da audiometria tonal, em Hz. */
const FREQUENCIAS = [250, 500, 1000, 2000, 3000, 4000, 6000, 8000] as const;

/**
 * Perfis audiometricos, em dB por frequencia.
 *
 * A ordem dos numeros segue FREQUENCIAS. Sao quadros que aparecem no dia a
 * dia de medicina ocupacional:
 */
const AUDIOGRAMAS: { nome: string; od: number[]; oe: number[] }[] = [
  {
    // Audicao dentro dos limites em todas as frequencias.
    nome: 'normal',
    od: [10, 5, 5, 10, 10, 15, 10, 10],
    oe: [5, 10, 5, 5, 10, 10, 15, 10],
  },
  {
    // Entalhe em 4 kHz com recuperacao parcial em 8 kHz: o desenho classico
    // da perda induzida por ruido ocupacional. E o que a curva do laudo
    // precisa mostrar para o medico enxergar de longe.
    nome: 'entalhe em 4 kHz nas duas orelhas',
    od: [10, 10, 15, 20, 35, 50, 45, 25],
    oe: [10, 15, 15, 25, 40, 55, 45, 30],
  },
  {
    // Perda so de um lado: as duas curvas separadas no mesmo quadro.
    nome: 'assimetria à esquerda',
    od: [5, 10, 10, 10, 15, 20, 20, 15],
    oe: [20, 25, 30, 40, 50, 60, 55, 45],
  },
  {
    // Perda leve e plana, do tipo que aparece com a idade.
    nome: 'perda leve descendente',
    od: [15, 20, 25, 30, 35, 40, 45, 50],
    oe: [15, 20, 20, 30, 35, 40, 40, 45],
  },
  {
    // Uma frequencia nao medida de proposito: o grafico precisa ligar os
    // pontos que existem sem inventar o que falta.
    nome: 'com uma frequência não medida',
    od: [10, 10, 15, NaN, 20, 25, 20, 15],
    oe: [10, 15, 15, 20, 20, 25, 25, 20],
  },
];

function limiares(perfil: { od: number[]; oe: number[] }): Record<string, string> {
  const out: Record<string, string> = {};
  FREQUENCIAS.forEach((hz, i) => {
    const od = perfil.od[i];
    const oe = perfil.oe[i];
    // `NaN` marca frequencia nao medida: o campo fica em branco, como na
    // tela quando o examinador nao consegue testar aquela frequencia.
    if (od !== undefined && Number.isFinite(od)) out[`od_${hz}`] = String(od);
    if (oe !== undefined && Number.isFinite(oe)) out[`oe_${hz}`] = String(oe);
  });
  return out;
}

/** O perfil audiometrico de um paciente, escolhido de forma estavel. */
export function audiogramaDe(indice: number): { nome: string; valores: Record<string, string> } {
  const perfil = AUDIOGRAMAS[indice % AUDIOGRAMAS.length]!;
  return {
    nome: perfil.nome,
    valores: {
      repouso_auditivo: '14',
      aparelho: 'AUDIÔMETRO – A030',
      fabricante: 'ACÚSTICA ORLANDI',
      calibracao: '12/2025',
      meatoscopia_od: 'normal',
      meatoscopia_oe: 'normal',
      ...limiares(perfil),
    },
  };
}

/**
 * Valores de preenchimento para a ficha de um exame.
 *
 * O indice do paciente entra para que exames iguais em pacientes
 * diferentes nao saiam todos identicos -- um lote de cem documentos
 * clonados nao serve de amostra para ninguem.
 */
export function valoresDaFicha(codigo: string, indice: number): Record<string, string> {
  const gira = <T,>(lista: T[]): T => lista[indice % lista.length]!;

  switch (codigo) {
    case 'AUDIO':
      return audiogramaDe(indice).valores;

    case 'ACUIDADE':
      return {
        od_sem_correcao: gira(['20/20', '20/25', '20/30', '20/40']),
        oe_sem_correcao: gira(['20/20', '20/20', '20/25', '20/30']),
        od_com_correcao: gira(['20/20', '20/20', '20/20', '20/25']),
        oe_com_correcao: '20/20',
        usa_correcao: gira(['não', 'sim']),
        observacao: 'Acuidade aferida a 6 metros, tabela de Snellen.',
      };

    case 'ISHIHARA': {
      // As respostas do paciente, lamina a lamina, nas chaves que a ficha
      // usa (`figura_1` a `figura_6`). O material e o da propria clinica,
      // enviado em 13/09: gabarito 12, 74, 2, 26, 45 e 3.
      //
      // A figura 1 e a lamina de controle: todo mundo enxerga o 12. Quem
      // erra ELA nao tem discromatopsia -- nao entendeu a instrucao, ou a
      // iluminacao estava ruim. Por isso os tres casos abaixo sao
      // diferentes de verdade, e nao ruido aleatorio.
      const gabarito = ['12', '74', '2', '26', '45', '3'];
      const discromatopsia = ['12', 'não identifica', '5', 'não identifica', '5', 'não identifica'];
      const controleErrado = ['não identifica', '74', '2', '26', '45', '3'];

      const respostas =
        indice % 13 === 0 ? controleErrado : indice % 7 === 0 ? discromatopsia : gabarito;

      const out: Record<string, string> = {};
      respostas.forEach((r, i) => {
        out[`figura_${i + 1}`] = r;
      });
      return out;
    }

    case 'ROMBERG':
      return {
        tontura: indice % 9 === 0 ? 'sim' : 'não',
        tontura_tratamento: indice % 9 === 0 ? 'Em acompanhamento com otorrino.' : '',
        zumbido: indice % 11 === 0 ? 'sim' : 'não',
        zumbido_tratamento: '',
        fobia: 'não',
        desmaio: 'não',
        resultado: indice % 9 === 0 ? 'positivo' : 'sem alteração',
      };

    case 'FADIGA':
      return {
        observacao: 'Teste aplicado em repouso, sem esforço prévio.',
        resultado: gira(['sem alteração', 'sem alteração', 'sem alteração', 'alterado']),
      };

    case 'DINAMO_PAL':
      return {
        palmar_direita: String(28 + (indice % 22)),
        palmar_esquerda: String(26 + (indice % 20)),
        observacao: 'Três tentativas por mão, registrado o melhor valor.',
      };

    case 'DINAMO_ESC':
      return {
        escapular: String(32 + (indice % 18)),
        observacao: 'Dinamômetro escapular, posição sentada.',
      };

    case 'DINAMO_LOM':
      return {
        lombar: String(60 + (indice % 45)),
        observacao: 'Dinamômetro lombar, joelhos semiflexionados.',
      };

    case 'ECG':
      return {
        ritmo: gira(['sinusal', 'sinusal', 'sinusal', 'sinusal com arritmia respiratória']),
        fc: String(62 + (indice % 28)),
        conclusao: 'Traçado dentro dos limites da normalidade para a idade.',
      };

    case 'ESPIRO':
      return {
        cvf: (3.4 + (indice % 18) / 10).toFixed(2),
        vef1: (2.8 + (indice % 15) / 10).toFixed(2),
        vef1_cvf: String(78 + (indice % 12)),
        conclusao: 'Espirometria sem distúrbio ventilatório obstrutivo ou restritivo.',
      };

    case 'EEG':
      return {
        ritmo_base: 'alfa de 9 Hz, simétrico e reativo',
        alteracoes: 'Não foram observadas alterações paroxísticas.',
        conclusao: 'Eletroencefalograma dentro dos padrões da normalidade.',
      };

    case 'LAB':
      return {
        analises: 'Hemograma completo, glicemia de jejum, creatinina.',
        material: 'Sangue venoso',
        observacao: 'Coleta em jejum de 8 horas.',
      };

    case 'PSICO':
      return { observacao: 'Respondido pelo médico na consulta.' };

    default:
      return { observacao: 'Sem alterações dignas de nota.' };
  }
}

/** A conclusão que o examinador escreve, por tipo de exame. */
export function conclusaoDaFicha(codigo: string, indice: number): string {
  switch (codigo) {
    case 'AUDIO': {
      const { nome } = audiogramaDe(indice);
      return nome === 'normal'
        ? 'Limiares dentro dos padrões de normalidade em ambas as orelhas.'
        : `Achado compatível com ${nome}. Encaminhado ao médico do trabalho para avaliação.`;
    }
    case 'ISHIHARA':
      // De proposito em branco: e o sistema que escreve a conclusao do
      // Ishihara, conferindo as laminas contra o gabarito.
      return '';
    default:
      return 'Sem alterações dignas de nota.';
  }
}
