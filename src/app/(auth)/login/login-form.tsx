'use client';

import { useActionState } from 'react';
import { signIn } from '@/modules/auth/actions';
import { Alert, Button, Card, Field, Input } from '@/components/ui';
import type { ActionResult } from '@/lib/action-result';

export function LoginForm({ next, primaryColor }: { next?: string; primaryColor: string }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(signIn, null);

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <Card className="p-6" style={{ ['--brand-primary' as string]: primaryColor }}>
      <form action={formAction} className="space-y-4">
        {state && !state.ok && <Alert variant="error">{state.error}</Alert>}

        <Field label="E-mail" htmlFor="email" required error={fieldErrors?.email}>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="voce@empresa.com.br"
          />
        </Field>

        <Field label="Senha" htmlFor="password" required error={fieldErrors?.password}>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="••••••••"
          />
        </Field>

        <input type="hidden" name="next" value={next ?? ''} />

        <Button type="submit" className="w-full" loading={pending} size="lg">
          Entrar
        </Button>
      </form>
    </Card>
  );
}
