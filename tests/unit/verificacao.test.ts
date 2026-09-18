import { describe, expect, it } from 'vitest';
import {
  CODIGO_VALIDO,
  descreverTipo,
  mascararNome,
  montarResposta,
  normalizarCodigo,
  urlDeVerificacao,
  type LinhaDeDocumento,
} from '@/modules/documents/verificacao';

describe('normalizarCodigo', () => {
  it('aceita o codigo limpo', () => {
    expect(normalizarCodigo('A1B2C3D4E5')).toBe('A1B2C3D4E5');
  });

  it('aceita minuscula, espaco e hifen — e como a pessoa copia do papel', () => {
    expect(normalizarCodigo('a1b2 c3d4-e5')).toBe('A1B2C3D4E5');
    expect(normalizarCodigo('  A1B2C3D4E5  ')).toBe('A1B2C3D4E5');
  });

  it('aceita o rotulo colado junto', () => {
    expect(normalizarCodigo('Código de verificação: A1B2C3D4E5')).toBe('A1B2C3D4E5');
    expect(normalizarCodigo('CODIGO DE VERIFICACAO A1B2C3D4E5')).toBe('A1B2C3D4E5');
  });

  it('nao quebra com vazio', () => {
    expect(normalizarCodigo('')).toBe('');
    expect(normalizarCodigo(null)).toBe('');
    expect(normalizarCodigo(undefined)).toBe('');
  });
});

describe('CODIGO_VALIDO', () => {
  it('aceita 10 caracteres hexadecimais', () => {
    expect(CODIGO_VALIDO.test('A1B2C3D4E5')).toBe(true);
    expect(CODIGO_VALIDO.test('0123456789')).toBe(true);
    expect(CODIGO_VALIDO.test('FFFFFFFFFF')).toBe(true);
  });

  it('recusa tamanho errado e letra fora do hexadecimal', () => {
    expect(CODIGO_VALIDO.test('A1B2C3D4E')).toBe(false);
    expect(CODIGO_VALIDO.test('A1B2C3D4E56')).toBe(false);
    expect(CODIGO_VALIDO.test('G1B2C3D4E5')).toBe(false);
    expect(CODIGO_VALIDO.test('')).toBe(false);
  });
});

describe('urlDeVerificacao', () => {
  it('sem configuracao, aponta para a propria pagina do sistema', () => {
    expect(urlDeVerificacao(null, 'https://h2-medicina.vercel.app')).toBe(
      'h2-medicina.vercel.app/verificar',
    );
  });

  it('a clinica pode configurar o proprio endereco', () => {
    expect(urlDeVerificacao('h2medicina.com.br/conferir', 'https://qualquer.coisa')).toBe(
      'h2medicina.com.br/conferir',
    );
  });

  it('ignora barra sobrando no fim', () => {
    expect(urlDeVerificacao(null, 'https://exemplo.com/')).toBe('exemplo.com/verificar');
    expect(urlDeVerificacao('exemplo.com/x/', null)).toBe('exemplo.com/x');
  });

  it('sem nada configurado, nao inventa endereco', () => {
    // Melhor sair so o codigo do que um endereco que nao existe.
    expect(urlDeVerificacao(null, null)).toBeNull();
    expect(urlDeVerificacao('', '')).toBeNull();
    expect(urlDeVerificacao('   ', '   ')).toBeNull();
  });
});

describe('mascararNome', () => {
  it('mostra o primeiro nome e as iniciais do resto', () => {
    expect(mascararNome('ROBERTO DA SILVA OLIVEIRA')).toBe('Roberto D. S. O.');
  });

  it('funciona com nome de uma palavra so', () => {
    expect(mascararNome('MADONNA')).toBe('Madonna');
  });

  it('nao vaza o sobrenome inteiro — a pagina e publica', () => {
    const mascarado = mascararNome('Fernanda Ribeiro Sousa');
    expect(mascarado).toBe('Fernanda R. S.');
    expect(mascarado).not.toContain('Ribeiro');
    expect(mascarado).not.toContain('Sousa');
  });

  it('nao quebra com vazio', () => {
    expect(mascararNome('')).toBe('—');
    expect(mascararNome(null)).toBe('—');
    expect(mascararNome('   ')).toBe('—');
  });
});

describe('descreverTipo', () => {
  it('traduz os tipos conhecidos', () => {
    expect(descreverTipo('aso')).toContain('A.S.O.');
    expect(descreverTipo('guia_exame')).toBe('Guia de exame');
  });

  it('tipo desconhecido nao vira erro nem vaza o codigo interno', () => {
    expect(descreverTipo('coisa_nova')).toBe('Documento');
    expect(descreverTipo(null)).toBe('Documento');
  });
});

describe('montarResposta', () => {
  const linha: LinhaDeDocumento = {
    kind: 'aso',
    // Titulo distinto do rotulo do tipo, de proposito: e assim que da para
    // provar que ele nao e ecoado na resposta.
    title: 'ASO — apto com restrição — ENGECALHAS',
    generated_at: '2026-09-09T15:00:00Z',
    deleted_at: null,
    signer_name: 'Wania Sanches Picasso',
    signer_council: 'CRM 79775/SP',
    patients: { full_name: 'ROBERTO DA SILVA OLIVEIRA' },
  };

  it('documento existente e autentico', () => {
    const r = montarResposta(linha, 'H2 Medicina Ocupacional');
    expect(r.situacao).toBe('autentico');
    expect(r.tipo).toContain('A.S.O.');
    expect(r.paciente).toBe('Roberto D. S. O.');
    expect(r.assinante).toBe('Wania Sanches Picasso');
  });

  it('documento apagado responde cancelado, nao autentico', () => {
    // Revogado nao pode passar por valido para quem esta com o papel.
    const r = montarResposta({ ...linha, deleted_at: '2026-09-10T10:00:00Z' }, 'H2');
    expect(r.situacao).toBe('cancelado');
  });

  it('codigo inexistente responde nao encontrado, sem inventar dado', () => {
    const r = montarResposta(null, 'H2');
    expect(r.situacao).toBe('nao_encontrado');
    expect(r.paciente).toBe('—');
    expect(r.assinante).toBeNull();
  });

  it('a resposta nao carrega nada clinico', () => {
    const r = montarResposta(linha, 'H2');
    const campos = Object.keys(r);
    for (const proibido of ['verdict', 'cpf', 'conclusion', 'exames', 'empresa', 'restrictions']) {
      expect(campos).not.toContain(proibido);
    }
    // Nem o titulo gravado, que em alguns documentos carrega o nome do
    // exame, o parecer ou a empresa.
    expect(campos).not.toContain('titulo');
    expect(campos).not.toContain('title');
    expect(JSON.stringify(r)).not.toContain('restrição');
    expect(JSON.stringify(r)).not.toContain('ENGECALHAS');
  });
});
