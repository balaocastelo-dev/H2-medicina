/**
 * Substituto de `server-only` nos testes.
 *
 * O pacote real lanca no import para impedir que codigo de servidor vaze
 * para o bundle do navegador. Essa protecao vale no build do Next; em
 * vitest ela so impediria testar os modulos de servidor.
 */
export {};
