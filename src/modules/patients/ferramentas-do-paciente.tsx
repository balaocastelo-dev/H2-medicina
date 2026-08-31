'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Merge, Paperclip, Trash2, Upload } from 'lucide-react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Select,
} from '@/components/ui';
import { formatCPF, formatDate } from '@/lib/format';
import { findMergeCandidates, mergePatients, softDeletePatient } from './actions';
import { anexarExame, removerAnexo, urlDoAnexo } from './anexos-actions';
import type { ActionResult } from '@/lib/action-result';

export interface AnexoDoPaciente {
  id: string;
  title: string;
  description: string | null;
  created_at: string;
  exam_types: { name: string } | null;
}

interface Candidato {
  id: string;
  full_name: string;
  cpf: string | null;
  rule: string;
}

const REGRA: Record<string, string> = {
  cpf: 'mesmo CPF',
  nome_nascimento: 'mesmo nome e nascimento',
};

/** Laudos anexados ao cadastro, com download por link assinado. */
export function ListaDeAnexos({
  anexos,
  podeRemover = false,
}: {
  anexos: AnexoDoPaciente[];
  podeRemover?: boolean;
}) {
  const [pendente, iniciar] = useTransition();

  if (anexos.length === 0) {
    return <p className="text-sm text-slate-500">Nenhum exame anexado.</p>;
  }

  return (
    <ul className="divide-y divide-slate-100">
      {anexos.map((a) => (
        <li key={a.id} className="flex items-start justify-between gap-2 py-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1 truncate text-sm font-medium">
              <Paperclip className="h-3 w-3 shrink-0 text-slate-400" />
              {a.title}
            </p>
            <p className="truncate text-xs text-slate-500">
              {[a.exam_types?.name, a.description, formatDate(a.created_at)]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button
              size="sm"
              variant="ghost"
              loading={pendente}
              onClick={() =>
                iniciar(async () => {
                  const r = await urlDoAnexo(a.id);
                  if (r.ok && r.data) window.open(r.data.url, '_blank', 'noopener');
                  else if (!r.ok) window.alert(r.error);
                })
              }
            >
              <Download className="h-4 w-4" />
            </Button>
            {podeRemover && (
              <Button
                size="sm"
                variant="ghost"
                loading={pendente}
                onClick={() => {
                  if (!window.confirm(`Remover o anexo "${a.title}"?`)) return;
                  iniciar(() => void removerAnexo(a.id));
                }}
              >
                <Trash2 className="h-4 w-4 text-red-600" />
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Acoes do cadastro que nao cabem no formulario: anexar laudo que chegou
 * depois, unificar cadastros duplicados e excluir o paciente.
 */
export function FerramentasDoPaciente({
  patientId,
  patientName,
  examTypes,
  podeEditar,
  podeExcluir,
}: {
  patientId: string;
  patientName: string;
  examTypes: { id: string; name: string }[];
  podeEditar: boolean;
  podeExcluir: boolean;
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  const [envio, enviarAnexo, enviando] = useActionState<ActionResult | null, FormData>(
    anexarExame.bind(null, patientId),
    null,
  );

  useEffect(() => {
    if (!podeEditar) return;
    let ativo = true;
    void (async () => {
      const r = await findMergeCandidates(patientId);
      if (ativo && r.ok) setCandidatos(r.data ?? []);
    })();
    return () => {
      ativo = false;
    };
  }, [patientId, podeEditar]);

  return (
    <div className="space-y-4">
      {podeEditar && (
        <Card>
          <CardHeader
            title="Anexar exame"
            description="Para laudos que chegam dias depois do atendimento"
          />
          <CardBody>
            <form action={enviarAnexo} className="space-y-3">
              {envio?.ok && <Alert variant="success">{envio.message}</Alert>}
              {envio && !envio.ok && <Alert variant="error">{envio.error}</Alert>}

              <Field label="Arquivo" required>
                <Input
                  type="file"
                  name="arquivo"
                  required
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx"
                />
              </Field>
              <Field label="Título" hint="Em branco, usa o nome do arquivo">
                <Input name="titulo" placeholder="Ex.: Raio X de tórax" />
              </Field>
              <Field label="Exame relacionado">
                <Select name="exam_type_id" defaultValue="">
                  <option value="">Não vincular</option>
                  {examTypes.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button type="submit" size="sm" loading={enviando}>
                <Upload className="h-4 w-4" /> Enviar laudo
              </Button>
            </form>
          </CardBody>
        </Card>
      )}

      {podeEditar && candidatos.length > 0 && (
        <Card>
          <CardHeader
            title="Cadastros semelhantes"
            description="Unifique para o paciente ter um histórico só"
          />
          <CardBody className="space-y-3">
            {aviso && <Alert variant={aviso.ok ? 'success' : 'error'}>{aviso.texto}</Alert>}
            {candidatos.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.full_name}</p>
                  <p className="text-xs text-slate-600">
                    {c.cpf ? formatCPF(c.cpf) : 'sem CPF'} · {REGRA[c.rule] ?? c.rule}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  loading={pendente}
                  onClick={() => {
                    if (
                      !window.confirm(
                        `Mover todo o histórico de "${c.full_name}" para "${patientName}"? O cadastro duplicado será arquivado.`,
                      )
                    ) {
                      return;
                    }
                    iniciar(async () => {
                      const r = await mergePatients(c.id, patientId);
                      setAviso({
                        ok: r.ok,
                        texto: r.ok ? (r.message ?? 'Unificado.') : r.error,
                      });
                      if (r.ok) {
                        setCandidatos((atual) => atual.filter((x) => x.id !== c.id));
                        router.refresh();
                      }
                    });
                  }}
                >
                  <Merge className="h-4 w-4" /> Unificar aqui
                </Button>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      {podeExcluir && (
        <Card>
          <CardHeader
            title="Excluir paciente"
            description="O histórico continua registrado na auditoria"
          />
          <CardBody>
            <Button
              variant="danger"
              size="sm"
              loading={pendente}
              onClick={() => {
                if (!window.confirm(`Excluir o cadastro de "${patientName}"?`)) return;
                iniciar(async () => {
                  const r = await softDeletePatient(patientId);
                  if (r.ok) router.push('/pacientes');
                  else setAviso({ ok: false, texto: r.error });
                });
              }}
            >
              <Trash2 className="h-4 w-4" /> Excluir paciente
            </Button>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
