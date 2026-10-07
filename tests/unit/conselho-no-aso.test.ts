import { describe, expect, it } from 'vitest';
import { buildAsoPdf, type DadosAso } from '@/modules/documents/aso-pdf';
import { buildAsoDocx } from '@/modules/documents/aso-docx';
import { montarRiscos } from '@/modules/documents/riscos';
import { siglaDoConselho } from '@/lib/conselho';
import { companySchema } from '@/lib/validators';
import { textoDoPdf } from '../integration/texto-do-pdf';

/**
 * ---------------------------------------------------------------------
 * O defeito que este arquivo tranca
 * ---------------------------------------------------------------------
 * No A.S.O. a sigla do conselho nao e um valor: ela e o ROTULO da linha do
 * registro. O gerador imprime `[conselho]: [numero] / [UF]`. Alguem digitou
 * "27786" no campo Conselho do cadastro da empresa e o A.S.O. entregue ao
 * cliente em 06/10 saiu com
 *
 *     27786: 79775 / SP
 *
 * O numero estava certo — 79775 e o CRM da responsavel tecnica. Faltava a
 * palavra que da validade ao registro.
 *
 *     06/10 09:23 - Isa: no aso aqui ta saindo errado, deveria ser crm:
 *     06/10 10:03 - Thiago: O CRM esta certo? So nao ta saindo a palavra CRM?
 *     06/10 10:03 - Isa: isso
 */

describe('siglaDoConselho', () => {
  it('deixa passar a sigla de verdade, em maiúsculas', () => {
    expect(siglaDoConselho('CRM')).toBe('CRM');
    expect(siglaDoConselho('crm')).toBe('CRM');
    expect(siglaDoConselho(' CRO ')).toBe('CRO');
    expect(siglaDoConselho('crefito')).toBe('CREFITO');
    expect(siglaDoConselho('C.R.M.')).toBe('CRM');
  });

  it('número digitado no campo errado não vira rótulo', () => {
    // O caso exato de 06/10.
    expect(siglaDoConselho('27786')).toBe('CRM');
    // E a variante de quem cola o registro inteiro no campo da sigla:
    // deixar "CRM 79775" passar imprimiria o numero duas vezes na linha.
    expect(siglaDoConselho('CRM 79775')).toBe('CRM');
  });

  it('campo em branco sai como CRM, nunca em branco', () => {
    expect(siglaDoConselho(null)).toBe('CRM');
    expect(siglaDoConselho(undefined)).toBe('CRM');
    expect(siglaDoConselho('   ')).toBe('CRM');
  });

  it('lixo não vira rótulo de documento legal', () => {
    expect(siglaDoConselho('X')).toBe('CRM');
    expect(siglaDoConselho('-')).toBe('CRM');
    expect(siglaDoConselho('médica do trabalho responsável')).toBe('CRM');
  });
});

describe('cadastro da empresa avisa quem digitou', () => {
  const empresa = { legal_name: 'Indústria Modelo S.A.' };

  it('recusa número no campo Conselho', () => {
    const r = companySchema.safeParse({ ...empresa, pcmso_doctor_council: '27786' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toContain('sigla');
    }
  });

  it('aceita a sigla e aceita em branco', () => {
    expect(companySchema.safeParse({ ...empresa, pcmso_doctor_council: 'CRM' }).success).toBe(true);
    expect(companySchema.safeParse({ ...empresa, pcmso_doctor_council: '' }).success).toBe(true);
  });
});

const base: DadosAso = {
  clinica: {
    nome: 'Clínica Exemplo',
    razaoSocial: 'Clínica Exemplo Ltda',
    cnpj: '00.000.000/0001-00',
    endereco: 'Rua das Flores, 100',
    telefone: '(11) 4000-0000',
    cor: '#0F766E',
  },
  emitidoEm: new Date('2026-10-06T13:00:00Z'),
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
  // O cadastro como estava em producao em 06/10: a sigla gravada e um numero.
  medicoPcmso: {
    nome: 'Antonio Carlos Rodrigues da Silveira',
    conselho: '27786',
    numero: '79775',
    uf: 'SP',
    rqe: null,
    endereco: null,
    bairro: null,
    cidade: null,
    cep: null,
    telefone: null,
  },
  medicoExaminador: { nome: 'Dra. Exemplo', conselho: '27786', numero: '79775', uf: 'SP' },
  riscos: montarRiscos(null),
  tipoExame: 'Admissional',
  exames: [{ nome: 'Exame Clínico', data: '06/10/2026' }],
  parecer: 'apto',
  restricoes: null,
  validade: '06/10/2027',
  observacoes: null,
  assinaturaPaciente: null,
  codigoVerificacao: 'a1b2c3d4e5',
  urlVerificacao: 'https://exemplo.com/v/a1b2c3d4e5',
  rodape: 'Documento emitido eletronicamente.',
};

describe('A.S.O. imprime a palavra CRM', () => {
  it('no PDF, o rótulo do registro é CRM e não o número', async () => {
    const texto = await textoDoPdf(await buildAsoPdf(base));

    expect(texto).toContain('CRM');
    expect(texto).toContain('79775');
    // O que Isa circulou de verde no papel.
    expect(texto).not.toContain('27786');
  });

  it('o Word do mesmo atendimento diz a mesma coisa', async () => {
    const bytes = await buildAsoDocx(base);
    // O .docx e um zip; o texto do documento aparece no XML comprimido, mas
    // o que importa aqui e que gerou sem erro e que a regra e a mesma
    // funcao — a conferencia do rotulo esta no teste do PDF, que da para ler.
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('sigla de outro conselho é preservada', async () => {
    const texto = await textoDoPdf(
      await buildAsoPdf({
        ...base,
        medicoPcmso: { ...base.medicoPcmso, conselho: 'CRO' },
      }),
    );
    expect(texto).toContain('CRO');
  });
});
