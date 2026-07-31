'use client';

import { useActionState, useState, useTransition } from 'react';
import { Copy, QrCode } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Select,
} from '@/components/ui';
import {
  cancelPayment,
  confirmPayment,
  createCharge,
  refundPayment,
} from '@/modules/finance/actions';
import type { ActionResult } from '@/lib/action-result';
import type { Payment } from '@/types/entities';
import type { PaymentRow } from './page';

export function NewChargeCard({ hasPixKey }: { hasPixKey: boolean }) {
  const [state, formAction, pending] = useActionState<ActionResult<Payment> | null, FormData>(
    createCharge,
    null,
  );
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <Card>
      <CardHeader
        title="Nova cobranca"
        description="Pix, cartao, dinheiro, faturamento ou cortesia"
      />
      <CardBody>
        {!hasPixKey && (
          <div className="mb-3">
            <Alert variant="warning">
              Chave Pix nao configurada. Cobrancas Pix serao criadas sem QR Code ate configurar em
              Configuracoes → Pagamento e Pix.
            </Alert>
          </div>
        )}
        <form action={formAction} className="grid gap-3 md:grid-cols-5">
          {state?.ok && (
            <div className="md:col-span-5">
              <Alert variant="success">{state.message}</Alert>
            </div>
          )}
          {state && !state.ok && (
            <div className="md:col-span-5">
              <Alert variant="error">{state.error}</Alert>
            </div>
          )}
          <Field label="Descricao" error={errors?.description} className="md:col-span-2">
            <Input name="description" required placeholder="Ex.: Exame admissional" />
          </Field>
          <Field label="Valor" error={errors?.amount}>
            <Input name="amount" type="number" step="0.01" min="0.01" required />
          </Field>
          <Field label="Desconto">
            <Input name="discount" type="number" step="0.01" min="0" defaultValue="0" />
          </Field>
          <Field label="Metodo" error={errors?.method}>
            <Select name="method" defaultValue="pix">
              <option value="pix">Pix</option>
              <option value="cartao">Cartao</option>
              <option value="dinheiro">Dinheiro</option>
              <option value="link">Link de pagamento</option>
              <option value="faturamento">Faturamento empresarial</option>
              <option value="manual">Manual</option>
              <option value="cortesia">Cortesia</option>
            </Select>
          </Field>
          <div className="md:col-span-5">
            <Button type="submit" loading={pending}>
              Criar cobranca
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

export function PaymentActions({
  payment,
  canRegister,
  canRefund,
}: {
  payment: PaymentRow;
  canRegister: boolean;
  canRefund: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [showPix, setShowPix] = useState(false);
  const pix = payment.pix_charges?.[0];

  return (
    <div className="flex flex-wrap items-center gap-1">
      {pix && (
        <Button size="sm" variant="outline" onClick={() => setShowPix((v) => !v)}>
          <QrCode className="h-4 w-4" />
        </Button>
      )}

      {canRegister && payment.status === 'pendente' && (
        <Button
          size="sm"
          variant="success"
          loading={pending}
          onClick={() => startTransition(() => void confirmPayment(payment.id))}
        >
          Confirmar
        </Button>
      )}

      {canRegister && payment.status === 'pendente' && (
        <Button
          size="sm"
          variant="ghost"
          loading={pending}
          onClick={() => {
            if (window.confirm('Cancelar esta cobranca?')) {
              startTransition(() => void cancelPayment(payment.id));
            }
          }}
        >
          Cancelar
        </Button>
      )}

      {canRefund && payment.status === 'pago' && (
        <Button
          size="sm"
          variant="danger"
          loading={pending}
          onClick={() => {
            const reason = window.prompt('Motivo do estorno:');
            if (reason) startTransition(() => void refundPayment(payment.id, reason));
          }}
        >
          Estornar
        </Button>
      )}

      {showPix && pix && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-sm p-5 text-center">
            <Badge color="#22C55E">Pix</Badge>
            {pix.qrcode_data_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={pix.qrcode_data_url} alt="QR Code Pix" className="mx-auto my-3 h-56 w-56" />
            )}
            <p className="mb-1 text-xs text-slate-500">Pix copia e cola</p>
            <textarea
              readOnly
              value={pix.payload}
              className="h-24 w-full rounded border border-slate-200 p-2 font-mono text-[10px]"
            />
            <div className="mt-3 flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => void navigator.clipboard.writeText(pix.payload)}
              >
                <Copy className="h-4 w-4" /> Copiar
              </Button>
              <Button className="flex-1" onClick={() => setShowPix(false)}>
                Fechar
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
