import { marcaPublica } from '@/modules/settings/marca-publica';
import { PatientApp } from './patient-app';

export const dynamic = 'force-dynamic';

export default async function MeuPage() {
  // Lido com a chave de servico: `tenants` e `tenant_branding` estao sob
  // RLS e quem abre o portal ainda nao tem sessao — e por isso que ele se
  // identifica por CPF na propria tela.
  const marca = await marcaPublica();

  return (
    <PatientApp
      systemName={marca?.systemName ?? 'Portal do Paciente'}
      logoUrl={marca?.logoUrl ?? null}
      primaryColor={marca?.colorPrimary ?? '#0F766E'}
    />
  );
}
