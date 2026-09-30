/**
 * Quem esta ligado agora: o banco do teste e o usuario logado.
 *
 * As server actions importam `createClient` no topo do arquivo, uma unica
 * vez. Nao da para passar um banco por parametro sem reescrever as 137
 * acoes do sistema -- e reescrever as acoes para poder testa-las seria
 * testar outra coisa.
 *
 * Entao o caminho e o inverso: o modulo de acesso ao banco e substituido
 * uma vez (em `tests/setup-acoes.ts`) por uma versao que pergunta a este
 * arquivo qual banco e qual usuario valem no momento. O codigo de producao
 * fica intacto, byte por byte.
 */
import type { PGlite } from '@electric-sql/pglite';
import {
  ArmazenamentoDeMentira,
  criarClienteDeMentira,
  type ClienteDeMentira,
  type Esquema,
} from './postgrest-de-mentira';

interface Ligado {
  db: PGlite;
  esquema: Esquema;
  storage: ArmazenamentoDeMentira;
  usuario: { id: string; email: string } | null;
}

let ligado: Ligado | null = null;

export function ligarBanco(db: PGlite, esquema: Esquema): ArmazenamentoDeMentira {
  const storage = new ArmazenamentoDeMentira();
  ligado = { db, esquema, storage, usuario: null };
  return storage;
}

export function desligarBanco(): void {
  ligado = null;
}

export function trocarUsuario(usuario: { id: string; email: string } | null): void {
  if (!ligado) throw new Error('nenhum banco ligado');
  ligado.usuario = usuario;
}

export function usuarioLigado(): { id: string; email: string } | null {
  return ligado?.usuario ?? null;
}

export function bancoLigado(): PGlite {
  if (!ligado) throw new Error('nenhum banco ligado');
  return ligado.db;
}

/**
 * Os arquivos que o sistema gravou no armazenamento durante o teste.
 *
 * A chave e "balde/caminho", igual ao que `documents.file_path` guarda com
 * o balde na frente. Serve para conferir que todo documento do banco tem
 * arquivo de verdade por tras -- e para escrever os PDFs em disco quando o
 * teste precisa entregar amostras.
 */
export function arquivosDoStorage(): Map<string, Uint8Array> {
  if (!ligado) throw new Error('nenhum banco ligado');
  return ligado.storage.arquivos;
}

export function clienteDoMomento(): ClienteDeMentira {
  if (!ligado) {
    throw new Error(
      'nenhum banco ligado: chame montarClinica() antes de exercitar uma server action',
    );
  }
  return criarClienteDeMentira(ligado.db, ligado.esquema, ligado.storage, () => ligado!.usuario);
}
