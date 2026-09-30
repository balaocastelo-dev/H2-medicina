# O primeiro dia

Ordem do que precisa estar pronto antes da primeira paciente chegar, e o que
acontece se cada coisa faltar. Feito para ser seguido de cima para baixo, sem
pular.

Ao fim de tudo há **um teste só** que diz se está de pé: abrir `/api/health`.

---

## 1. Variáveis de ambiente na Vercel

| Variável | Obrigatória | Se faltar |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | sim | Só as telas públicas abrem. O login explica o que falta. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | sim | idem |
| `SUPABASE_SERVICE_ROLE_KEY` | **sim** | Agendamento pelo site, página de verificação, portal do paciente e **criação de usuários** param, com "erro inesperado" na tela. |
| `NEXT_PUBLIC_APP_URL` | não | Cai no endereço da Vercel. Afeta só o link impresso nos documentos. |

A `SUPABASE_SERVICE_ROLE_KEY` entra como **secret**, nunca com prefixo
`NEXT_PUBLIC_`. Ela dá acesso total ao banco e só é usada em código de
servidor.

Depois de mexer em variável, **refazer o deploy** — a Vercel não recarrega
variável em deploy antigo.

## 2. O banco

Duas situações, e só uma vale para a H2:

**Banco já em uso, parado na migration 0040** (é o caso da H2):
cole `supabase/scripts/RODAR-AGORA-TUDO-DE-UMA-VEZ.sql` no SQL Editor do
Supabase e clique em RUN. Traz 0041 a 0054. Pode rodar mais de uma vez.

**Banco novo, do zero:**
cole `supabase/full_schema.sql`. Ele já inclui as migrations todas e os três
seeds.

Se faltar: as telas abrem e falham uma a uma, sem dizer por quê.

## 3. Os seeds

Já vêm dentro do `full_schema.sql`. Em banco existente, rodar na ordem:

1. `supabase/seed/0001_tenant_inicial.sql` — clínica, papéis, permissões,
   salas, etapas do CRM, catálogo de procedimentos, **logo**
2. `supabase/seed/0002_exames_da_clinica.sql` — os exames que a clínica faz
3. `supabase/seed/0003_dados_da_clinica.sql` — endereço, telefone,
   responsável técnico

Sem os papéis do 0001 não há como dar permissão a ninguém.

## 4. Preços e salas dos exames

`supabase/scripts/RODAR-NO-SUPABASE-10-PRECOS-E-SALAS.sql` — script separado,
não está nas migrations.

Se faltar: todo atendimento sai com valor zero, e exame aparece "esperando sem
sala" na tela de filas.

## 5. Os buckets de arquivo

Saem do passo 2 (migration 0014). Se já existirem com configuração diferente,
o script corrige. Sem eles, nenhum documento é salvo.

## 6. O Realtime

No painel do Supabase, confirmar que `tv_calls` está na replicação.

Se não estiver, a TV continua funcionando — ela também consulta a cada 3
segundos. A chamada só deixa de ser instantânea.

## 7. O primeiro usuário

O seed **não cria usuário**. Criar à mão:

1. Supabase > Authentication > Users > Add user (com e-mail e senha)
2. Rodar os dois INSERTs do `SETUP.md` (`profiles` e `user_roles`)

**Confira `tenant_id` e o papel antes de sair da tela.** Usuário autenticado
sem perfil completo vê a mensagem "Seu acesso ainda não está liberado" no
login — não é mais tela branca, mas também não entra.

## 8. Usuários do totem e das duas TVs

`/totem`, `/tv1` e `/tv2` **exigem login**. Criar um usuário para cada
(permissões `totem.operar` e `painel.operar`), entrar nas máquinas e deixar a
sessão aberta.

Se faltar: a tela de login aparece na frente do paciente.

## 9. Os oito médicos

Pela tela `/usuarios`. Cada médico precisa de:

- **número do conselho (CRM)** — sem ele o A.S.O. é recusado na emissão, com
  a instrução de onde cadastrar
- **assinatura** — cada médico desenha a própria em Perfil. Sem ela, o A.S.O.
  sai com a linha e o nome, e a emissão avisa

## 10. Dados da clínica e chave Pix

Em Configurações: CNPJ, endereço, contato, responsável técnico, e a **chave
Pix** (Configurações > Pagamento e Pix).

Sem a chave Pix, a cobrança por Pix recusa com a frase explicando onde
cadastrar. Dinheiro e cartão seguem funcionando.

## 11. O teste único

Abrir `/api/health`. Precisa responder:

```
status: "ok"
tenants: 1 ou mais
serviceRole: true
migrations: true
```

Qualquer outra resposta vem com `hint` em português dizendo o que falta.

---

## Se for reaproveitar o banco de teste

`supabase/scripts/ZERAR-PARA-O-PRIMEIRO-DIA.sql` apaga os atendimentos de
teste e preserva usuários, médicos, salas, exames e configurações. Ele também
libera as salas que ficaram travadas.

O SQL não apaga arquivo: os PDFs de teste continuam no bucket
`clinical-documents` e precisam ser removidos à mão no painel do Supabase.

---

## Duas coisas para avisar a equipe

**Nos campos de valor, vírgula funciona.** "1.234,56" e "1234.56" são lidos
igual. O que não vale é usar ponto como separador de milhar sem os centavos:
"1.234" é entendido como mil duzentos e trinta e quatro, e é isso que a
clínica quer dizer.

**Documento clínico não aparece no portal do paciente.** O portal (`/meu`)
entra com CPF e data de nascimento, que são os dois campos impressos no
A.S.O. que vai ao RH. Por isso ele mostra só recibo, comprovante, atestado de
comparecimento e guia. Ficha clínica, avaliação psicossocial, laudo e A.S.O.
continuam saindo pela clínica, em mãos.
