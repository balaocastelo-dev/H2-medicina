import Link from 'next/link';
import { ResetForm } from './reset-form';

export default function EsqueciSenhaPage() {
  return (
    <div className="w-full max-w-md">
      <h1 className="mb-1 text-center text-xl font-semibold">Recuperar acesso</h1>
      <p className="mb-6 text-center text-sm text-slate-500">
        Informe seu e-mail para receber o link de redefinicao.
      </p>
      <ResetForm />
      <div className="mt-4 text-center text-sm">
        <Link href="/login" className="text-slate-600 underline-offset-2 hover:underline">
          Voltar ao login
        </Link>
      </div>
    </div>
  );
}
