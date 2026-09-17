'use client';

import { useState, useTransition } from 'react';
import { Printer } from 'lucide-react';
import { Alert, Button, Textarea } from '@/components/ui';
import { emitirGuiaDeExame } from '@/modules/documents/guia-actions';
import { getDocumentUrl } from '@/modules/documents/actions';

/**
 * Guia de exame feito fora da clinica, emitida no balcao.
 *
 * "se selecionado exames laboratoriais e raio X ja deve ser impresso uma
 *  ficha de solicitacao do exame" e "deve aparecer uma caixa input onde o
 *  usuario descreve os exames que serao solicitados" -- Isabella, 15/09.
 *
 * Raio-X sai com a incidencia escrita a mao pela recepcao tambem: "RX de
 * Torax" e "RX Coluna Lombo-Sacra" sao pedidos diferentes, e o laboratorio
 * precisa saber qual.
 */
export function BlocoGuiaDeExame({
  attendanceId,
  temLaboratorio,
  temRaioX,
}: {
  attendanceId: string;
  temLaboratorio: boolean;
  temRaioX: boolean;
}) {
  const [laboratorio, setLaboratorio] = useState('');
  const [raioX, setRaioX] = useState('');
  const [preparos, setPreparos] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendente, iniciar] = useTransition();

  /** Uma linha por exame: a caixa aceita varios, um por linha ou separados por vírgula. */
  const linhasDe = (texto: string) =>
    texto
      .split(/[\n;,]+/)
      .map((t) => t.trim())
      .filter(Boolean);

  const exames = [
    ...(temRaioX ? linhasDe(raioX) : []),
    ...(temLaboratorio ? linhasDe(laboratorio) : []),
  ];

  const imprimir = () =>
    iniciar(async () => {
      const r = await emitirGuiaDeExame({
        attendanceId,
        exames,
        preparos: preparos.trim() || null,
      });
      if (!r.ok || !r.data) {
        setMsg({ ok: false, texto: r.ok ? 'Guia não retornou identificador.' : r.error });
        return;
      }
      setMsg({ ok: true, texto: 'Guia emitida. Abrindo para impressão…' });
      // Abre numa aba: a recepcao confere e manda imprimir.
      // Falhar aqui nao perde a guia -- ela ja esta salva em Documentos.
      const link = await getDocumentUrl(r.data.documentId);
      if (link.ok && link.data) window.open(link.data.url, '_blank', 'noopener');
      else {
        setMsg({
          ok: false,
          texto: 'Guia salva, mas não abriu sozinha. Abra pela tela de Documentos.',
        });
      }
    });

  return (
    <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50/40 p-3">
      <div>
        <p className="text-sm font-medium text-slate-800">Guia de exame</p>
        <p className="text-xs text-slate-600">
          Estes exames não são feitos na clínica. Descreva o que foi pedido e imprima a guia — o
          paciente leva ao laboratório.
        </p>
      </div>

      {msg && <Alert variant={msg.ok ? 'success' : 'error'}>{msg.texto}</Alert>}

      {temRaioX && (
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">
            Raio X — qual incidência?
          </span>
          <Textarea
            value={raioX}
            onChange={(e) => setRaioX(e.target.value)}
            rows={2}
            placeholder={'RX de Tórax\nRX Coluna Lombo-Sacra'}
          />
        </label>
      )}

      {temLaboratorio && (
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">
            Exames laboratoriais solicitados
          </span>
          <Textarea
            value={laboratorio}
            onChange={(e) => setLaboratorio(e.target.value)}
            rows={3}
            placeholder={'Hemograma completo\nGlicemia de jejum\nColesterol total e frações'}
          />
        </label>
      )}

      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-700">Preparos (opcional)</span>
        <Textarea
          value={preparos}
          onChange={(e) => setPreparos(e.target.value)}
          rows={1}
          placeholder="Jejum de 8 horas"
        />
      </label>

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-slate-500">
          {exames.length === 0
            ? 'Escreva ao menos um exame para habilitar a impressão.'
            : `${exames.length} exame(s) na guia.`}
        </span>
        <Button
          size="sm"
          variant="outline"
          loading={pendente}
          disabled={exames.length === 0}
          onClick={imprimir}
        >
          <Printer className="h-4 w-4" /> Imprimir guia
        </Button>
      </div>
    </div>
  );
}
