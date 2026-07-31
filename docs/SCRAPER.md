# Modulo de importacao (scraper autorizado)

## Uso permitido

Somente em portais para os quais o tenant **possui autorizacao expressa**.
A execucao fica bloqueada enquanto `scraper_connectors.authorization_confirmed`
for falso.

Nao existe e nao sera implementado: quebra de CAPTCHA, contorno de autenticacao
ou MFA, exploracao de vulnerabilidade, descoberta de senha, acesso nao
autorizado, evasao de bloqueios ou coleta fora do escopo autorizado.

Havendo API oficial ou exportacao, prefira `kind = api | csv | excel`.

## Configuracao (painel)

Nome, tenant, URL inicial, URL da agenda, tipo de autenticacao, usuario, senha,
campos adicionais, seletores CSS/XPath, regras de navegacao e paginacao, filtros
de data, frequencia, timezone, mapeamento de campos, situacao e modo de execucao
(`teste` / `homologacao` / `producao`).

A senha e gravada por `public.set_connector_password(connector, senha, chave)`,
que cifra com `pgp_sym_encrypt` e guarda em `private.connector_secrets`.
Nunca retorna ao navegador nem aparece em log.

## Execucao

Playwright roda em worker isolado no backend — nunca no navegador do usuario.
Se a hospedagem for serverless, use um container/VM separado.

Controles ja no banco: fila, execucao manual e agendada, timeout, tentativas,
lock de concorrencia (`uq_scraper_run_active`), captura de erro, evidencia em
bucket privado, historico e logs tecnicos por etapa.

## Fluxo

1. cria `scraper_runs` → 2. le a configuracao → 3. decifra a credencial no
backend → 4. acessa e autentica → 5. navega ate a agenda → 6. seleciona a data →
7. percorre a paginacao → 8. coleta → 9. grava o payload bruto →
10. normaliza → 11. valida → 12. calcula confianca → 13. detecta duplicidade →
14. monta a previa → 15. aprovacao → 16. cria/atualiza empresa, paciente e
agendamento → 17. atribui exames → 18. registra origem e erros por linha →
19. resumo e ultima execucao.

## Normalizacao

CPF, CNPJ, telefone, e-mail, data, hora, nome, razao social, UF, CEP, sexo,
status e tipo de exame. **O valor original nunca e descartado** —
`scraper_normalized_records.field_trace` guarda nome original, valor original,
valor normalizado e confianca por campo.

Havendo data de nascimento, a idade e recalculada. Se idade e data conflitarem,
a data prevalece e o registro vai para revisao.

## Idempotencia

Chave de origem: **tenant + conector + identificador externo + data de
referencia**. Rodar a mesma coleta duas vezes atualiza, nunca duplica.

## Aprovacao

Modo inicial obrigatorio: **aprovacao humana**. A previa mostra total coletado,
novos, existentes, duplicidades, erros, campos ausentes e conflitos. E possivel
aprovar tudo, aprovar item a item, corrigir campos, ignorar registros, vincular
duplicidades ou escolher empresa existente. Automatico e opt-in por conector.
