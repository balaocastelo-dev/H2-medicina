import { describe, expect, it } from 'vitest';
import {
  MEDICOS_INICIAIS,
  acessoPendente,
  emailProvisorio,
} from '@/modules/users/medicos-iniciais';

describe('lista inicial', () => {
  it('traz os oito medicos informados', () => {
    expect(MEDICOS_INICIAIS).toHaveLength(8);
  });

  it('nao repete registro', () => {
    const registros = MEDICOS_INICIAIS.map((m) => `${m.conselho}${m.numero}`);
    expect(new Set(registros).size).toBe(registros.length);
  });

  it('todo mundo tem nome e numero', () => {
    for (const m of MEDICOS_INICIAIS) {
      expect(m.nome.trim().length).toBeGreaterThan(3);
      expect(m.numero).toMatch(/^\d+$/);
    }
  });
});

describe('emailProvisorio', () => {
  it('deriva do registro e do dominio da clinica', () => {
    expect(emailProvisorio('CRM', '79775', 'h2medicina.com.br')).toBe(
      'crm79775@pendente.h2medicina.com.br',
    );
  });

  it('aguenta dominio com protocolo e caminho', () => {
    expect(emailProvisorio('CRM', '1', 'https://exemplo.com/x')).toBe('crm1@pendente.exemplo.com');
  });

  it('cai num dominio local quando nao ha dominio configurado', () => {
    expect(emailProvisorio('CRM', '1', '')).toBe('crm1@pendente.local');
  });

  it('gera endereco unico para cada medico da lista', () => {
    const enderecos = MEDICOS_INICIAIS.map((m) => emailProvisorio(m.conselho, m.numero, 'x.com'));
    expect(new Set(enderecos).size).toBe(enderecos.length);
  });
});

describe('acessoPendente', () => {
  it('reconhece quem ainda nao definiu o acesso', () => {
    expect(acessoPendente('crm79775@pendente.x.com')).toBe(true);
    expect(acessoPendente('wania@h2.com')).toBe(false);
    expect(acessoPendente(null)).toBe(false);
  });
});
