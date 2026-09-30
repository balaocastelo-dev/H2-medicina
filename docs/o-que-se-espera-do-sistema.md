# O que se espera do sistema

Levantamento feito antes da varredura de 50 rotas, para que "testar tudo"
signifique alguma coisa. Sem este mapa, "todas as possibilidades" é força de
expressão.

O documento não descreve o que o código faz — descreve o que a clínica
espera que aconteça. Quando os dois discordam, é defeito.

---

## 1. O tamanho do sistema

| | |
|---|---|
| Telas (rotas) | 59 |
| Ações de servidor | 107 |
| Tabelas com RLS ligado e forçado | 92 |
| Papéis | 3 (`administrativo`, `medico_examinador`, `atendimento`) |
| Etapas do atendimento | 14 |
| Tabelas em tempo real | 2 (`tv_calls`, `attendances`) |

---

## 2. As etapas do paciente, e quem o move

O atendimento é uma máquina de estados. Cada seta é um botão numa tela.

```
                    ┌──────────────┐
                    │  agendado    │  (agenda, importação, site)
                    └──────┬───────┘
                           │ totem: check-in
                    ┌──────▼───────┐
                    │   checkin    │
                    └──────┬───────┘
                           │
                 ┌─────────▼──────────┐
                 │ aguardando_recepcao│
                 └─────────┬──────────┘
                           │ recepção: iniciar
                    ┌──────▼───────┐
                    │  na_recepcao │  ← define procedência, exames,
                    └──────┬───────┘     procedimento, cobrança
              ┌────────────┼────────────┬──────────────┐
              │            │            │              │
   ┌──────────▼──┐  ┌──────▼──────┐  ┌──▼──────────┐  │
   │ aguardando_ │  │ aguardando_ │  │ aguardando_ │  │
   │   triagem   │  │   exames    │  │   medico    │  │
   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  │
          │ triagem        │ salas          │ consulta │
          └────────┬───────┴────────┬───────┘          │
                   │                │                  │
            ┌──────▼──────┐  ┌──────▼───────────┐      │
            │ em_triagem  │  │   em_exames      │      │
            └─────────────┘  └──────────────────┘      │
                                                       │
                    ┌──────────────────────────────────┘
                    │
        ┌───────────▼────────────┐
        │ aguardando_documentos  │ ← kit de saída
        │ aguardando_pagamento   │ ← caixa
        └───────────┬────────────┘
                    │
             ┌──────▼──────┐
             │ finalizado  │
             └─────────────┘

   Saídas a qualquer momento: cancelado · ausente
```

**O que se espera, e é invariante:** em nenhum momento o paciente pode ficar
numa etapa que nenhuma tela lista. Foi esse o defeito de 15/09 e ele voltou
três vezes desde então, sempre pela mesma porta: alguém mexe em quem decide
o destino e esquece um dos pontos de decisão.

Os pontos de decisão do destino são **quatro**, e precisam concordar:

1. `proximaEtapaDaRecepcao` (TypeScript) — quando a recepção libera;
2. `encaminharDepoisDaTriagem` (TypeScript) — quando a triagem finaliza;
3. `tg_triage_finished` (gatilho SQL) — idem, no banco;
4. `tg_patient_exam_progress` (gatilho SQL) — quando o último exame conclui.

---

## 3. As rotas de entrada

| Rota | O que se espera |
|---|---|
| Agendamento prévio + totem | O totem acha o agendamento e vincula ao atendimento |
| Sem agendamento (walk-in) | O totem cria o atendimento assim mesmo, com senha |
| Agendamento avulso pela empresa | Vários funcionários de uma vez, com os mesmos exames |
| Importação da agenda (colar texto) | Não duplica quem já está agendado no dia |
| Reserva pelo site | Vira pedido, e alguém confirma ou recusa |

---

## 4. As decisões da recepção

São elas que definem o percurso. Quatro eixos, combináveis:

- **Procedência:** particular · estado (perícia) · SISPER · ingresso
  escolar. Decide quem custeia e se a avaliação médica é o motivo da visita.
- **Triagem:** sim ou não. A procedência sugere; a recepção decide.
- **Exames:** nenhum, um, vários. Com sala, sem sala, ou feitos fora.
- **Procedimento:** nenhum ou um do catálogo. Decide o repasse do médico e
  se há ficha clínica.

**O que se espera:** o valor mostrado no balcão tem de ser **o mesmo** que a
cobrança vai gerar — inclusive quando a empresa tem valor negociado.

---

## 5. As rotas de exceção

São as que quase nunca se testa, e onde os defeitos moram.

| Rota | O que se espera |
|---|---|
| Repetir a chamada da senha | Chama de novo sem duplicar o atendimento |
| Devolver o exame para a fila | Volta a `pendente`, solta a sala, some do painel |
| Exame não realizado | Segue o percurso sem o exame, com o motivo gravado |
| Devolver o paciente para a fila do médico | Solta o consultório, volta a `aguardando_medico` |
| Remanejar o exame de sala | A sala nova chama, a antiga para |
| Cancelar no meio | Solta paciente, sala e exames; não gera cobrança paga |
| Marcar ausente | Mesma coisa, com outro motivo |
| Voltar o cartão no CRM | Desfaz as marcas de encerramento; não pode sumir |
| Salvar rascunho e finalizar depois | Finalizar depois **não** pode desassinar o que já foi assinado |
| Gerar cobrança duas vezes | Reaproveita a pendente; não empilha lançamentos |
| Pagamento por faturamento | Libera documentos sem exigir pagamento no balcão |
| Termo de autorização | Registra o consentimento — senão o termo não prova nada |
| Guia de exame no balcão | Sai para raio X e coleta, que não entram em fila |
| Laudo que chega depois | Anexa ao cadastro e acompanha o paciente na unificação |
| Unificar dois cadastros | Leva junto atendimentos, documentos e anexos |

---

## 6. O que cada papel precisa conseguir fazer

Um papel que pode **prender** e não pode **soltar** é um jeito de perder o
dia. Foi o defeito de 29/09.

| Papel | Precisa conseguir | Não pode conseguir |
|---|---|---|
| `atendimento` | Cadastrar, check-in, recepção, cobrar, chamar na sala, **concluir exame**, encerrar | Ler prontuário, assinar consulta, mexer no cadastro de exames |
| `medico_examinador` | Triagem, chamar na sala, preencher ficha, chamar no consultório, assinar, emitir documentos | Mexer no cadastro de exames, no financeiro da clínica |
| `administrativo` | Tudo | — |

**Armadilha a vigiar:** com RLS ligado, `INSERT` barrado **levanta erro**,
mas `UPDATE` barrado **não levanta nada** — apenas não encontra linha. Uma
gravação barrada em silêncio vira mensagem errada na tela.

---

## 7. Os pontos de sincronismo

| Onde | Como | O que se espera |
|---|---|---|
| Painel de TV | Realtime em `tv_calls` | A senha aparece na TV no instante da chamada |
| Quadro de filas | Realtime em `attendances` | Duas recepcionistas veem a mesma fila |
| Recepção | `router.refresh()` periódico | Quem chega no totem aparece sem recarregar |
| Área do paciente (`/meu`) | Polling | O paciente acompanha sem logar |
| Módulo médico | `router.refresh()` após ação | O consultório some da lista ao ser ocupado |

**O que se espera:** dois operadores clicando ao mesmo tempo não podem
chamar o mesmo paciente. A trava é `for update skip locked` no banco, não a
tela.

---

## 8. Os documentos, e quando cada um sai

| Documento | Quando sai | Quem consegue emitir |
|---|---|---|
| Guia de exame | Na recepção, para raio X e coleta | Quem opera a recepção |
| Laudo de exame | Na sala, ao concluir | Quem preencheu a ficha |
| A.S.O. | Ao médico assinar a consulta | Só quem lê a consulta |
| Ficha clínica | Ao médico assinar | Só quem lê a consulta |
| Avaliação psicossocial | No kit, se respondida | Só quem lê a consulta |
| Comprovantes e recibo | No kit de saída | Qualquer um que encerre |
| Termo de autorização | Na recepção, quando exigido | Quem emite documentos |

**O que se espera:** nenhum documento sai **em branco**. Se quem clicou não
enxerga o conteúdo, o sistema recusa e diz por quê — não produz papel vazio
assinado.

---

## 9. O dinheiro

| Regra | O que se espera |
|---|---|
| Preço do exame | Contrato → empresa → tabela, nessa ordem |
| Tela e cobrança | O mesmo número nas duas |
| Estado, SISPER, ingresso | Não geram cobrança: custeados pela origem |
| Repasse do médico | Nasce da consulta assinada, com o valor **dele** |
| Repasse duplicado | Nunca, para o mesmo atendimento |
| Cancelado | Não gera cobrança paga |

---

## 10. O que esta varredura NÃO cobre

Dito antes de começar, para o resultado não ser lido como mais do que é:

- **A aparência das telas.** Os testes conferem dados e regras, não layout,
  cor, alinhamento ou o que sai na impressora.
- **O navegador.** Cliques reais, campos de formulário, comportamento em
  celular, realtime chegando de fato à TV.
- **A infraestrutura.** Lentidão, queda do Supabase, timeout de rede.
- **Regras que a clínica ainda não contou.** O sistema só pode ser cobrado
  pelo que se sabe que ele deve fazer.
