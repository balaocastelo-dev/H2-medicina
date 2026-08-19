'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, MapPin } from 'lucide-react';
import { Field, Input } from '@/components/ui';
import { buscarCep, cepCompleto, formatarCep, limparCep } from './cep';

interface ValoresEndereco {
  zip_code?: string | null;
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  district?: string | null;
  city?: string | null;
  state?: string | null;
}

/**
 * Bloco de endereco com preenchimento pelo CEP.
 *
 * Assim que os oito digitos entram, rua, bairro, cidade e UF sao buscados
 * e preenchidos. Tudo continua editavel: endereco novo que ainda nao esta
 * na base dos Correios, ou zona rural, precisa ser digitado a mao.
 *
 * O foco vai para o numero depois do preenchimento — e o unico campo que
 * o CEP nao tem como saber.
 */
export function CamposEndereco({
  valores,
  erros,
}: {
  valores?: ValoresEndereco;
  erros?: Record<string, string[] | undefined>;
}) {
  const [cep, setCep] = useState(formatarCep(valores?.zip_code ?? ''));
  const [rua, setRua] = useState(valores?.street ?? '');
  const [bairro, setBairro] = useState(valores?.district ?? '');
  const [cidade, setCidade] = useState(valores?.city ?? '');
  const [uf, setUf] = useState(valores?.state ?? '');
  const [buscando, setBuscando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const campoNumero = useRef<HTMLInputElement>(null);
  const ultimoBuscado = useRef<string>(limparCep(valores?.zip_code ?? ''));

  useEffect(() => {
    const digitos = limparCep(cep);
    if (!cepCompleto(digitos) || digitos === ultimoBuscado.current) return;

    ultimoBuscado.current = digitos;
    const controle = new AbortController();
    setBuscando(true);
    setAviso(null);

    buscarCep(digitos, controle.signal)
      .then((endereco) => {
        if (controle.signal.aborted) return;
        if (!endereco) {
          setAviso('CEP não encontrado. Preencha o endereço à mão.');
          return;
        }
        // Campo ja preenchido nao e sobrescrito por vazio: CEP de cidade
        // inteira volta sem logradouro.
        if (endereco.logradouro) setRua(endereco.logradouro);
        if (endereco.bairro) setBairro(endereco.bairro);
        if (endereco.cidade) setCidade(endereco.cidade);
        if (endereco.uf) setUf(endereco.uf);
        campoNumero.current?.focus();
      })
      .finally(() => {
        if (!controle.signal.aborted) setBuscando(false);
      });

    return () => controle.abort();
  }, [cep]);

  return (
    <>
      <Field
        label="CEP"
        error={erros?.zip_code}
        hint={aviso ?? 'Preenche o endereço automaticamente'}
      >
        <div className="relative">
          <Input
            name="zip_code"
            value={cep}
            inputMode="numeric"
            maxLength={9}
            placeholder="00000-000"
            onChange={(e) => setCep(formatarCep(e.target.value))}
          />
          <span className="absolute top-1/2 right-3 -translate-y-1/2 text-slate-400">
            {buscando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MapPin className="h-4 w-4" />
            )}
          </span>
        </div>
      </Field>

      <Field label="Logradouro" error={erros?.street} className="md:col-span-2">
        <Input name="street" value={rua} onChange={(e) => setRua(e.target.value)} />
      </Field>
      <Field label="Numero" error={erros?.number}>
        <Input ref={campoNumero} name="number" defaultValue={valores?.number ?? ''} />
      </Field>
      <Field label="Complemento">
        <Input name="complement" defaultValue={valores?.complement ?? ''} />
      </Field>
      <Field label="Bairro" error={erros?.district}>
        <Input name="district" value={bairro} onChange={(e) => setBairro(e.target.value)} />
      </Field>
      <Field label="Cidade" error={erros?.city}>
        <Input name="city" value={cidade} onChange={(e) => setCidade(e.target.value)} />
      </Field>
      <Field label="UF" error={erros?.state}>
        <Input
          name="state"
          maxLength={2}
          value={uf}
          onChange={(e) => setUf(e.target.value.toUpperCase())}
        />
      </Field>
    </>
  );
}
