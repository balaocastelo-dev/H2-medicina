/**
 * Corpo clinico informado pela clinica para o pre-cadastro.
 *
 * Fica aqui como lista de partida da tela de pre-cadastro, nao como regra
 * do sistema: os dados vao para o banco na primeira execucao e a partir
 * dai sao editados pelo painel, como qualquer outro usuario.
 */

export interface MedicoInicial {
  nome: string;
  conselho: string;
  numero: string;
  uf: string;
}

export const MEDICOS_INICIAIS: MedicoInicial[] = [
  { nome: 'Antonio Pires Correia', conselho: 'CRM', numero: '90241', uf: 'SP' },
  { nome: 'Ana Beatriz Bernardi de Souza', conselho: 'CRM', numero: '267063', uf: 'SP' },
  { nome: 'Vanessa Sanches Picasso', conselho: 'CRM', numero: '143127', uf: 'SP' },
  { nome: 'Ana Laura Satti', conselho: 'CRM', numero: '198618', uf: 'SP' },
  { nome: 'Daniely Miwa Hata Sakay', conselho: 'CRM', numero: '249063', uf: 'SP' },
  { nome: 'Bianka Souza Oliveira Christofoletti', conselho: 'CRM', numero: '280831', uf: 'SP' },
  { nome: 'Francimara Vilas Boas', conselho: 'CRM', numero: '239512', uf: 'SP' },
  { nome: 'Wania Sanches Picasso', conselho: 'CRM', numero: '79775', uf: 'SP' },
];

/**
 * E-mail provisorio de quem ainda nao definiu o proprio acesso.
 *
 * O login do Supabase exige e-mail, e o medico so escolhe o dele quando
 * for usar o sistema. O endereco derivado do registro e unico, nao recebe
 * mensagem e deixa obvio na lista de usuarios quem ainda esta pendente.
 */
export function emailProvisorio(conselho: string, numero: string, dominio: string): string {
  const limpo = dominio.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  return `${conselho.toLowerCase()}${numero}@pendente.${limpo || 'local'}`;
}

/** O acesso ainda nao foi definido pelo profissional? */
export function acessoPendente(email: string | null | undefined): boolean {
  return !!email && /@pendente\./i.test(email);
}
