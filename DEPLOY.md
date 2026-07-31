# DEPLOY — publicar na Vercel

Roteiro completo, do zero até o sistema no ar. Leva cerca de 20 minutos.

---

## Passo 0 — rotacione as chaves do Supabase

Se alguma chave já foi compartilhada em chat, e-mail ou print, considere-a
comprometida antes de publicar:

- **Settings → API → Rotate** (anon e service role)
- **Settings → Database** → trocar a senha do banco

Nenhum valor real está no repositório. O `.env.example` traz só os nomes.

---

## Passo 1 — preparar o banco

Antes do primeiro deploy, o banco precisa estar com as migrations aplicadas.

```bash
export SUPABASE_DB_URL="postgresql://postgres:SENHA@db.<ref>.supabase.co:5432/postgres"
npm install
npm run db:push     # 15 migrations, com controle de versão
npm run db:seed     # primeiro tenant e dados iniciais
```

Sem terminal à mão: rode `npm run db:full` e cole `supabase/full_schema.sql`
no SQL Editor do painel do Supabase.

Crie o primeiro usuário conforme o **Passo 4 do SETUP.md** — o seed cria papéis
e permissões, mas não cria contas de acesso.

---

## Passo 2 — subir o código

```bash
git push origin main
```

Na Vercel: **Add New → Project → Import Git Repository** e selecione
`balaocastelo-dev/H2-medicina`.

A Vercel detecta Next.js sozinha. Não altere Build Command, Output Directory
nem Install Command.

---

## Passo 3 — variáveis de ambiente

Em **Project → Settings → Environment Variables**, marcando
_Production_, _Preview_ e _Development_:

| Variável                          | Valor                       | Tipo        |
| --------------------------------- | --------------------------- | ----------- |
| `NEXT_PUBLIC_SUPABASE_URL`        | `https://<ref>.supabase.co` | pública     |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`   | chave anon/publishable      | pública     |
| `NEXT_PUBLIC_DEFAULT_TENANT_SLUG` | `h2`                        | pública     |
| `SUPABASE_SERVICE_ROLE_KEY`       | chave secreta               | **secreta** |
| `SECRETS_ENCRYPTION_KEY`          | 32 bytes em base64          | **secreta** |

Gere a chave de criptografia:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

`NEXT_PUBLIC_APP_URL` é opcional: sem ela, o sistema usa a URL do próprio
deploy. Defina depois que tiver domínio próprio.

> `SUPABASE_SERVICE_ROLE_KEY` **nunca** pode ter o prefixo `NEXT_PUBLIC_`.
> Esse prefixo publica o valor no navegador.

---

## Passo 4 — deploy

Clique em **Deploy**. Ao terminar, abra:

```
https://<seu-projeto>.vercel.app/api/health
```

| Resposta                    | Significado                       | O que fazer                 |
| --------------------------- | --------------------------------- | --------------------------- |
| `"status":"ok"`             | tudo certo                        | siga para o Passo 5         |
| `"status":"incompleto"`     | faltam variáveis públicas         | revise o Passo 3 e redeploy |
| `"status":"sem_migrations"` | banco alcançado, tabelas ausentes | rode `npm run db:push`      |
| `"status":"sem_seed"`       | migrations aplicadas, sem tenant  | rode `npm run db:seed`      |
| `"status":"erro"`           | não falou com o Supabase          | confira URL e chave         |

O endpoint não expõe nenhum segredo — só diz se a configuração existe.

---

## Passo 5 — URLs de autenticação no Supabase

Em **Authentication → URL Configuration**:

- **Site URL**: `https://<seu-projeto>.vercel.app`
- **Redirect URLs**: adicione
  - `https://<seu-projeto>.vercel.app/redefinir-senha`
  - `https://*.vercel.app/redefinir-senha` (para os previews)

Sem isso o link de redefinição de senha não funciona.

---

## Passo 6 — teste de fumaça

1. `/login` — entre com o usuário criado
2. `/dashboard` — carrega sem erro
3. `/configuracoes` — mude a cor primária e salve; o menu muda de cor
4. `/pacientes/novo` — cadastre um paciente de teste
5. `/agenda/novo` — crie um agendamento para hoje com 2 exames
6. `/totem` — digite o CPF do paciente, confirme, emita a senha
7. `/painel` — abra em outra aba; a senha chamada aparece
8. `/recepcao` — inicie o atendimento e libere para exames
9. `/filas` — chame o próximo, inicie e conclua os exames
10. `/medico` — o paciente aparece; preencha e finalize
11. `/documentos` — gere o atestado de comparecimento e abra o PDF
12. `/logs` — todas as ações acima devem estar registradas

---

## Domínio próprio

**Settings → Domains** → adicione o domínio e configure o DNS conforme a Vercel
indicar. Depois:

- defina `NEXT_PUBLIC_APP_URL` com o domínio final
- atualize a Site URL no Supabase
- redeploy

---

## Telas dedicadas em produção

Totem e painel de TV rodam nas máquinas da recepção em tela cheia (F11).
Crie **usuários dedicados** para elas, cada um com uma única permissão:

- máquina do totem → apenas `totem.operar`
- TV da sala de espera → apenas `painel.operar`

Assim, se alguém mexer no equipamento, não alcança prontuário nem financeiro.

---

## O que **não** roda na Vercel

O worker do scraper usa Playwright e precisa de navegador headless — isso não
funciona em ambiente serverless. Quando o módulo entrar em operação, hospede o
worker num container ou VM separada (Fly.io, Railway, Render Background Worker
ou uma VPS) apontando para o mesmo banco. O painel de configuração e aprovação
continua na Vercel normalmente.

---

## Notas de build

- Node 22 (`.nvmrc`); a Vercel respeita esse arquivo
- Região `gru1` (São Paulo) definida em `vercel.json`, menor latência no Brasil
- Antes de subir, rode localmente:

```bash
npm run typecheck && npm run lint && npm run check:build && npm test && npm run build
```

`npm run check:build` é uma verificação estática dos erros que costumam quebrar
o build da Vercel e que o TypeScript não pega: pacote ausente no `package.json`,
componente client importando módulo exclusivo de servidor e arquivo `'use server'`
exportando algo que não é função async.
