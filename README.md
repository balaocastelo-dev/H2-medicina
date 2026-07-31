# Plataforma White Label — Medicina Ocupacional, E-commerce e Automacao

Sistema multi-tenant para clinicas de medicina ocupacional: agenda, totem,
senhas, painel de TV, recepcao, triagem, exames com filas por sala, CRM visual
automatico, modulo medico, documentos em PDF, financeiro com Pix, loja e
importacao automatizada de agenda.

Nenhum dado de cliente esta no codigo. Nome, logo, cores, CNPJ, endereco,
responsavel tecnico, chave Pix, prefixos de senha, textos e modulos ativos sao
configuraveis pelo painel, por tenant.

## Documentacao

| Arquivo                      | Conteudo                                           |
| ---------------------------- | -------------------------------------------------- |
| [SETUP.md](SETUP.md)         | instalacao, banco, primeiro usuario, deploy        |
| [DATABASE.md](DATABASE.md)   | modelo de dados, migrations, automacoes            |
| [SECURITY.md](SECURITY.md)   | RLS, segredos, auditoria, LGPD, limites do scraper |
| [DECISIONS.md](DECISIONS.md) | decisoes de arquitetura e trade-offs               |
| [PROGRESS.md](PROGRESS.md)   | o que esta pronto e qual e o proximo passo         |

## Comandos

```bash
npm install
npm run dev            # desenvolvimento
npm run db:push        # migrations
npm run db:seed        # tenant inicial
npm run validate:sql   # valida SQL em Postgres real, offline
npm test               # 29 testes (unitarios + RLS)
npm run typecheck
npm run build
```

## Stack

Next.js 16 (App Router) · React 19 · TypeScript estrito · Tailwind 4 ·
Supabase (PostgreSQL, Auth, Storage, Realtime) · Zod · dnd-kit · pdf-lib ·
Vitest · PGlite · Playwright

## Numeros

83 tabelas · 322 policies de RLS · 40 permissoes granulares · 15 migrations
idempotentes · 29 testes automatizados
