'use client';

import { useActionState } from 'react';
import { requestPasswordReset } from '@/modules/auth/actions';
import { Alert, Button, Card, Field, Input } from '@/components/ui';
import type { ActionResult } from '@/lib/action-result';

export function ResetForm() {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    requestPasswordReset,
    null,
  );

  return (
    <Card className="p-6">
      <form action={formAction} className="space-y-4">
        {state?.ok && <Alert variant="success">{state.message}</Alert>}
        {state && !state.ok && <Alert variant="error">{state.error}</Alert>}
        <Field label="E-mail" htmlFor="email" required>
          <Input id="email" name="email" type="email" required autoComplete="email" />
        </Field>
        <Button type="submit" className="w-full" loading={pending}>
          Enviar instrucoes
        </Button>
      </form>
    </Card>
  );
}
