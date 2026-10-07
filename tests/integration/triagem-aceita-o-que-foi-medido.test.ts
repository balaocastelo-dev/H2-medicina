/**
 * O banco tambem aceita o que foi medido.
 *
 *     06/10/2026 08:35 - Isa: sabe aqueles limites de valores da triagem?
 *                             precisa tirar esses limites
 *
 * Os limites estavam em TRES camadas, e este teste existe por causa da
 * terceira. Tirar so o zod da tela (tests/unit/triagem-sem-limites.test.ts)
 * trocaria a mensagem no campo por um erro cru do Postgres:
 *
 *   - `triages_bp_sane`       recusava PA fora de 40..300 / 20..200
 *   - `triages_saturation_sane` recusava SpO2 fora de 30..100
 *   - `temperature_c numeric(4,1)` estoura em 1000
 *   - `bmi numeric(5,2)` — coluna GERADA — estoura quando a altura vem em
 *     metros: 78 kg com 1,75 "cm" da IMC 254.693
 *
 * O ultimo era o pior: o campo que estoura nao e o que a enfermagem digitou,
 * e um derivado que ela nem ve. A triagem inteira seria recusada por causa
 * dele.
 *
 * Este teste roda num Postgres real com as migrations do repositorio.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { montarAmbiente, type Ambiente } from './ambiente';

let amb: Ambiente;
let paciente = '';

beforeAll(async () => {
  amb = await montarAmbiente();
  paciente = (
    await amb.um<{ id: string }>(
      `insert into public.patients (tenant_id, full_name)
       values ('${amb.tenant}', 'Paciente da triagem sem limites') returning id`,
    )
  ).id;
}, 180_000);

afterAll(async () => {
  await amb?.fechar();
});

/** Uma triagem nova (a tabela tem unique por atendimento). */
async function gravarTriagem(campos: Record<string, number>): Promise<void> {
  const at = (
    await amb.um<{ id: string }>(
      `insert into public.attendances (tenant_id, patient_id, stage_code)
       values ('${amb.tenant}', '${paciente}', 'na_triagem') returning id`,
    )
  ).id;
  const colunas = Object.keys(campos);
  const valores = colunas.map((c) => String(campos[c]));
  await amb.db.exec(
    `insert into public.triages (tenant_id, attendance_id, patient_id, ${colunas.join(', ')})
     values ('${amb.tenant}', '${at}', '${paciente}', ${valores.join(', ')})`,
  );
}

describe('o banco grava o valor que foi medido', () => {
  it('PA de 310 por 220', async () => {
    await expect(
      gravarTriagem({ blood_pressure_systolic: 310, blood_pressure_diastolic: 220 }),
    ).resolves.toBeUndefined();
  });

  it('saturação de 25%', async () => {
    await expect(gravarTriagem({ oxygen_saturation: 25 })).resolves.toBeUndefined();
  });

  it('temperatura de 46 graus', async () => {
    await expect(gravarTriagem({ temperature_c: 46 })).resolves.toBeUndefined();
  });

  it('peso de 420 kg', async () => {
    await expect(gravarTriagem({ weight_kg: 420 })).resolves.toBeUndefined();
  });

  it('altura digitada em metros não derruba a triagem', async () => {
    // O IMC derivado daria 254.693 e estourava a coluna gerada. Agora a
    // triagem entra e o IMC fica nulo — o peso e a altura ficam gravados
    // exatamente como foram digitados.
    await expect(gravarTriagem({ weight_kg: 78, height_cm: 1.75 })).resolves.toBeUndefined();

    const r = await amb.um<{ bmi: number | null; height_cm: string }>(
      `select bmi, height_cm from public.triages
        where patient_id = '${paciente}' and height_cm = 1.8
        order by created_at desc limit 1`,
    );
    // numeric(9,1) arredonda 1,75 para 1,8 — a precisao da coluna, que nao
    // mudou. O que importa: a linha existe e o IMC nao estourou.
    expect(r).toBeTruthy();
    expect(r.bmi).toBeNull();
  });

  it('o IMC normal continua sendo calculado', async () => {
    await gravarTriagem({ weight_kg: 78.4, height_cm: 175 });
    const r = await amb.um<{ bmi: string }>(
      `select bmi from public.triages
        where patient_id = '${paciente}' and height_cm = 175 limit 1`,
    );
    expect(Number(r.bmi)).toBeCloseTo(25.6, 1);
  });
});

describe('as travas de faixa saíram da tabela', () => {
  it('não há mais constraint de PA nem de saturação', async () => {
    const r = await amb.db.query<{ conname: string }>(`
      select conname from pg_constraint
       where conrelid = 'public.triages'::regclass
         and conname in ('triages_bp_sane', 'triages_saturation_sane')`);
    expect(r.rows).toHaveLength(0);
  });
});
