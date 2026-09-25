import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { buildAsoPdf, type DadosAso } from '@/modules/documents/aso-pdf';
import { montarRiscos } from '@/modules/documents/riscos';
import { textoDoPdf } from '../integration/texto-do-pdf';

/** PNG 1x1 transparente — serve de assinatura sem depender de arquivo externo. */
const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const base: DadosAso = {
  clinica: {
    nome: 'Clínica Exemplo',
    razaoSocial: 'Clínica Exemplo Ltda',
    cnpj: '00.000.000/0001-00',
    endereco: 'Rua das Flores, 100',
    telefone: '(11) 4000-0000',
    cor: '#0F766E',
  },
  emitidoEm: new Date('2026-08-19T13:00:00Z'),
  empresaContratante: {
    razaoSocial: 'Indústria Modelo S.A.',
    cnpj: '11.111.111/0001-11',
    endereco: 'Av. Industrial, 500',
    bairro: 'Distrito Industrial',
    cidade: 'Campinas / SP',
    cep: '13000-000',
  },
  funcionario: {
    nome: 'Ana Paula Ribeiro',
    matricula: '4477',
    cpf: '123.456.789-00',
    rg: '12.345.678-9',
    nascimento: '10/03/1990',
    idade: 36,
    sexo: 'Feminino',
    cargo: 'Operadora de máquinas',
    setor: 'Produção',
  },
  medicoPcmso: {
    nome: 'Dra. Exemplo',
    conselho: 'CRM',
    numero: '79775',
    uf: 'SP',
    rqe: '1234',
    endereco: 'Rua Paulo Orozimbo, 391',
    bairro: 'Cambuci',
    cidade: 'São Paulo / SP',
    cep: '01535-000',
    telefone: '(11) 3000-0000',
  },
  medicoExaminador: { nome: 'Dra. Exemplo', conselho: 'CRM', numero: '79775', uf: 'SP' },
  riscos: montarRiscos(null),
  tipoExame: 'Admissional',
  exames: [
    { nome: 'Exame Clínico', data: '19/08/2026' },
    { nome: 'Audiometria', data: '19/08/2026' },
  ],
  parecer: 'apto',
  restricoes: null,
  validade: '19/08/2027',
  observacoes: null,
  assinaturaPaciente: null,
  codigoVerificacao: 'a1b2c3d4e5',
  urlVerificacao: 'https://exemplo.com/v/a1b2c3d4e5',
  rodape: 'Documento emitido eletronicamente.',
};

/**
 * "esta saindo 2 folhas, precisa ficar tudo em uma folha so"
 *                                              -- Isabella, 23/09.
 *
 * O modelo em papel da clinica e de uma folha. O que estoura sao os riscos
 * ocupacionais, a lista de exames e as observacoes — todos de tamanho
 * variavel. Nenhum deles pode ser cortado: risco ocupacional apagado para
 * caber na folha e informacao que some do documento legal.
 */
describe('cabe em uma folha', () => {
  const texto = (n: number) =>
    Array.from({ length: n }, (_, i) => `fator de risco número ${i + 1} descrito por extenso`).join(
      ', ',
    );

  it('o caso comum sai em uma folha', async () => {
    const doc = await PDFDocument.load(await buildAsoPdf(base));
    expect(doc.getPageCount()).toBe(1);
  });

  it('riscos longos nas cinco categorias ainda cabem', async () => {
    const bytes = await buildAsoPdf({
      ...base,
      riscos: {
        fisicos: texto(4),
        quimicos: texto(4),
        biologicos: texto(3),
        ergonomicos: texto(5),
        acidentes: texto(4),
      },
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('paciente com muitos exames ainda cabe', async () => {
    const bytes = await buildAsoPdf({
      ...base,
      exames: Array.from({ length: 15 }, (_, i) => ({
        nome: `Exame número ${i + 1}`,
        data: '19/08/2026',
      })),
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('o pior caso junto — riscos, exames, restrições e observações', async () => {
    const bytes = await buildAsoPdf({
      ...base,
      riscos: {
        fisicos: texto(4),
        quimicos: texto(4),
        biologicos: texto(3),
        ergonomicos: texto(5),
        acidentes: texto(4),
      },
      exames: Array.from({ length: 12 }, (_, i) => ({
        nome: `Exame número ${i + 1}`,
        data: '19/08/2026',
      })),
      restricoes: texto(3),
      observacoes: texto(6),
      parecer: 'apto_com_restricoes',
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('nada é apagado para caber: o texto dos riscos continua no papel', async () => {
    const riscos = {
      fisicos: texto(4),
      quimicos: texto(4),
      biologicos: texto(3),
      ergonomicos: texto(5),
      acidentes: texto(4),
    };
    const impresso = textoDoPdf(await buildAsoPdf({ ...base, riscos }));
    // A ultima palavra do ultimo risco: se ela esta la, nada foi cortado.
    expect(impresso).toContain('fator de risco número 4 descrito por extenso');
    expect(impresso).toContain('fator de risco número 5 descrito por extenso');
  });
});

/**
 * "no parecer do aso precisa incluir as opcs 'Apto para trabalho em
 *  altura', 'Apto para trabalho com Eletricidade'" -- Isabella, 23/09.
 *
 * Entraram como linhas PRÓPRIAS do parecer, e não como opções da conclusão
 * de aptidão. NR-35 e NR-10 se somam a "apto para a função": se
 * substituíssem, o A.S.O. de quem trabalha em altura deixaria de dizer se
 * a pessoa está apta ao próprio cargo.
 */
describe('aptidões de altura e eletricidade', () => {
  it('não aparecem quando o médico não marcou', async () => {
    const texto = textoDoPdf(await buildAsoPdf(base));
    expect(texto).not.toContain('altura');
    expect(texto).not.toContain('eletricidade');
  });

  it('saem marcadas quando o médico marcou', async () => {
    const texto = textoDoPdf(
      await buildAsoPdf({ ...base, aptoAltura: true, aptoEletricidade: true }),
    );
    expect(texto).toContain('Apto para trabalho em altura (NR-35)');
    expect(texto).toContain('Apto para trabalho com eletricidade (NR-10)');
  });

  it('a conclusão de aptidão continua lá — elas somam, não substituem', async () => {
    const texto = textoDoPdf(await buildAsoPdf({ ...base, aptoAltura: true }));
    expect(texto).toContain('Apto para função');
    expect(texto).toContain('Apto para trabalho em altura');
  });

  it('uma só também funciona', async () => {
    const texto = textoDoPdf(await buildAsoPdf({ ...base, aptoEletricidade: true }));
    expect(texto).toContain('eletricidade');
    expect(texto).not.toContain('altura');
  });

  it('continua cabendo em uma folha com as duas marcadas', async () => {
    const doc = await PDFDocument.load(
      await buildAsoPdf({
        ...base,
        aptoAltura: true,
        aptoEletricidade: true,
        exames: Array.from({ length: 12 }, (_, i) => ({
          nome: `Exame número ${i + 1}`,
          data: '19/08/2026',
        })),
      }),
    );
    expect(doc.getPageCount()).toBe(1);
  });
});

describe('buildAsoPdf', () => {
  it('gera um PDF em A4', async () => {
    const bytes = await buildAsoPdf(base);
    expect(bytes.byteLength).toBeGreaterThan(1000);

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(Math.round(width)).toBe(595);
    expect(Math.round(height)).toBe(842);
  });

  it('embute a assinatura do paciente quando existe', async () => {
    const com = await buildAsoPdf({ ...base, assinaturaPaciente: PNG_1X1 });
    const sem = await buildAsoPdf(base);
    expect(com.byteLength).toBeGreaterThan(sem.byteLength);
  });

  it('embute a assinatura do medico quando existe', async () => {
    const com = await buildAsoPdf({ ...base, assinaturaMedico: PNG_1X1 });
    const sem = await buildAsoPdf(base);
    expect(com.byteLength).toBeGreaterThan(sem.byteLength);
  });

  it('nao quebra com assinatura corrompida', async () => {
    const bytes = await buildAsoPdf({
      ...base,
      assinaturaPaciente: 'data:image/png;base64,xxx',
      assinaturaMedico: 'data:image/png;base64,xxx',
    });
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('aceita campos opcionais ausentes', async () => {
    const bytes = await buildAsoPdf({
      ...base,
      clinica: { ...base.clinica, cnpj: null, endereco: null, telefone: null, cor: 'nao-e-cor' },
      empresaContratante: {
        razaoSocial: 'X',
        cnpj: null,
        endereco: null,
        bairro: null,
        cidade: null,
        cep: null,
      },
      funcionario: {
        ...base.funcionario,
        matricula: null,
        cpf: null,
        rg: null,
        idade: null,
        cargo: null,
        setor: null,
      },
      medicoPcmso: {
        nome: null,
        conselho: 'CRM',
        numero: null,
        uf: null,
        rqe: null,
        endereco: null,
        bairro: null,
        cidade: null,
        cep: null,
        telefone: null,
      },
      medicoExaminador: { nome: 'Dra. Exemplo', conselho: 'CRM', numero: null, uf: null },
      exames: [],
      validade: null,
      urlVerificacao: null,
      rodape: null,
    });
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('aceita qualquer parecer sem quebrar', async () => {
    for (const parecer of ['apto', 'apto_com_restricoes', 'inapto', 'inconclusivo', 'coisa']) {
      const bytes = await buildAsoPdf({ ...base, parecer });
      expect(bytes.byteLength).toBeGreaterThan(1000);
    }
  });

  it('imprime riscos longos sem estourar', async () => {
    const longo = 'Exposição a ruído contínuo acima do limite de tolerância. '.repeat(8);
    const bytes = await buildAsoPdf({
      ...base,
      riscos: montarRiscos({
        cargo: null,
        fisicos: longo,
        quimicos: longo,
        biologicos: longo,
        ergonomicos: longo,
        acidentes: longo,
      }),
    });
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('abre segunda pagina quando o conteudo ocupa a folha', async () => {
    const enorme = 'Restrição muito detalhada do posto de trabalho. '.repeat(60);
    const doc = await PDFDocument.load(
      await buildAsoPdf({ ...base, restricoes: enorme, observacoes: enorme }),
    );
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);
  });

  it('lista muitos exames sem quebrar', async () => {
    const exames = Array.from({ length: 30 }, (_, i) => ({
      nome: `Exame ${i + 1}`,
      data: '19/08/2026',
    }));
    const bytes = await buildAsoPdf({ ...base, exames });
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});
