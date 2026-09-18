import Image from 'next/image';
import { createAdminClient } from '@/lib/supabase/admin';
import { marcaPublica } from '@/modules/settings/marca-publica';
import {
  CODIGO_VALIDO,
  montarResposta,
  normalizarCodigo,
  type DocumentoVerificado,
  type LinhaDeDocumento,
} from '@/modules/documents/verificacao';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Verificar documento',
  description: 'Confira a autenticidade de um documento emitido pela clínica.',
  // Pagina de conferencia nao tem por que estar em buscador.
  robots: { index: false, follow: false },
};

/**
 * Conferencia publica de documento pelo codigo impresso no rodape.
 *
 * Quem chega aqui e o RH da empresa cliente, ou um fiscal, com o papel na
 * mao. A pagina responde uma pergunta so: este documento saiu daqui?
 *
 * Nao tem login de proposito, e por isso nao mostra nada clinico -- nem
 * parecer, nem CPF, nem empresa, nem resultado de exame. O nome do
 * paciente sai parcialmente escondido: quem tem o documento reconhece,
 * quem so tem o codigo nao descobre de quem e.
 */
export default async function VerificarPage({
  searchParams,
}: {
  searchParams: Promise<{ codigo?: string }>;
}) {
  const { codigo: bruto } = await searchParams;
  const codigo = normalizarCodigo(bruto);

  const unidade = await marcaPublica();
  const nomeDaClinica = unidade?.tradeName ?? unidade?.legalName ?? 'Clínica';

  let resultado: DocumentoVerificado | null = null;
  let formatoInvalido = false;
  let indisponivel = false;

  if (codigo) {
    if (!CODIGO_VALIDO.test(codigo)) {
      // Barra a varredura antes de chegar ao banco.
      formatoInvalido = true;
    } else {
      try {
        const admin = createAdminClient();
        const { data, error } = await admin
          .from('documents')
          .select(
            'kind, title, generated_at, deleted_at, signer_name, signer_council, patients(full_name)',
          )
          .eq('verification_code', codigo)
          .maybeSingle<LinhaDeDocumento>();

        if (error) throw error;
        resultado = montarResposta(data, nomeDaClinica);
      } catch (erro) {
        // Pagina publica nao pode dar tela de erro do Next para quem esta
        // com o documento na mao. Banco fora do ar nao e "documento falso":
        // dizer que nao foi encontrado seria pior do que admitir a falha.
        console.error('[verificar] falha ao consultar o documento:', erro);
        indisponivel = true;
      }
    }
  }

  const dataEmissao = resultado?.emitidoEm
    ? new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        dateStyle: 'long',
        timeStyle: 'short',
      }).format(new Date(resultado.emitidoEm))
    : null;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-lg">
        <header className="mb-6 text-center">
          {unidade?.logoUrl && (
            <Image
              src={unidade.logoUrl}
              alt={nomeDaClinica}
              width={160}
              height={56}
              className="mx-auto mb-3 h-14 w-auto object-contain"
              unoptimized
            />
          )}
          <h1 className="text-xl font-bold text-slate-900">Verificar documento</h1>
          <p className="mt-1 text-sm text-slate-600">
            Digite o código impresso no rodapé do documento.
          </p>
        </header>

        <form
          method="get"
          className="mb-6 flex gap-2 rounded-xl border border-slate-200 bg-white p-3"
        >
          <input
            name="codigo"
            defaultValue={bruto ?? ''}
            placeholder="Ex.: A1B2C3D4E5"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-label="Código de verificação"
            className="h-11 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 font-mono tracking-widest uppercase"
          />
          <button
            type="submit"
            className="h-11 shrink-0 rounded-lg bg-slate-900 px-5 font-medium text-white"
          >
            Verificar
          </button>
        </form>

        {formatoInvalido && (
          <Caixa cor="slate" titulo="Código incompleto">
            O código tem 10 caracteres, entre números e as letras A a F. Confira se copiou inteiro,
            direto do rodapé do documento.
          </Caixa>
        )}

        {indisponivel && (
          <Caixa cor="slate" titulo="Não foi possível verificar agora">
            A consulta está temporariamente indisponível. Isto <strong>não</strong> significa que o
            documento seja inválido — tente de novo em alguns minutos ou entre em contato com{' '}
            {nomeDaClinica}.
          </Caixa>
        )}

        {resultado?.situacao === 'nao_encontrado' && (
          <Caixa cor="vermelho" titulo="Documento não encontrado">
            Nenhum documento com este código foi emitido por {nomeDaClinica}. Confira a digitação.
            Se o código estiver correto e mesmo assim não for encontrado, procure a clínica antes de
            aceitar o documento.
          </Caixa>
        )}

        {resultado?.situacao === 'cancelado' && (
          <Caixa cor="ambar" titulo="Documento cancelado">
            Este documento foi emitido por {nomeDaClinica}, mas depois foi cancelado.{' '}
            <strong>Não deve ser aceito como válido.</strong> Procure a clínica para receber a
            versão vigente.
          </Caixa>
        )}

        {resultado?.situacao === 'autentico' && (
          <div className="overflow-hidden rounded-xl border border-emerald-300 bg-white">
            <div className="bg-emerald-50 px-4 py-3">
              <p className="font-semibold text-emerald-800">Documento autêntico</p>
              <p className="text-sm text-emerald-700">Emitido por {nomeDaClinica}.</p>
            </div>
            <dl className="divide-y divide-slate-100">
              <Linha rotulo="Tipo" valor={resultado.tipo} />
              <Linha rotulo="Emitido em" valor={dataEmissao} />
              <Linha rotulo="Paciente" valor={resultado.paciente} />
              <Linha rotulo="Assinado por" valor={resultado.assinante} />
              <Linha rotulo="Registro no conselho" valor={resultado.conselho} />
              <Linha rotulo="Código" valor={codigo} mono />
            </dl>
            <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
              O nome do paciente aparece abreviado de propósito: esta página é pública. Confira
              contra o documento que você tem em mãos.
            </p>
          </div>
        )}

        {!codigo && (
          <p className="text-center text-sm text-slate-500">
            O código fica no rodapé de cada documento, ao lado de &ldquo;Código de
            verificação&rdquo;.
          </p>
        )}

        <footer className="mt-8 text-center text-xs text-slate-400">
          {nomeDaClinica}
          {unidade?.footerText ? ` · ${unidade.footerText}` : ''}
        </footer>
      </div>
    </main>
  );
}

function Linha({
  rotulo,
  valor,
  mono = false,
}: {
  rotulo: string;
  valor: string | null;
  mono?: boolean;
}) {
  if (!valor) return null;
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5">
      <dt className="text-sm text-slate-500">{rotulo}</dt>
      <dd className={`text-sm font-medium text-slate-900 ${mono ? 'font-mono tracking-wider' : ''}`}>
        {valor}
      </dd>
    </div>
  );
}

const CORES = {
  vermelho: 'border-red-300 bg-red-50 text-red-900',
  ambar: 'border-amber-300 bg-amber-50 text-amber-900',
  slate: 'border-slate-300 bg-white text-slate-800',
} as const;

function Caixa({
  cor,
  titulo,
  children,
}: {
  cor: keyof typeof CORES;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl border p-4 ${CORES[cor]}`}>
      <p className="mb-1 font-semibold">{titulo}</p>
      <p className="text-sm">{children}</p>
    </div>
  );
}
