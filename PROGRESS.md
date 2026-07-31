# PROGRESS — estado do projeto

> Atualize este arquivo ao final de cada sessao. Ele existe para que o trabalho
> continue exatamente de onde parou, sem recomecar nada.

**Ultima sessao:** fundacao completa — banco, seguranca, autenticacao, white label
e fluxo clinico ponta a ponta.

**Ultimo passo concluido:** modulos de documentos/PDF, financeiro/Pix, PWA do
paciente, testes (29 passando) e documentacao.

**Proximo passo exato:** implementar a loja publica (`/loja`) — vitrine, pagina de
produto, carrinho, checkout e a conversao de pedido em agendamento. O modelo de
dados (`products`, `carts`, `orders`, `order_items`, `coupons`, `service_packages`)
e os tipos ja estao prontos; falta a camada de UI e as Server Actions.

---

## Concluido

### Infraestrutura

- [x] Next.js 16 (App Router), React 19, TypeScript estrito (`noUncheckedIndexedAccess`)
- [x] Tailwind 4, biblioteca de UI propria, ESLint + Prettier, `any` proibido por lint
- [x] Clientes Supabase: navegador, servidor (RLS) e administrativo (`server-only`)
- [x] `.env.example` sem nenhum valor real
- [x] Scripts: `db:push`, `db:seed`, `db:full`, `validate:sql`, `sync`

### Banco de dados

- [x] 15 migrations, 83 tabelas publicas + 2 privadas, idempotentes
- [x] 322 policies de RLS; RLS **forcado** em todas as tabelas
- [x] Catalogo de 40 permissoes granulares
- [x] Helpers: `can_access`, `has_permission`, `is_valid_cpf`, `is_valid_cnpj`, `calc_bmi`
- [x] RPCs: `checkin_patient`, `call_next_for_room`, `move_attendance_stage`
- [x] Triggers do CRM automatico, numeracao de senha e pedido, historicos
- [x] 8 buckets de storage com policies por tenant
- [x] Segredos isolados no schema `private`
- [x] Seed do primeiro tenant (dados, nao codigo)

### Aplicacao

- [x] Login, logout, recuperacao e troca de senha, bloqueio, auditoria de acesso
- [x] Middleware de protecao de rotas + `requirePermission` por pagina
- [x] White label completo: marca, cores, status, PDFs, modulos, previa ao vivo
- [x] Dashboard operacional e financeiro
- [x] Pacientes (CRUD, deteccao de duplicidade, historico)
- [x] Empresas (CRUD, contatos, consentimento de comunicacao)
- [x] Agenda (calendario por data/empresa/status) + **Agenda do proximo dia** agrupada por empresa, com impressao e exportacao CSV
- [x] Totem em tela cheia (teclado numerico, confirmacao, prioridade, senha, impressao, reinicio automatico)
- [x] Painel de TV em tempo real (Supabase Realtime, voz pt-BR, ultimas chamadas)
- [x] Recepcao (fila, confirmacao de exames, prioridade, encaminhamento)
- [x] Triagem (sinais vitais, IMC calculado, alertas, restricoes, historico de revisoes)
- [x] Filas e salas com **atendimento cruzado** (prioridade + tempo de espera, sem ordem fixa, bloqueio de chamada simultanea)
- [x] CRM kanban com 14 estagios, drag and drop (dnd-kit) e movimentacao automatica
- [x] Modulo medico (prontuario, anamnese, conclusao de aptidao, validade)
- [x] Documentos PDF com marca do tenant, incluindo **atestado de comparecimento** com periodo de permanencia e codigo de verificacao
- [x] Financeiro: cobrancas, **Pix BR Code gerado localmente** com QR Code, confirmacao manual, estorno, cancelamento
- [x] PWA do paciente (`/meu`): senha, linha do tempo, exames, service worker
- [x] Relatorios (jornada media, produtividade por exame, atendimentos por empresa)
- [x] Logs e auditoria com filtros
- [x] Usuarios, papeis e permissoes (leitura)
- [x] Listas administrativas: produtos, pedidos, cupons, conectores, execucoes, revisao de importacao, campanhas

### Qualidade

- [x] 29 testes passando (21 unitarios + 8 de integracao)
- [x] Testes de RLS contra PostgreSQL real: isolamento entre tenants, bloqueio por permissao, auditoria append-only, segredos inacessiveis
- [x] Validador de SQL offline com checagem de idempotencia e cobertura de RLS
- [x] `npm run typecheck` limpo em todo o projeto
- [x] SETUP.md, SECURITY.md, DATABASE.md, DECISIONS.md, PROGRESS.md

---

## Pendente

### 1. Loja publica (proximo passo)

- [ ] `/loja` — vitrine, busca, categorias, filtros, banners, destaques
- [ ] `/loja/produto/[slug]` — pagina de produto e servico, relacionados
- [ ] `/loja/carrinho` e `/loja/checkout` — PF e PJ, multiplos beneficiarios
- [ ] Aplicacao de cupom (`coupons` / `coupon_usages` prontos)
- [ ] `/loja/pedidos` — area do cliente e acompanhamento
- [ ] Conversao pedido → agendamento: identificar exames do pacote, consultar
      disponibilidade, criar pre-agendamento, confirmar apos pagamento,
      registrar origem `ecommerce`, evitar duplicidade
- [ ] Compra empresarial: importar lista de beneficiarios, agendamentos
      individuais, saldo do contrato (`company_contracts`)

### 2. Scraper — execucao

- [ ] Formulario de conector (seletores, mapeamento, autenticacao)
- [ ] `set_connector_password` ligado a UI (a funcao SQL ja existe)
- [ ] Worker Playwright isolado (`src/modules/scraper/worker`)
- [ ] Normalizacao + calculo de confianca + deduplicacao
- [ ] Tela de previa com aprovacao individual e em lote
- [ ] Sincronizacao efetiva (criar/atualizar empresa, paciente, agendamento)
- [ ] Execucao agendada (Supabase Cron ou scheduler do worker)
- [ ] Importacao por Excel/CSV usando o mesmo pipeline (`file_imports`)

### 3. Campanhas — execucao

- [ ] Gerador por template com variaveis (template ja existe no seed)
- [ ] Selecao de audiencia respeitando bloqueio e descadastro
- [ ] Fluxo de aprovacao e agendamento de envio
- [ ] Adaptador de provedor de e-mail + registro de eventos
- [ ] Pagina publica de descadastro

### 4. Complementos

- [ ] CRUD de produtos, cupons e pedidos (hoje sao listas)
- [ ] Edicao de papeis e permissoes pela tela (hoje e leitura)
- [ ] Convite de usuario por e-mail (`user_invitations` pronto)
- [ ] Resultados de exame por sala (a action `saveExamResult` ja existe)
- [ ] Pagina publica `/verificar` do codigo de documento
- [ ] Fila de revisao de duplicidades na UI (`patient_duplicates` pronto)
- [ ] Testes end-to-end com Playwright
- [ ] Icones reais do PWA em `public/icons/`

---

## Nota sobre o build

`npm run typecheck` e `npm test` rodam limpos. O `next build` **nao foi executado
neste ambiente**: o binario nativo do Next 16 aborta com `Bus error` no sandbox
usado nesta sessao (limitacao do ambiente, nao do codigo). Execute
`npm run build` na sua maquina ou no CI antes do deploy.
