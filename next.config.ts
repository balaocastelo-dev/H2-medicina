import type { NextConfig } from 'next';

const supabaseHost = (() => {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL
      ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
      : undefined;
  } catch {
    return undefined;
  }
})();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    serverActions: {
      // O padrao do Next e 1 MB, e o anexo de exame da recepcao e o unico
      // arquivo que sobe por Server Action. A validacao de tamanho no codigo
      // nunca era alcancada: um laudo escaneado de 3 MB morria antes, com
      // erro cru de framework ("Body exceeded 1 MB limit") em vez da
      // mensagem em portugues.
      //
      // 4 MB porque o teto da Vercel e 4,5 MB no corpo da requisicao — pedir
      // mais aqui so trocaria um erro por outro, mais tarde e mais confuso.
      // Arquivo maior que isso precisa subir direto ao Storage; a mensagem do
      // servidor diz o limite.
      bodySizeLimit: '4mb',
    },
  },
  turbopack: {
    root: process.cwd(),
  },
  // O gerador de PDF le o logo direto do disco. Nada em `public/` e
  // importado por codigo, entao o rastreador do Next nao levaria esses
  // arquivos para a funcao serverless sem esta instrucao.
  outputFileTracingIncludes: {
    '/**': ['./public/marca/**'],
  },
  images: {
    remotePatterns: supabaseHost
      ? [{ protocol: 'https', hostname: supabaseHost, pathname: '/storage/v1/object/**' }]
      : [],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
