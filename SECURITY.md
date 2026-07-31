# SECURITY — seguranca, LGPD e tratamento de segredos

## Modelo de isolamento

Toda tabela de negocio tem `tenant_id`. O acesso e decidido no banco, nao na aplicacao:

```
can_access(tenant, permissao)
  = usuario ativo
  AND (admin da plataforma OU tenant do usuario = tenant do registro)
  AND has_permission(permissao)
```

`has_permission` resolve papeis + concessoes individuais, e **a revogacao individual
sempre prevalece sobre o papel**. Todas as funcoes sao `SECURITY DEFINER` com
`search_path` fixo, evitando sequestro de schema.

RLS esta habilitado **e forcado** (`force row level security`) em todas as 83 tabelas
do schema `public`. Isso vale inclusive para o dono da tabela.

Cobertura verificada automaticamente por `npm run validate:sql` e pelos testes de
integracao em `tests/integration/rls.test.ts`, que sobem um PostgreSQL real e
comprovam que um tenant nao enxerga dados do outro.

## Segredos

| Segredo                                         | Onde vive                            | Chega ao navegador? |
| ----------------------------------------------- | ------------------------------------ | ------------------- |
| `SUPABASE_SERVICE_ROLE_KEY`                     | env do servidor                      | **nunca**           |
| `SUPABASE_DB_URL` / senha do banco              | env do servidor                      | **nunca**           |
| `SECRETS_ENCRYPTION_KEY`                        | env do servidor                      | **nunca**           |
| Senha do portal externo (scraper)               | `private.connector_secrets`, cifrada | **nunca**           |
| Credenciais de provedores (e-mail/IA/pagamento) | `private.provider_secrets`, cifrada  | **nunca**           |

### Por que schema `private`

O Supabase concede `SELECT` no nivel da **tabela** ao papel `authenticated`.
Nesse cenario, `REVOKE SELECT (coluna)` **nao tem efeito** — a coluna continua
legivel pela API. A unica barreira confiavel e manter o segredo fora do schema
exposto pelo PostgREST.

Por isso os segredos vivem em `private.*`, que:

- nao e exposto pela API,
- nao recebe `grant` para `anon`/`authenticated`,
- tem RLS habilitado **sem nenhuma policy** (nega tudo por padrao),
- so e acessado pela service role e por funcoes `SECURITY DEFINER`.

As telas leem as views `public.scraper_connectors_safe` e
`public.provider_settings_safe`, que expoem apenas um booleano `has_password` /
`has_secret` — nunca o valor.

`src/lib/supabase/admin.ts` importa `server-only`: qualquer tentativa de usar o
cliente administrativo em codigo client quebra o build.

## Auditoria

- `audit_logs` — quem, o que, quando, de onde, valor anterior e novo.
  Existe policy de `INSERT` e `SELECT`, mas **nenhuma** de `UPDATE`/`DELETE`:
  para o usuario da API a tabela e append-only.
- `clinical_access_logs` — todo acesso a prontuario, exame, triagem ou documento.
- `auth_events` — login, falha de login, logout, bloqueio, troca de senha.
- Historico dedicado em `crm_movements`, `queue_events`, `triage_revisions`,
  `room_status_history`, `order_status_history`, `payment_transactions`.

## Dados clinicos

- Buckets `clinical-documents`, `exam-results`, `attachments` e `signatures` sao
  **privados**. O acesso e sempre por URL assinada com expiracao curta (300s).
- O caminho do arquivo comeca pelo `tenant_id`; as policies de `storage.objects`
  validam esse prefixo contra a permissao do usuario.
- Nenhum documento clinico e publico.

## Separacao clinico x comercial

Regra dura do produto: **dado clinico nunca alimenta marketing**.

- A audiencia de campanha vem de `companies` com `allow_marketing = true`,
  respeitando `marketing_blocked_at` e `unsubscribe_list`.
- Nenhuma consulta de campanha toca `patients`, `triages`, `patient_exams`,
  `exam_results` ou `medical_consultations`.
- Todo e-mail carrega link de descadastro; o descadastro e definitivo por tenant.

## LGPD

- `patient_consents` — finalidade, base legal, concessao e revogacao.
- `companies.legal_basis` / `consent_at` — base legal da comunicacao comercial.
- `data_subject_requests` — acesso, portabilidade, correcao, anonimizacao,
  exclusao e revogacao, com responsavel e data de tratamento.
- Soft delete (`deleted_at`) preserva rastreabilidade sem expor o registro.

## Scraper — limites inegociaveis

O modulo de importacao existe para portais em que o tenant **possui autorizacao**.
A execucao fica bloqueada enquanto `authorization_confirmed` for falso.

Nao ha e nao havera: quebra de CAPTCHA, contorno de autenticacao ou de MFA,
exploracao de vulnerabilidade, descoberta de senha, acesso nao autorizado,
evasao de bloqueios ou coleta fora do escopo autorizado.

Quando existir API oficial ou exportacao (CSV/Excel), prefira esses modos —
o conector aceita `kind = api | csv | excel`.

## Praticas na aplicacao

- Validacao dupla: Zod no cliente e no servidor + constraints no banco
  (CPF e CNPJ com digito verificador validado em SQL).
- Server Actions sempre chamam `assertPermission()` antes de qualquer escrita.
- Cabecalhos de seguranca em `next.config.ts` (frame, sniff, referrer, permissions).
- Erros do Postgres sao traduzidos sem vazar estrutura interna (`toFriendlyError`).
- Resposta neutra na recuperacao de senha (nao revela se o e-mail existe).

## Se uma credencial vazar

1. Rotacione no painel do Supabase (**Settings → API → Rotate**).
2. Troque a senha do banco (**Settings → Database**).
3. Atualize as variaveis no host e refaca o deploy.
4. Revise `auth_events` e `audit_logs` no periodo de exposicao.
