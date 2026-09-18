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

  const examesRaioX = temRaioX ? linhasDe(raioX) : [];
  const examesLab = temLaboratorio ? linhasDe(laboratorio) : [];
  const total = examesRaioX.length + examesLab.length;

  /** Emite uma guia e abre para impressão. Devolve se deu certo. */
  const emitirUma = async (
    lista: string[],
    destino: 'laboratorio' | 'clinica',
  ): Promise<boolean> => {
    const r = await emitirGuiaDeExame({
      attendanceId,
      exames: lista,
      preparos: preparos.trim() || null,
      destino,
    });
    if (!r.ok || !r.data) {
      setMsg({ ok: false, texto: r.ok ? 'Guia não retornou identificador.' : r.error });
      return false;
    }
    // Falhar ao abrir não perde a guia — ela já está salva em Documentos.
    const link = await getDocumentUrl(r.data.documentId);
    if (link.ok && link.data) window.open(link.data.url, '_blank', 'noopener');
    return true;
  };

  /**
   * Uma guia por destino.
   *
   * Raio X é feito no laboratório da Tiradentes; a coleta de sangue é
   * feita aqui na clínica. São papéis diferentes porque mandam o paciente
   * a lugares diferentes — juntar os dois numa guia só faria alguém andar
   * até o laboratório para colher sangue que seria colhido aqui.
   */
  const imprimir = () =>
    iniciar(async () => {
      setMsg(null);
      const emitidas: string[] = [];

      if (examesRaioX.length > 0) {
        if (!(await emitirUma(examesRaioX, 'laboratorio'))) return;
        emitidas.push('Raio X');
      }
      if (examesLab.length > 0) {
        if (!(await emitirUma(examesLab, 'clinica'))) return;
        emitidas.push('coleta laboratorial');
      }

      setMsg({
        ok: true,
        texto:
          emitidas.length > 1
            ? `Duas guias emitidas (${emitidas.join(' e ')}) — os locais são diferentes.`
            : `Guia de ${emitidas[0]} emitida.`,
      });
    });

  return (
    <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50/40 p-3">
      <div>
        <p className="text-sm font-medium text-slate-800">Guia de exame</p>
        <p className="text-xs text-slate-600">
          Descreva o que foi pedido e imprima. O Raio X é feito no laboratório; a coleta de sangue
          é feita aqui, e por isso a guia dela sai com o endereço da clínica.
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
          {total === 0
            ? 'Escreva ao menos um exame para habilitar a impressão.'
            : examesRaioX.length > 0 && examesLab.length > 0
              ? `${total} exames. Saem duas guias: o Raio X vai ao laboratório, a coleta é aqui.`
              : `${total} exame(s) na guia.`}
        </span>
        <Button
          size="sm"
          variant="outline"
          loading={pendente}
          disabled={total === 0}
          onClick={imprimir}
        >
          <Printer className="h-4 w-4" /> Imprimir guia
        </Button>
      </div>
    </div>
  );
}
