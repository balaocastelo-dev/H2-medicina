-- =====================================================================
-- 0038 - A avaliacao psicossocial ganha ficha propria
--
-- "a avaliacao psicossocial que saiu nela, nao deve estar junto, precisa
--  sair em uma ficha separada"
--                                              -- Isabella, 23/09
--
-- Ela saia dentro da ficha clinica. Sao dois papeis com destinos
-- diferentes: a ficha clinica vai para a empresa contratante, e o
-- questionario psicossocial traz pergunta sobre ideacao suicida, sono e
-- humor. Misturar os dois manda ao RH da empresa uma informacao que nao e
-- dele.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================

alter type document_kind add value if not exists 'avaliacao_psicossocial';
