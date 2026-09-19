-- =====================================================================
-- Tipo de documento: guia de exame
--
-- "Aba recepcao esta dando erro ao imprimir a guia" -- Isabella, 18/09.
--
-- `documents.kind` e um enum do Postgres. A guia foi construida em 17/09
-- com o tipo 'guia_exame', que existia no TypeScript mas nunca foi
-- adicionado ao enum. Toda emissao falhava na gravacao, depois do PDF ja
-- montado -- a recepcao via "erro" sem nenhuma pista do motivo.
--
-- Mesmo erro de classe da permissao inventada de 13/09: passa no
-- compilador, passa nos testes, e quebra na frente de quem usa. O
-- `check:build` passou a conferir isso tambem.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================

alter type document_kind add value if not exists 'guia_exame';
