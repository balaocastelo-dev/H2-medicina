# DATABASE — modelo de dados

83 tabelas no schema `public`, 2 no schema `private`, 322 policies de RLS.
Todas as migrations sao idempotentes e validadas contra um PostgreSQL real
(`npm run validate:sql`).

## Convencoes

- Chave primaria `uuid` (`gen_random_uuid()`), exceto logs (`bigserial`).
- `tenant_id` em toda tabela de negocio, com FK para `tenants`.
- `created_at` / `updated_at` (`timestamptz`), `created_by` / `updated_by` (uuid).
- Soft delete via `deleted_at` onde faz sentido.
- Unicidade sempre **por tenant** (indices parciais com `where deleted_at is null`).
- Trigger `set_updated_at` nas tabelas mutaveis.

## Migrations

| Arquivo                            | Conteudo                                                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| `0001_extensions_and_helpers`      | extensoes, enums, `is_valid_cpf`, `is_valid_cnpj`, `calc_bmi`, `normalize_text`                    |
| `0002_tenants_and_identity`        | tenants, settings, branding, modules, profiles, roles, permissions, helpers de RLS                 |
| `0003_companies_and_patients`      | empresas, contatos, contratos, pacientes, vinculos, duplicidades, consentimentos                   |
| `0004_scheduling_queues_rooms`     | exam_types, rooms, crm_stages, appointments, attendances, totems, tickets, queue_events, tv_calls  |
| `0005_clinical`                    | triages, patient_exams, exam_results, medical_consultations, anexos                                |
| `0006_crm_documents_notifications` | crm_movements, templates, documents, entregas, visualizacoes, notificacoes                         |
| `0007_finance`                     | payments, payment_transactions, pix_charges, caixa                                                 |
| `0008_ecommerce`                   | categorias, produtos, variacoes, pacotes, carrinho, pedidos, cupons, promocoes, estoque            |
| `0009_scraper_and_import`          | conectores, campos, mapeamentos, execucoes, brutos, normalizados, revisao, conflitos               |
| `0010_campaigns_settings_audit`    | campanhas, destinatarios, eventos, descadastro, provedores, auditoria, LGPD                        |
| `0011_permissions_catalog`         | catalogo global de 40 permissoes                                                                   |
| `0012_rls_policies`                | RLS + policies em todas as tabelas                                                                 |
| `0013_automation_and_rpc`          | triggers do CRM automatico e RPCs `checkin_patient`, `call_next_for_room`, `move_attendance_stage` |
| `0014_storage_buckets`             | 8 buckets e policies por tenant                                                                    |
| `0015_private_secrets`             | segredos no schema `private` + views seguras                                                       |

## Nucleo do fluxo clinico

```
appointments ──► attendances ──► patient_exams ──► exam_results
     │                │                                  │
     │                ├──► triages                       │
     │                ├──► medical_consultations ◄────────┘
     │                ├──► queue_tickets / queue_events / tv_calls
     │                ├──► crm_movements
     │                ├──► payments
     │                └──► documents
     └──► appointment_exams ──► exam_types ──► rooms
```

`attendances.stage_code` referencia `crm_stages.code` (configuravel por tenant) —
por isso as colunas do CRM sao dados, nao um enum fixo.

## Automacoes no banco

O CRM se move sozinho por trigger, nao por codigo de aplicacao:

| Evento                              | Efeito em `attendances.stage_code`             |
| ----------------------------------- | ---------------------------------------------- |
| `checkin_patient()`                 | `aguardando_recepcao` + senha + fila de exames |
| inicio da recepcao                  | `na_recepcao`                                  |
| fim da recepcao                     | `aguardando_triagem` ou `aguardando_exames`    |
| insert em `triages`                 | `em_triagem`                                   |
| `triages.finished_at`               | `aguardando_exames`                            |
| exame em `chamado`/`em_andamento`   | `em_exames`                                    |
| ultimo exame concluido              | `aguardando_medico`                            |
| insert em `medical_consultations`   | `em_consulta`                                  |
| `medical_consultations.finished_at` | `aguardando_documentos`                        |
| `move_attendance_stage()`           | qualquer estagio (exige `crm.mover_manual`)    |

Toda transicao grava `crm_movements` com estagio anterior, novo, autor,
se foi manual e quantos segundos ficou na etapa anterior.

## Regras de integridade relevantes

| Indice / constraint                                   | O que impede                                            |
| ----------------------------------------------------- | ------------------------------------------------------- |
| `uq_patients_tenant_cpf`                              | dois pacientes com o mesmo CPF no tenant                |
| `uq_appointments_patient_day`                         | dois agendamentos ativos do mesmo paciente no mesmo dia |
| `uq_patient_exam_in_service`                          | o mesmo paciente chamado em duas salas ao mesmo tempo   |
| `uq_scraper_run_active`                               | duas execucoes simultaneas do mesmo conector            |
| `uq_scraper_norm_source`                              | reimportar o mesmo registro (idempotencia)              |
| `patients_cpf_valid` / `companies_document_valid`     | CPF/CNPJ com digito verificador invalido                |
| `uq_queue_tickets` (tenant, data, prefixo, sequencia) | senha duplicada no dia                                  |

## Deduplicacao da importacao

Chave de origem: **tenant + conector + identificador externo + data de referencia**.
Reexecutar a mesma coleta atualiza em vez de inserir.

Ordem das regras de vinculo:

1. mesmo CPF → atualiza o paciente existente
2. mesmo identificador externo → atualiza o registro vinculado
3. mesmo nome + data de nascimento → sugere vinculo (revisao)
4. mesmo nome + empresa + data de atendimento → possivel duplicidade
5. identificacao insuficiente → `patient_duplicates` para revisao manual

Conflito de campo nunca sobrescreve em silencio: vai para `import_conflicts`
com valor atual, valor recebido e origem.

## Rastreabilidade da importacao

`scraper_raw_records.raw` guarda o payload original intacto.
`scraper_normalized_records.field_trace` guarda, por campo:
nome original, valor original, valor normalizado e confianca do mapeamento.
Nada e descartado — o valor bruto sempre pode ser auditado.

## Storage

| Bucket               | Publico | Conteudo             |
| -------------------- | ------- | -------------------- |
| `branding`           | sim     | logos, favicon       |
| `ecommerce`          | sim     | imagens de produtos  |
| `clinical-documents` | **nao** | PDFs clinicos        |
| `exam-results`       | **nao** | laudos               |
| `signatures`         | **nao** | assinaturas          |
| `imports`            | **nao** | planilhas importadas |
| `scraper-evidence`   | **nao** | evidencias tecnicas  |
| `attachments`        | **nao** | anexos do paciente   |

Convencao de caminho: `<tenant_id>/<subpasta>/<arquivo>`.
As policies validam o primeiro segmento contra a permissao do usuario.
