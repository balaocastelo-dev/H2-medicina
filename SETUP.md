# SETUP — instalacao e execucao

Plataforma white label multi-tenant de medicina ocupacional, e-commerce e automacao de agendamentos.

## 1. Requisitos

- Node.js 20.9+ (recomendado 22)
- Um projeto Supabase (PostgreSQL 15+)
- Opcional: Supabase CLI (`npm i -g supabase`)

## 2. Instalacao

```bash
npm install
cp .env.example .env.local
```

Preencha `.env.local`:

| Variavel                        | Onde fica            | Descricao                                        |
| ------------------------------- | -------------------- | ------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | navegador            | URL do projeto                                   |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | navegador            | chave publica (anon/publishable)                 |
| `SUPABASE_SERVICE_ROLE_KEY`     | **somente servidor** | chave secreta; ignora RLS                        |
| `SUPABASE_DB_URL`               | **somente servidor** | string de conexao para migrations                |
| `SECRETS_ENCRYPTION_KEY`        | **somente servidor** | 32 bytes base64, cifra credenciais de conectores |

Gere a chave de criptografia:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

> `.env.local` esta no `.gitignore`. Nunca faca commit de valores reais.

## 3. Banco de dados

Tres caminhos equivalentes — escolha um.

**A. Script incluso (recomendado)**

```bash
export SUPABASE_DB_URL="postgresql://postgres:SENHA@db.<ref>.supabase.co:5432/postgres"
npm run db:push     # aplica as 15 migrations em ordem, com controle de versao
npm run db:seed     # cria o primeiro tenant e os dados iniciais
```

**B. Supabase CLI**

```bash
supabase link --project-ref <ref>
supabase db push
psql "$SUPABASE_DB_URL" -f supabase/seed/0001_tenant_inicial.sql
```

**C. SQL Editor do painel**

```bash
npm run db:full     # gera supabase/full_schema.sql
```

Cole o conteudo no SQL Editor e execute.

As migrations sao **idempotentes**: reexecutar nao quebra nem duplica nada.

### Validacao offline

```bash
npm run validate:sql
```

Sobe um PostgreSQL real em WebAssembly (PGlite), simula o ambiente Supabase
(`auth.uid()`, schemas `auth`/`storage`, papeis `anon`/`authenticated`/`service_role`),
aplica todas as migrations duas vezes, roda o seed duas vezes e confere que
todas as tabelas estao com RLS habilitado. Nao precisa de conexao com o Supabase.

## 4. Primeiro usuario

O seed cria tenant, papeis, permissoes, salas, exames, estagios do CRM e catalogo,
mas **nao** cria usuarios (isso e feito pelo Supabase Auth).

1. No painel do Supabase: **Authentication → Users → Add user** (com senha).
2. Vincule o perfil ao tenant e ao papel:

```sql
-- Substitua o e-mail
with u as (select id from auth.users where email = 'admin@suaempresa.com.br'),
     t as (select id from public.tenants where slug = 'h2'),
     r as (select id from public.roles where code = 'administrativo'
            and tenant_id = (select id from t))
insert into public.profiles (id, tenant_id, full_name, email, is_active)
select u.id, t.id, 'Administrador', 'admin@suaempresa.com.br', true from u, t
on conflict (id) do update set tenant_id = excluded.tenant_id;

with u as (select id from auth.users where email = 'admin@suaempresa.com.br'),
     t as (select id from public.tenants where slug = 'h2'),
     r as (select id from public.roles where code = 'administrativo'
            and tenant_id = (select id from t))
insert into public.user_roles (user_id, role_id, tenant_id)
select u.id, r.id, t.id from u, r, t
on conflict do nothing;
```

Repita trocando `administrativo` por `medico_examinador` ou `atendimento`.

## 5. Executar

```bash
npm run dev        # http://localhost:3000
npm run typecheck  # TypeScript estrito
npm run lint
npm test           # unitarios + integracao (RLS em Postgres real)
npm run build      # build de producao
```

## 6. Rotas principais

| Rota                                      | Uso                            | Acesso                           |
| ----------------------------------------- | ------------------------------ | -------------------------------- |
| `/login`                                  | autenticacao                   | publico                          |
| `/dashboard`                              | panorama do dia                | `dashboard.ver`                  |
| `/crm`                                    | kanban da jornada              | `agenda.ver`                     |
| `/recepcao` `/triagem` `/filas` `/medico` | operacao clinica               | permissoes especificas           |
| `/agenda` `/agenda/proximo-dia`           | agenda e lista do dia seguinte | `agenda.ver`                     |
| `/pacientes` `/empresas`                  | cadastros                      | `pacientes.ver` / `empresas.ver` |
| `/financeiro` `/documentos`               | cobrancas e PDFs               | permissoes especificas           |
| `/configuracoes`                          | white label                    | `whitelabel.configurar`          |
| `/totem`                                  | tela cheia, touch              | `totem.operar`                   |
| `/painel`                                 | TV, tempo real                 | `painel.operar`                  |
| `/meu`                                    | PWA do paciente                | publico (CPF + nascimento)       |

Totem e painel de TV abrem em aba separada — configure um usuario dedicado
com apenas `totem.operar` / `painel.operar` nas maquinas da recepcao.

## 7. Deploy

Qualquer host com suporte a Next.js 16 (Vercel, Fly, Render, VPS com Node).

1. Configure as variaveis de ambiente no painel do host.
2. `SUPABASE_SERVICE_ROLE_KEY` como **secret**, nunca como `NEXT_PUBLIC_`.
3. Rode as migrations antes do primeiro deploy.
4. Em `Authentication → URL Configuration`, adicione a URL de producao
   (necessario para o link de redefinicao de senha).

O worker do scraper (Playwright) **nao** roda em ambiente serverless.
Use um container/VM separado — veja `docs/SCRAPER.md`.
