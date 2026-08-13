import { describe, expect, it } from 'vitest';
import {
  GRADE_PADRAO,
  diaDaSemana,
  diaEmSaoPaulo,
  diasDisponiveis,
  gerarCodigo,
  horaEmSaoPaulo,
  horarioEhValido,
  instanteDe,
  lerConfiguracao,
  somarDias,
} from '@/modules/scheduling/grade-publica';

/** 13/08/2026 é uma quinta-feira. 10:00 em Brasília = 13:00 UTC. */
const AGORA = new Date('2026-08-13T13:00:00.000Z');

const config = {
  ...GRADE_PADRAO,
  grade: ['08:00', '09:00', '10:00', '14:00'],
  diasUteis: [1, 2, 3, 4, 5],
  diasDeAntecedencia: 0,
  janelaDeDias: 6,
};

describe('fuso da clínica', () => {
  it('usa o horário de Brasília, não o do servidor', () => {
    // O servidor da Vercel roda em UTC; sem isso a agenda viraria o dia
    // errado depois das 21h.
    expect(diaEmSaoPaulo(new Date('2026-08-14T02:00:00.000Z'))).toBe('2026-08-13');
    expect(horaEmSaoPaulo(new Date('2026-08-13T13:00:00.000Z'))).toBe('10:00');
  });

  it('converte dia e hora da clínica para o instante correto', () => {
    expect(instanteDe('2026-08-20', '08:00').toISOString()).toBe('2026-08-20T11:00:00.000Z');
  });

  it('conta o dia da semana no padrão ISO', () => {
    expect(diaDaSemana('2026-08-13')).toBe(4); // quinta
    expect(diaDaSemana('2026-08-16')).toBe(7); // domingo
  });

  it('soma dias sem escorregar de mês', () => {
    expect(somarDias('2026-08-30', 3)).toBe('2026-09-02');
    expect(somarDias('2026-01-01', -1)).toBe('2025-12-31');
  });
});

describe('configuração da grade', () => {
  it('cai no padrão quando não há nada gravado', () => {
    const c = lerConfiguracao(null);
    expect(c.ativo).toBe(true);
    expect(c.grade).toEqual(GRADE_PADRAO.grade);
    expect(c.diasUteis).toEqual([1, 2, 3, 4, 5]);
  });

  it('descarta horário mal formatado em vez de aceitar', () => {
    // "25:99" tem o formato certo e não existe: só o formato não basta.
    const c = lerConfiguracao({ grade: ['08:00', 'meio-dia', '25:99', '09:30'] });
    expect(c.grade).toEqual(['08:00', '09:30']);
  });

  it('limita a janela para a agenda não abrir anos à frente', () => {
    expect(lerConfiguracao({ janela_de_dias: 9999 }).janelaDeDias).toBe(180);
  });

  it('respeita o desligamento da página', () => {
    expect(lerConfiguracao({ ativo: false }).ativo).toBe(false);
  });
});

describe('dias e horários livres', () => {
  it('não oferece horário que já passou hoje', () => {
    const dias = diasDisponiveis({ config, ocupados: [], agora: AGORA });
    const hoje = dias.find((d) => d.data === '2026-08-13');
    // São 10:00 em Brasília: 08:00, 09:00 e 10:00 já foram.
    expect(hoje?.horarios).toEqual(['14:00']);
  });

  it('não oferece horário já tomado', () => {
    const dias = diasDisponiveis({
      config,
      ocupados: [instanteDe('2026-08-14', '09:00').toISOString()],
      agora: AGORA,
    });
    const amanha = dias.find((d) => d.data === '2026-08-14');
    expect(amanha?.horarios).toEqual(['08:00', '10:00', '14:00']);
  });

  it('some com o dia inteiro quando não sobra horário', () => {
    const dias = diasDisponiveis({
      config,
      ocupados: ['08:00', '09:00', '10:00', '14:00'].map((h) =>
        instanteDe('2026-08-14', h).toISOString(),
      ),
      agora: AGORA,
    });
    expect(dias.some((d) => d.data === '2026-08-14')).toBe(false);
  });

  it('pula os dias em que a clínica não atende', () => {
    const dias = diasDisponiveis({ config, ocupados: [], agora: AGORA });
    // 15 e 16 de agosto de 2026 são sábado e domingo.
    expect(dias.some((d) => d.data === '2026-08-15')).toBe(false);
    expect(dias.some((d) => d.data === '2026-08-16')).toBe(false);
  });

  it('respeita a antecedência mínima', () => {
    const dias = diasDisponiveis({
      config: { ...config, diasDeAntecedencia: 2 },
      ocupados: [],
      agora: AGORA,
    });
    expect(dias[0]?.data).toBe('2026-08-17'); // 15 e 16 caem no fim de semana
    expect(dias.some((d) => d.data === '2026-08-13')).toBe(false);
    expect(dias.some((d) => d.data === '2026-08-14')).toBe(false);
  });

  it('não abre agenda quando a página está desligada', () => {
    expect(diasDisponiveis({ config: { ...config, ativo: false }, ocupados: [], agora: AGORA }))
      .toEqual([]);
  });
});

describe('validação do horário no servidor', () => {
  const base = { config, ocupados: [] as string[], agora: AGORA };

  it('aceita um horário livre e dentro da grade', () => {
    expect(horarioEhValido({ ...base, data: '2026-08-14', hora: '09:00' })).toEqual({ ok: true });
  });

  it('recusa horário que acabou de ser preenchido', () => {
    const r = horarioEhValido({
      ...base,
      data: '2026-08-14',
      hora: '09:00',
      ocupados: [instanteDe('2026-08-14', '09:00').toISOString()],
    });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.motivo).toContain('acabou de ser preenchido');
  });

  it('recusa horário fora da grade, mesmo que a tela mande', () => {
    // A tela é só uma sugestão: o servidor não pode confiar nela.
    const r = horarioEhValido({ ...base, data: '2026-08-14', hora: '03:00' });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.motivo).toContain('grade');
  });

  it('recusa dia em que a clínica não atende', () => {
    const r = horarioEhValido({ ...base, data: '2026-08-15', hora: '09:00' });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.motivo).toContain('dia da semana');
  });

  it('recusa data no passado', () => {
    const r = horarioEhValido({ ...base, data: '2026-08-01', hora: '09:00' });
    expect(r.ok).toBe(false);
  });

  it('recusa data além da janela aberta', () => {
    // 11/01/2027 é uma segunda-feira: cai na janela, não no dia da semana.
    const r = horarioEhValido({ ...base, data: '2027-01-11', hora: '09:00' });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.motivo).toContain('ainda não está aberta');
  });

  it('cobra a antecedência mínima com mensagem clara', () => {
    const r = horarioEhValido({
      ...base,
      config: { ...config, diasDeAntecedencia: 2 },
      data: '2026-08-14',
      hora: '09:00',
    });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.motivo).toContain('antecedência');
  });
});

describe('código do comprovante', () => {
  it('sai no formato que a pessoa vai ditar por telefone', () => {
    expect(gerarCodigo(() => 0)).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it('não usa letras que se confundem lidas em voz alta', () => {
    const alfabeto = new Set<string>();
    for (let i = 0; i < 400; i += 1) {
      for (const c of gerarCodigo().replace('-', '')) alfabeto.add(c);
    }
    for (const proibido of ['I', 'O', '0', '1']) {
      expect(alfabeto.has(proibido), `${proibido} não deveria aparecer`).toBe(false);
    }
  });

  it('não repete na prática', () => {
    const gerados = new Set(Array.from({ length: 500 }, () => gerarCodigo()));
    expect(gerados.size).toBe(500);
  });
});
