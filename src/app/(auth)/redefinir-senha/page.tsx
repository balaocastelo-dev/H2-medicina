import { UpdatePasswordForm } from './update-form';

export default function RedefinirSenhaPage() {
  return (
    <div className="w-full max-w-md">
      <h1 className="mb-1 text-center text-xl font-semibold">Definir nova senha</h1>
      <p className="mb-6 text-center text-sm text-slate-500">
        Escolha uma senha com no minimo 8 caracteres.
      </p>
      <UpdatePasswordForm />
    </div>
  );
}
