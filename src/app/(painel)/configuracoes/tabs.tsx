'use client';

import { useActionState, useState, useTransition } from 'react';
import { Alert, Button, Card, CardBody, CardHeader, Field, Input, Textarea } from '@/components/ui';
import { saveBranding, saveTenantSettings, toggleModule } from '@/modules/settings/actions';
import type { ActionResult } from '@/lib/action-result';
import type { TenantBranding } from '@/types/entities';

const TABS = [
  { key: 'marca', label: 'Marca e cores' },
  { key: 'empresa', label: 'Dados da empresa' },
  { key: 'contato', label: 'Contato e endereco' },
  { key: 'responsavel_tecnico', label: 'Responsavel tecnico' },
  { key: 'documentos', label: 'Documentos e PDFs' },
  { key: 'totem', label: 'Totem' },
  { key: 'painel_tv', label: 'Painel de TV' },
  { key: 'filas', label: 'Filas' },
  { key: 'ecommerce', label: 'Loja' },
  { key: 'pagamento', label: 'Pagamento e Pix' },
  { key: 'email', label: 'E-mail' },
  { key: 'ia', label: 'Inteligencia artificial' },
  { key: 'scraper', label: 'Importacao' },
  { key: 'institucional', label: 'Textos institucionais' },
  { key: 'modulos', label: 'Modulos' },
];

const FIELDS: Record<string, { name: string; label: string; type?: string; textarea?: boolean }[]> =
  {
    empresa: [
      { name: 'razao_social', label: 'Razao social' },
      { name: 'nome_fantasia', label: 'Nome fantasia' },
      { name: 'cnpj', label: 'CNPJ' },
      { name: 'inscricao_municipal', label: 'Inscricao municipal' },
      { name: 'site', label: 'Site' },
      { name: 'dominio', label: 'Dominio' },
    ],
    contato: [
      { name: 'telefone', label: 'Telefone' },
      { name: 'whatsapp', label: 'WhatsApp' },
      { name: 'email', label: 'E-mail' },
      { name: 'cep', label: 'CEP' },
      { name: 'logradouro', label: 'Logradouro' },
      { name: 'numero', label: 'Numero' },
      { name: 'complemento', label: 'Complemento' },
      { name: 'bairro', label: 'Bairro' },
      { name: 'cidade', label: 'Cidade' },
      { name: 'estado', label: 'UF' },
    ],
    responsavel_tecnico: [
      { name: 'nome', label: 'Nome do responsavel' },
      { name: 'conselho', label: 'Conselho (ex.: CRM)' },
      { name: 'numero', label: 'Numero do registro' },
      { name: 'uf', label: 'UF do conselho' },
      { name: 'assinatura_url', label: 'URL da assinatura digitalizada' },
    ],
    documentos: [
      { name: 'cabecalho', label: 'Cabecalho dos PDFs', textarea: true },
      { name: 'rodape', label: 'Rodape dos PDFs', textarea: true },
      { name: 'url_verificacao', label: 'URL de verificacao' },
    ],
    totem: [
      { name: 'tempo_reinicio_segundos', label: 'Tempo de reinicio (s)', type: 'number' },
      { name: 'instrucoes', label: 'Instrucoes na tela', textarea: true },
    ],
    painel_tv: [
      { name: 'quantidade_ultimas_chamadas', label: 'Ultimas chamadas exibidas', type: 'number' },
      { name: 'tempo_exibicao_segundos', label: 'Tempo de exibicao (s)', type: 'number' },
      { name: 'volume', label: 'Volume (0 a 1)' },
      { name: 'voz', label: 'Idioma da voz' },
    ],
    filas: [
      { name: 'peso_prioridade', label: 'Peso da prioridade', type: 'number' },
      { name: 'peso_tempo_espera', label: 'Peso do tempo de espera', type: 'number' },
    ],
    ecommerce: [
      { name: 'nome_loja', label: 'Nome da loja' },
      { name: 'texto_checkout', label: 'Texto do checkout', textarea: true },
    ],
    pagamento: [
      { name: 'chave_pix', label: 'Chave Pix' },
      { name: 'tipo_chave', label: 'Tipo da chave' },
      { name: 'beneficiario', label: 'Nome do beneficiario' },
      { name: 'cidade', label: 'Cidade do beneficiario' },
      { name: 'gateway', label: 'Gateway (opcional)' },
    ],
    email: [
      { name: 'provedor', label: 'Provedor' },
      { name: 'remetente', label: 'E-mail remetente' },
      { name: 'nome_remetente', label: 'Nome do remetente' },
    ],
    ia: [
      { name: 'provedor', label: 'Provedor de IA' },
      { name: 'modelo', label: 'Modelo' },
    ],
    scraper: [{ name: 'modo_padrao', label: 'Modo padrao (teste/homologacao/producao)' }],
    institucional: [
      { name: 'sobre', label: 'Sobre a empresa', textarea: true },
      { name: 'politica_privacidade', label: 'Politica de privacidade', textarea: true },
      { name: 'termos_uso', label: 'Termos de uso', textarea: true },
    ],
  };

export function SettingsTabs({
  branding,
  settings,
  modules,
  allModules,
  tenantName,
}: {
  branding: TenantBranding;
  settings: Record<string, Record<string, unknown>>;
  modules: string[];
  allModules: string[];
  tenantName: string;
}) {
  const [tab, setTab] = useState('marca');

  return (
    <div className="grid gap-4 lg:grid-cols-4">
      <nav className="lg:col-span-1">
        <Card className="p-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${
                tab === t.key ? 'bg-slate-100 font-medium' : 'hover:bg-slate-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </Card>
      </nav>

      <div className="lg:col-span-3">
        {tab === 'marca' && <BrandingForm branding={branding} tenantName={tenantName} />}
        {tab === 'modulos' && <ModulesPanel modules={modules} allModules={allModules} />}
        {FIELDS[tab] && (
          <GroupForm
            key={tab}
            groupKey={tab}
            title={TABS.find((t) => t.key === tab)?.label ?? tab}
            fields={FIELDS[tab] ?? []}
            values={settings[tab] ?? {}}
          />
        )}
      </div>
    </div>
  );
}

function GroupForm({
  groupKey,
  title,
  fields,
  values,
}: {
  groupKey: string;
  title: string;
  fields: { name: string; label: string; type?: string; textarea?: boolean }[];
  values: Record<string, unknown>;
}) {
  const action = saveTenantSettings.bind(null, groupKey);
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action, null);

  return (
    <Card>
      <CardHeader title={title} description="Valores editaveis — nada e fixado no codigo" />
      <CardBody>
        <form action={formAction} className="space-y-4">
          {state?.ok && <Alert variant="success">{state.message}</Alert>}
          {state && !state.ok && <Alert variant="error">{state.error}</Alert>}
          <div className="grid gap-4 md:grid-cols-2">
            {fields.map((f) => (
              <Field key={f.name} label={f.label} className={f.textarea ? 'md:col-span-2' : ''}>
                {f.textarea ? (
                  <Textarea name={f.name} defaultValue={String(values[f.name] ?? '')} rows={3} />
                ) : (
                  <Input
                    name={f.name}
                    type={f.type ?? 'text'}
                    defaultValue={String(values[f.name] ?? '')}
                  />
                )}
              </Field>
            ))}
          </div>
          <Button type="submit" loading={pending}>
            Salvar
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

function BrandingForm({ branding, tenantName }: { branding: TenantBranding; tenantName: string }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    saveBranding,
    null,
  );
  const [preview, setPreview] = useState({
    primary: branding.color_primary,
    secondary: branding.color_secondary,
    accent: branding.color_accent,
    sidebar: branding.color_sidebar,
    name: branding.system_name,
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Marca e cores"
          description="Aplicadas ao painel, telas dedicadas, loja e PDFs"
        />
        <CardBody>
          <form action={formAction} className="space-y-4">
            {state?.ok && <Alert variant="success">{state.message}</Alert>}
            {state && !state.ok && <Alert variant="error">{state.error}</Alert>}

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Nome do sistema">
                <Input
                  name="system_name"
                  defaultValue={branding.system_name}
                  onChange={(e) => setPreview((p) => ({ ...p, name: e.target.value }))}
                />
              </Field>
              <Field label="Texto do rodape">
                <Input name="footer_text" defaultValue={branding.footer_text ?? ''} />
              </Field>
              <Field label="Logotipo principal (URL)">
                <Input name="logo_url" defaultValue={branding.logo_url ?? ''} />
              </Field>
              <Field label="Logotipo reduzido (URL)">
                <Input name="logo_compact_url" defaultValue={branding.logo_compact_url ?? ''} />
              </Field>
              <Field label="Favicon (URL)">
                <Input name="favicon_url" defaultValue={branding.favicon_url ?? ''} />
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <Field label="Cor primaria">
                <Input
                  type="color"
                  name="color_primary"
                  defaultValue={branding.color_primary}
                  onChange={(e) => setPreview((p) => ({ ...p, primary: e.target.value }))}
                />
              </Field>
              <Field label="Cor secundaria">
                <Input
                  type="color"
                  name="color_secondary"
                  defaultValue={branding.color_secondary}
                  onChange={(e) => setPreview((p) => ({ ...p, secondary: e.target.value }))}
                />
              </Field>
              <Field label="Cor de destaque">
                <Input
                  type="color"
                  name="color_accent"
                  defaultValue={branding.color_accent}
                  onChange={(e) => setPreview((p) => ({ ...p, accent: e.target.value }))}
                />
              </Field>
              <Field label="Cor do menu">
                <Input
                  type="color"
                  name="color_sidebar"
                  defaultValue={branding.color_sidebar}
                  onChange={(e) => setPreview((p) => ({ ...p, sidebar: e.target.value }))}
                />
              </Field>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-slate-700">Cores dos status</p>
              <div className="grid gap-3 md:grid-cols-4">
                {Object.entries(branding.status_colors ?? {}).map(([key, value]) => (
                  <Field key={key} label={key.replace(/_/g, ' ')}>
                    <Input type="color" name={`status_${key}`} defaultValue={String(value)} />
                  </Field>
                ))}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Cabecalho HTML dos PDFs">
                <Textarea
                  name="pdf_header_html"
                  defaultValue={branding.pdf_header_html ?? ''}
                  rows={3}
                />
              </Field>
              <Field label="Rodape HTML dos PDFs">
                <Textarea
                  name="pdf_footer_html"
                  defaultValue={branding.pdf_footer_html ?? ''}
                  rows={3}
                />
              </Field>
            </div>

            <Button type="submit" loading={pending}>
              Salvar marca
            </Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Previa" description={`Como a marca aparece para ${tenantName}`} />
        <CardBody>
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <div className="flex">
              <div className="w-40 p-4" style={{ backgroundColor: preview.sidebar }}>
                <div
                  className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold text-white"
                  style={{ backgroundColor: preview.primary }}
                >
                  {preview.name.slice(0, 2).toUpperCase()}
                </div>
                <p className="truncate text-xs text-white">{preview.name}</p>
                <div className="mt-3 space-y-1">
                  <div className="h-2 w-full rounded bg-white/20" />
                  <div className="h-2 w-2/3 rounded bg-white/10" />
                </div>
              </div>
              <div className="flex-1 bg-slate-50 p-4">
                <div className="mb-3 flex gap-2">
                  <span
                    className="rounded-lg px-3 py-1 text-xs text-white"
                    style={{ backgroundColor: preview.primary }}
                  >
                    Botao principal
                  </span>
                  <span
                    className="rounded-lg px-3 py-1 text-xs text-white"
                    style={{ backgroundColor: preview.secondary }}
                  >
                    Secundario
                  </span>
                  <span
                    className="rounded-lg px-3 py-1 text-xs text-white"
                    style={{ backgroundColor: preview.accent }}
                  >
                    Destaque
                  </span>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-500">
                  Area de conteudo
                </div>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function ModulesPanel({ modules, allModules }: { modules: string[]; allModules: string[] }) {
  const [pending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(new Set(modules));

  return (
    <Card>
      <CardHeader
        title="Modulos habilitados"
        description="Controla o que aparece no menu deste tenant"
      />
      <CardBody className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {allModules.map((m) => (
          <label
            key={m}
            className="flex items-center gap-2 rounded-lg border border-slate-200 p-2 text-sm"
          >
            <input
              type="checkbox"
              checked={enabled.has(m)}
              disabled={pending}
              onChange={(e) => {
                const next = new Set(enabled);
                if (e.target.checked) next.add(m);
                else next.delete(m);
                setEnabled(next);
                startTransition(() => void toggleModule(m, e.target.checked));
              }}
            />
            {m.replace(/_/g, ' ')}
          </label>
        ))}
      </CardBody>
    </Card>
  );
}
