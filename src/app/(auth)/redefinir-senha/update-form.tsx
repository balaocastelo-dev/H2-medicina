'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { updatePassword } from '@/modules/auth/actions';
import { Alert, Button, Card, Field, Input } from '@/components/ui';
import type { ActionResult } from '@/lib/action-result';

export function UpdatePasswordForm() {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    updatePassword,
    null,
  );

  return (
    <Card className="p-6">
      <form action={formAction} className="space-y-4">
        {state?.ok && (
          <Alert variant="success">
            {state.message}{' '}
            <Link href="/login" className="font-medium underline">
              Ir para o login
            </Link>
          </Alert>
        )}
        {state && !state.ok && <Alert variant="error">{state.error}</Alert>}
        <Field label="Nova senha" htmlFor="password" required>
          <Input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
          />
        </Field>
        <Field label="Confirmar senha" htmlFor="confirm" required>
          <Input
            id="confirm"
            name="confirm"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
          />
        </Field>
        <Button type="submit" className="w-full" loading={pending}>
          Salvar nova senha
        </Button>
      </form>
    </Card>
  );
}
