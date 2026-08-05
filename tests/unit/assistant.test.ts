import { describe, expect, it } from 'vitest';
import {
  acharSala, extrairConselho, extrairCpf, extrairNomePessoa, extrairValor, interpretar,
} from '@/modules/assistant/intents';

const salas = [
  { id: 's1', nome: 'Sala de Audiometria', codigo: 'AUD' },
  { id: 's2', nome: 'Sala de Eletroencefalograma', codigo: 'EEG' },
  { id: 's3', nome: 'Consultorio Medico', codigo: 'CON' },
  { id: 's4', nome: 'Coleta Laboratorial', codigo: 'LAB' },
];
const ctx = { salas };

describe('extracao de dados', () => {
  it('le CPF em varios formatos', () => {
    expect(extrairCpf('cpf 529.982.247-25')).toBe('52998224725');
    expect(extrairCpf('paciente do cpf 22804243800 hoje')).toBe('22804243800');
    expect(extrairCpf('sem documento')).toBeNull();
  });

  it('le valores em reais', () => {
    expect(extrairValor('no valor de 200,00')).toBe(200);
    expect(extrairValor('R$ 1.250,50')).toBe(1250.5);
    expect(extrairValor('valor 200')).toBe(200);
    expect(extrairValor('sem valor')).toBeNull();
  });

  it('nao confunde CPF com valor', () => {
    expect(extrairValor('cobranca para o cpf 22804243800 no valor de 200,00')).toBe(200);
  });

  it('le conselho profissional', () => {
    expect(extrairConselho('crm 00002520')).toMatchObject({ tipo: 'CRM', numero: '00002520' });
    expect(extrairConselho('CRM/SP 123456')).toMatchObject({ tipo: 'CRM', uf: 'SP' });
    expect(extrairConselho('sem registro').numero).toBeNull();
  });

  it('le o nome do profissional', () => {
    expect(extrairNomePessoa('cadastrar o medico dr miguel crm 00002520')).toBe('Miguel');
    expect(extrairNomePessoa('cadastrar a medica dra wania sanches')).toBe('Wania Sanches');
  });
});

describe('escolha da sala', () => {
  it('acha por nome parcial', () => {
    expect(acharSala('audiometria', salas)?.id).toBe('s1');
    expect(acharSala('eletroencefalograma', salas)?.id).toBe('s2');
  });

  it('acha pelo codigo', () => {
    expect(acharSala('eeg', salas)?.id).toBe('s2');
  });

  it('devolve nulo quando nao ha correspondencia', () => {
    expect(acharSala('radiologia intervencionista', salas)).toBeNull();
  });
});

describe('interpretacao de comandos', () => {
  it('chama o proximo da fila', () => {
    const r = interpretar('chama o proximo da fila na sala de audiometria', ctx);
    expect(r.intencao.tipo).toBe('chamar_proximo');
    if (r.intencao.tipo === 'chamar_proximo') expect(r.intencao.salaId).toBe('s1');
    expect(r.permissao).toBe('filas.operar');
  });

  it('avisa quando a sala nao existe', () => {
    const r = interpretar('chamar o proximo da fila na sala de neurologia', ctx);
    expect(r.intencao.tipo).toBe('desconhecida');
    if (r.intencao.tipo === 'desconhecida') expect(r.intencao.sugestoes.length).toBeGreaterThan(0);
  });

  it('cria cobranca com CPF e valor', () => {
    const r = interpretar(
      'criar uma cobranca para o paciente do cpf 22804243800 no valor de 200,00',
      ctx,
    );
    expect(r.intencao.tipo).toBe('criar_cobranca');
    if (r.intencao.tipo === 'criar_cobranca') {
      expect(r.intencao.cpf).toBe('22804243800');
      expect(r.intencao.valor).toBe(200);
      expect(r.intencao.metodo).toBe('pix');
    }
    expect(r.permissao).toBe('financeiro.registrar');
  });

  it('reconhece o metodo de pagamento', () => {
    const r = interpretar('criar cobranca no cartao para o cpf 22804243800 valor 150', ctx);
    if (r.intencao.tipo === 'criar_cobranca') expect(r.intencao.metodo).toBe('cartao');
  });

  it('exige CPF na cobranca', () => {
    const r = interpretar('criar uma cobranca de 200 reais', ctx);
    expect(r.intencao.tipo).toBe('desconhecida');
  });

  it('cadastra medico com CRM', () => {
    const r = interpretar('criar um cadastro medico para o medico dr miguel crm 00002520', ctx);
    expect(r.intencao.tipo).toBe('criar_profissional');
    if (r.intencao.tipo === 'criar_profissional') {
      expect(r.intencao.nome).toBe('Miguel');
      expect(r.intencao.papel).toBe('medico_examinador');
      expect(r.intencao.conselhoNumero).toBe('00002520');
    }
    expect(r.permissao).toBe('usuarios.administrar');
  });

  it('cadastra atendente', () => {
    const r = interpretar('cadastrar a atendente carla souza', ctx);
    if (r.intencao.tipo === 'criar_profissional') expect(r.intencao.papel).toBe('atendimento');
  });

  it('busca paciente', () => {
    const r = interpretar('buscar paciente maria', ctx);
    expect(r.intencao.tipo).toBe('buscar_paciente');
    if (r.intencao.tipo === 'buscar_paciente') expect(r.intencao.termo).toBe('maria');
  });

  it('responde ajuda', () => {
    expect(interpretar('ajuda', ctx).intencao.tipo).toBe('ajuda');
  });

  it('admite quando nao entende', () => {
    const r = interpretar('faca um cafe por favor', ctx);
    expect(r.intencao.tipo).toBe('desconhecida');
  });

  it('e deterministico', () => {
    const frase = 'criar cobranca para o cpf 22804243800 no valor de 200,00';
    expect(JSON.stringify(interpretar(frase, ctx))).toBe(JSON.stringify(interpretar(frase, ctx)));
  });
});
