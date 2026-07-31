# DECISIONS — decisoes de arquitetura

## 1. Seguranca no banco, nao na aplicacao

RLS forcado em todas as tabelas, com `can_access(tenant, permissao)` resolvendo
tenant + permissao dentro do Postgres.

_Por que:_ a aplicacao tem muitas superficies (painel, totem, TV, PWA, loja,
worker). Colocar a regra em cada uma delas garante que uma vai esquecer.
No banco, esquecer nao e possivel.

_Custo:_ policies precisam ser escritas e testadas. Mitigado por um gerador
declarativo (tabela → permissao de leitura/escrita) na migration `0012` e por
testes de integracao contra Postgres real.

## 2. Segredos no schema `private`

`REVOKE SELECT (coluna)` nao funciona quando existe `GRANT SELECT` no nivel da
tabela — e o Supabase concede exatamente isso a `authenticated`.

Foi assim que a primeira versao ficou: a coluna `password_encrypted` continuava
legivel pela API. O teste de integracao pegou. Segredos foram movidos para
`private.connector_secrets` e `private.provider_secrets`, fora do schema exposto
pelo PostgREST, e as telas passaram a ler views que so dizem se o segredo existe.

## 3. Estagios do CRM como dados

`crm_stages` e uma tabela, nao um enum. Cada tenant pode renomear, recolorir e
reordenar as colunas do kanban sem alterar o codigo.

## 4. Movimentacao automatica por trigger

O CRM avanca por trigger no banco. Se um exame for concluido pelo painel, por
uma Server Action, por um worker ou direto no SQL, a jornada avanca igual.

## 5. Sem enum para status configuravel, enum para o que e estavel

Enums para `payment_status`, `order_status`, `exam_execution_status` — o codigo
depende desses valores. Tabelas para o que o cliente configura.

## 6. Server Components + Server Actions

Consultas rodam no servidor com a sessao do usuario, atravessando RLS. O
navegador nunca recebe mais do que ja pode ver. `use client` fica restrito ao que
precisa de interacao (kanban, totem, TV, formularios com estado).

## 7. Tipagem sem `Database` gerado

Em vez de um tipo gigante gerado do banco, `src/types/entities.ts` define as
entidades do dominio e as consultas usam `.returns<T[]>()`. Zero `any`
(regra de lint como `error`) e sem dependencia de um passo de geracao.

_Trade-off:_ o tipo nao acompanha o schema automaticamente. Quando o modelo
estabilizar, vale gerar via `supabase gen types` e migrar.

## 8. Adaptadores para tudo que e externo

Pagamento, e-mail e IA sao registros em `provider_settings` com modo `manual`
funcionando desde o primeiro dia:

- **Pix**: BR Code EMV gerado localmente (`src/lib/pix.ts`), com CRC16 proprio.
  Funciona so com a chave Pix cadastrada. Confirmacao manual pela recepcao.
  Webhook de gateway entra depois sem tocar no resto.
- **E-mail**: fila local; provedor real e plugavel.
- **IA**: geracao por template; provedor real e opcional.

_Por que:_ o sistema precisa funcionar antes de existir contrato com gateway ou
provedor. Nenhuma credencial foi inventada e nenhum modulo ficou bloqueado.

## 9. Scraper como worker separado

Playwright nao roda bem em serverless. O modulo e desenhado como worker isolado
com fila, lock de concorrencia (`uq_scraper_run_active`), timeout e tentativas.
O painel so configura e aprova.

## 10. Aprovacao humana como padrao

Importacao e campanha nascem em modo `aprovacao_humana`. Automatico e uma
escolha explicita do cliente, nao o default.

## 11. Importacao idempotente por chave de origem

`(tenant, conector, id externo, data de referencia)`. Rodar a mesma coleta duas
vezes atualiza; nao duplica. Payload bruto e trilha campo a campo preservados.

## 12. Multi-tenant desde a primeira linha

Nenhum dado do primeiro cliente esta no codigo. Nome, cores, logo, CNPJ,
endereco, responsavel tecnico, chave Pix, prefixos de senha e textos vem de
`tenant_settings` / `tenant_branding`. O seed e um arquivo de dados.

O rodape "Desenvolvido pelo Balao da Informatica" tambem e configuravel
(`tenant_branding.footer_text`) — o desenvolvedor tambem e white label.

## 13. Validacao em tres camadas

Zod no cliente (feedback imediato), Zod no servidor (nao confia no cliente),
constraint no banco (ultima linha). CPF e CNPJ tem validacao de digito
verificador nas tres — inclusive em PL/pgSQL.

## 14. Sem integracao com SOC

Requisito explicito. Nao existe tabela, adaptador, tela, placeholder ou
documentacao de SOC em lugar nenhum do projeto.
