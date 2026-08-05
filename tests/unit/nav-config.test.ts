import { describe, expect, it } from 'vitest';
import { NAV_GROUPS, FULLSCREEN_LINKS } from '@/components/layout/nav-config';

const itens = NAV_GROUPS.flatMap((g) => g.items);

describe('menu do painel', () => {
  it('liga o contador nas telas de operação', () => {
    const esperado: Record<string, string> = {
      '/crm': 'crm',
      '/recepcao': 'recepcao',
      '/triagem': 'triagem',
      '/filas': 'filas',
      '/medico': 'medico',
    };
    for (const [href, chave] of Object.entries(esperado)) {
      const item = itens.find((i) => i.href === href);
      expect(item, `item ${href} deveria existir`).toBeDefined();
      expect(item?.badge, `item ${href} deveria ter badge`).toBe(chave);
    }
  });

  it('não põe contador onde não há fila para acompanhar', () => {
    expect(itens.find((i) => i.href === '/dashboard')?.badge).toBeUndefined();
    expect(itens.find((i) => i.href === '/logs')?.badge).toBeUndefined();
  });

  it('usa acentuação correta nos rótulos', () => {
    const rotulos = [...itens.map((i) => i.label), ...NAV_GROUPS.map((g) => g.title)];
    const semAcento = rotulos.filter((r) =>
      /\b(Operacao|Recepcao|Automacao|Administracao|Configuracoes|Execucoes|Revisao|Relatorios|Usuarios|Medico|Modulo|Importacao|Permissoes|Proximo)\b/i.test(
        r,
      ),
    );
    expect(semAcento, `rótulos sem acento: ${semAcento.join(', ')}`).toHaveLength(0);
  });

  it('cada item aponta para uma rota única', () => {
    const hrefs = [...itens, ...FULLSCREEN_LINKS].map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});
