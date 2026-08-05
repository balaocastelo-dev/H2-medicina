'use client';

import {
  Area, AreaChart, Bar, BarChart, Cell, Legend, Pie, PieChart, PolarAngleAxis,
  RadialBar, RadialBarChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Card, CardHeader, EmptyState } from '@/components/ui';

export interface Fatia {
  nome: string;
  valor: number;
  cor: string;
}
export interface PontoHora {
  hora: string;
  chegadas: number;
}
export interface BarraEmpresa {
  empresa: string;
  atendimentos: number;
}
export interface BarraExame {
  exame: string;
  concluidos: number;
  pendentes: number;
}

const eixo = { fontSize: 11, fill: '#64748B' };

const caixaTooltip = {
  contentStyle: {
    borderRadius: 10,
    border: '1px solid #E2E8F0',
    fontSize: 12,
    boxShadow: '0 4px 12px rgba(15,23,42,.08)',
  },
};

/** Rosca com o total no centro. */
export function RoscaEtapas({ dados, total }: { dados: Fatia[]; total: number }) {
  return (
    <Card>
      <CardHeader title="Pacientes por etapa" description="Jornada aberta agora" />
      {dados.length === 0 ? (
        <EmptyState title="Nenhum paciente em atendimento" />
      ) : (
        <div className="relative p-4">
          <ResponsiveContainer width="100%" height={230}>
            <PieChart>
              <Pie
                data={dados}
                dataKey="valor"
                nameKey="nome"
                innerRadius={62}
                outerRadius={92}
                paddingAngle={2}
                stroke="none"
              >
                {dados.map((d) => (
                  <Cell key={d.nome} fill={d.cor} />
                ))}
              </Pie>
              <Tooltip {...caixaTooltip} />
              <Legend
                verticalAlign="bottom"
                iconType="circle"
                iconSize={8}
                formatter={(v) => <span style={{ fontSize: 11, color: '#475569' }}>{v}</span>}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-x-0 top-[86px] text-center">
            <p className="text-3xl font-bold text-slate-900">{total}</p>
            <p className="text-[11px] tracking-wide text-slate-500 uppercase">na clinica</p>
          </div>
        </div>
      )}
    </Card>
  );
}

/** Curva de chegadas ao longo do dia. */
export function CurvaChegadas({ dados, cor }: { dados: PontoHora[]; cor: string }) {
  const total = dados.reduce((s, d) => s + d.chegadas, 0);
  return (
    <Card>
      <CardHeader
        title="Chegadas ao longo do dia"
        description={total > 0 ? `${total} check-ins hoje` : 'Sem check-ins ainda'}
      />
      <div className="p-4 pt-2">
        <ResponsiveContainer width="100%" height={230}>
          <AreaChart data={dados} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
            <defs>
              <linearGradient id="gradChegadas" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={cor} stopOpacity={0.35} />
                <stop offset="100%" stopColor={cor} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis dataKey="hora" tick={eixo} tickLine={false} axisLine={false} />
            <YAxis tick={eixo} tickLine={false} axisLine={false} allowDecimals={false} width={34} />
            <Tooltip {...caixaTooltip} />
            <Area
              type="monotone"
              dataKey="chegadas"
              name="Chegadas"
              stroke={cor}
              strokeWidth={2.5}
              fill="url(#gradChegadas)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

/** Barras horizontais por empresa. */
export function BarrasEmpresas({ dados, cor }: { dados: BarraEmpresa[]; cor: string }) {
  return (
    <Card>
      <CardHeader title="Atendimentos por empresa" description="Ultimos 30 dias" />
      {dados.length === 0 ? (
        <EmptyState title="Sem atendimentos no periodo" />
      ) : (
        <div className="p-4 pt-2">
          <ResponsiveContainer width="100%" height={Math.max(180, dados.length * 42)}>
            <BarChart data={dados} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
              <XAxis type="number" tick={eixo} tickLine={false} axisLine={false} allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="empresa"
                tick={{ ...eixo, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={120}
              />
              <Tooltip {...caixaTooltip} cursor={{ fill: 'rgba(148,163,184,.12)' }} />
              <Bar dataKey="atendimentos" name="Atendimentos" fill={cor} radius={[0, 6, 6, 0]} barSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

/** Barras empilhadas: exames concluidos x pendentes. */
export function BarrasExames({ dados }: { dados: BarraExame[] }) {
  return (
    <Card>
      <CardHeader title="Exames do dia" description="Concluidos e ainda pendentes" />
      {dados.length === 0 ? (
        <EmptyState title="Nenhum exame na fila hoje" />
      ) : (
        <div className="p-4 pt-2">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={dados} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
              <XAxis
                dataKey="exame"
                tick={{ ...eixo, fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                interval={0}
                angle={-18}
                textAnchor="end"
                height={54}
              />
              <YAxis tick={eixo} tickLine={false} axisLine={false} allowDecimals={false} width={34} />
              <Tooltip {...caixaTooltip} cursor={{ fill: 'rgba(148,163,184,.12)' }} />
              <Legend
                iconType="circle"
                iconSize={8}
                formatter={(v) => <span style={{ fontSize: 11, color: '#475569' }}>{v}</span>}
              />
              <Bar dataKey="concluidos" name="Concluidos" stackId="e" fill="#22C55E" radius={[0, 0, 4, 4]} barSize={26} />
              <Bar dataKey="pendentes" name="Pendentes" stackId="e" fill="#FB923C" radius={[4, 4, 0, 0]} barSize={26} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

/** Velocimetro de ocupacao das salas. */
export function OcupacaoSalas({
  ocupadas,
  total,
  cor,
}: {
  ocupadas: number;
  total: number;
  cor: string;
}) {
  const percentual = total > 0 ? Math.round((ocupadas / total) * 100) : 0;
  const dados = [{ nome: 'ocupacao', valor: percentual, fill: cor }];

  return (
    <Card>
      <CardHeader title="Ocupacao das salas" description={`${ocupadas} de ${total} em uso`} />
      <div className="relative p-4">
        <ResponsiveContainer width="100%" height={190}>
          <RadialBarChart
            data={dados}
            innerRadius="72%"
            outerRadius="100%"
            startAngle={210}
            endAngle={-30}
          >
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar dataKey="valor" background={{ fill: '#E2E8F0' }} cornerRadius={12} />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-x-0 top-[92px] text-center">
          <p className="text-3xl font-bold" style={{ color: cor }}>
            {percentual}%
          </p>
          <p className="text-[11px] text-slate-500">ocupacao</p>
        </div>
      </div>
    </Card>
  );
}
