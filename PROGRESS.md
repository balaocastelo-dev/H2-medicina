# PROGRESS — estado do projeto

> Atualize este arquivo ao final de cada sessao. Ele existe para que o trabalho
> continue exatamente de onde parou, sem recomecar nada.

**Ultima sessao:** ajustes pedidos pela recepcao no WhatsApp entre 20/08 e
27/08 — psicossocial na ficha, fichas de exame por sala, catalogo completo de
exames, unificacao de cadastros e anexo de laudos posteriores.

**Ultimo passo concluido:** migration `0023` e seed `0002` com o que faltava da
lista da recepcao. Detalhe item a item na secao "Lista da recepcao" abaixo.

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

## Procedencia do paciente (P / E / S / I)

Pedido da clinica apos a apresentacao de 12/08/2026. A casa atende quatro
publicos que entram pela mesma porta e seguem por corredores diferentes.

| Letra | Procedencia          | Caminho                          |
| ----- | -------------------- | -------------------------------- |
| P     | Empresa / particular | triagem e fichas → exames → medico |
| E     | Estado (ESISLA)      | direto ao modulo medico          |
| S     | SISPER               | triagem → medico                 |
| I     | Ingresso (escola)    | triagem → medico, ficha completa |

- [x] Migration `0017` — enum `patient_origin_kind`, coluna em `attendances`,
      `appointments` e `patients`
- [x] Selecao na recepcao logo apos o totem, com sugestao pela ultima visita
- [x] Encaminhamento automatico a partir da procedencia
- [x] Trigger `tg_triage_finished` reescrito: E, S e I nao caem mais na fila
      de exames ao sair da triagem
- [x] Kit de saida para as quatro procedencias — comprovante de comparecimento,
      recibo e comprovante de agendamento, emitidos ao encerrar o atendimento
- [x] Termo de autorizacao de envio de resultados a empresa (Arts. 85 e 89 do
      CEM), com assinatura na tela ou impressao para assinar no papel
- [x] Agendamento avulso em lote para empresa contratante (`/agenda/avulso`)
- [x] Importacao de planilha SISPER / Estado / ingresso (`/importacao/planilhas`)
- [x] Contratos das empresas com alerta de vencimento, cota de exames e
      geracao do contrato em PDF (`/empresas/contratos`)

**A migration `0017` precisa ser aplicada antes do deploy do codigo.**
Sem ela, a recepcao consulta colunas que ainda nao existem.

---

## Lista da recepcao (WhatsApp, 20/08 a 27/08)

A recepcao mandou os ajustes por mensagem ao longo da primeira semana de uso.
O que faltava desta lista foi feito na migration `0023` e no seed `0002`.

- [x] Modulo medico: retirados "queixa principal" e "anamnese" da tela.
      As colunas continuam no banco: quem ja tinha texto gravado nao perde.
- [x] Modulo medico: bloco de **avaliacao psicossocial**, que so aparece
      quando a recepcao marca o exame PSICO para o paciente. Respostas de
      risco (ideacao suicida, alucinacao, desorientacao) sobem destacadas
      logo acima da conclusao de aptidao.
- [x] **Fichas de cada exame** preenchidas na propria sala — Romberg, fadiga,
      dinamometria (palmar, escapular, lombar), Ishihara, acuidade e
      audiometria. As perguntas vieram dos modelos em Word da clinica.
      Resposta marcada como alerta liga sozinha o "resultado alterado".
- [x] O que o examinador preencheu aparece no painel lateral do medico,
      durante a consulta, sem abrir outra tela.
- [x] Ficha clinica em PDF sai com os blocos que o medico marcou.
- [x] **Exames da clinica** cadastrados: acuidade, Ishihara, psicossocial,
      Romberg, fadiga, dinamometria palmar/escapular/lombar e raio X.
      O raio X nao tem sala — sai como guia de encaminhamento.
      A dinamometria generica foi desativada em favor das tres especificas.
- [x] **Unificar cadastros** do mesmo paciente (`merge_patients`): todo o
      historico migra para o cadastro escolhido e o duplicado e arquivado.
      A tela sugere sozinha quem tem o mesmo CPF ou o mesmo nome e nascimento.
- [x] **Excluir paciente** no cadastro e **cancelar o atendimento** direto
      na recepcao, tirando o paciente do fluxo inteiro (o "tirar da fila"
      das salas continua removendo so um exame).
- [x] **Anexar laudo que chega depois** no cadastro do paciente.
- [x] Agenda de 10 em 10 minutos, configuravel em Configuracoes -> Agenda.

Ja estava resolvido em sessoes anteriores: CEP automatico, editar/cancelar
agendamento, fuso do horario, corpo clinico com CRM, assinatura do medico,
paineis de TV separados, contratos por empresa e o rotulo da tela inicial.

**Falta aplicar no banco antes do deploy:** `0023` e o seed `0002`.

---

## Pronto para deploy

Ver **DEPLOY.md** para o roteiro completo.

- [x] `vercel.json` (regiao gru1, cabecalhos de seguranca)
- [x] `.vercelignore`, `.nvmrc` (Node 22)
- [x] Healthcheck em `/api/health` — diz se falta variavel, migration ou seed
- [x] Icones do PWA gerados (`npm run icons`)
- [x] Validacao de env preguicosa (nao quebra o build quando a variavel falta)
- [x] `npm run check:build` — detector de bloqueadores de build

## Nota sobre o build

`npm run typecheck`, `npm run lint`, `npm run check:build` e `npm test` rodam
limpos. O `next build` **nao foi executado neste ambiente**: o binario nativo do
Next 16 aborta com `Bus error` no sandbox usado nesta sessao — confirmado que
acontece ate num projeto Next vazio, ou seja, e limitacao do ambiente e nao do
codigo. Execute `npm run build` na sua maquina antes do primeiro deploy; a
propria Vercel tambem roda o build no push.

Dois bloqueadores reais de build foram encontrados e corrigidos pela verificacao
estatica: o pacote `server-only` nao estava declarado, e o schema de variaveis de
ambiente era avaliado no import (quebraria o build sem as variaveis definidas).
