// A URL de conexão do blog e o prompt de implementação que a acompanha.
//
// SEM IMPORT DE BANCO, de propósito — a mesma separação de lib/webhooks.ts e de
// lib/blog-pauta-tipos.ts: quem chama isto é o painel de Conexão, componente de
// cliente. Uma linha de `import { sql }` aqui arrastaria o driver do Postgres
// (net/tls) para o bundle do navegador e o build quebraria em "module not
// found: net". Quem consulta o banco é lib/blog-publico.ts.
import type { Blog } from "@/lib/artigo";

/** O endereço que o site consome. Sem barra no fim; `base` também não tem. */
export function urlDeConexao(base: string, chave: string): string {
  return `${base}/api/publico/${chave}/artigos`;
}

/**
 * O prompt copiável.
 *
 * É um PROMPT, não documentação: o destinatário é uma IA trabalhando no código
 * do SITE que vai exibir o blog. Por isso começa dizendo o que construir, traz
 * o contrato exato das duas rotas e termina com as restrições — que são a parte
 * que uma IA sem contexto erraria sozinha:
 *
 *  · a chave vai na URL e é segredo: buscar do servidor, com a URL em variável
 *    de ambiente, nunca de JavaScript no navegador do visitante;
 *  · o slug da listagem é o MESMO da rota do site e o MESMO do pedido à API —
 *    reslugificar o título produz um endereço que a API não conhece;
 *  · o `html` já vem renderizado e escapado; rodar outro markdown por cima
 *    duplicaria o trabalho e é onde se abre XSS.
 */
export function promptDeImplementacao(
  blog: Pick<Blog, "nome" | "descricao" | "url_base" | "autor" | "chave">,
  base: string,
): string {
  const url = urlDeConexao(base, blog.chave);
  const caminho = caminhoDoBlog(blog.url_base);

  return `Implemente as páginas do blog "${blog.nome}" no site, consumindo o CRM Chroma.
${blog.descricao ? `\nSobre o blog: ${blog.descricao}\n` : ""}
Duas páginas: a LISTA de artigos e a página de UM artigo, cujo endereço termina
no slug do artigo (ex.: ${caminho}/como-escolher-o-piso-certo).

## Endpoints

Lista de artigos:

    GET ${url}

Um artigo, pelo slug:

    GET ${url}/{slug}

Sem header de autenticação: a chave já está na URL. Só GET.

## Resposta da lista

\`\`\`json
{
  "blog": { "nome": "${blog.nome}", "descricao": "...", "url_base": "${blog.url_base || ""}", "autor": "${blog.autor || ""}" },
  "artigos": [
    {
      "slug": "como-escolher-o-piso-certo",
      "titulo": "Como escolher o piso certo",
      "resumo": "...",
      "meta_title": "...",
      "meta_description": "...",
      "palavra_chave": "piso vinílico",
      "keywords": ["piso vinílico", "piso laminado"],
      "imagem_alt": "...",
      "url": "${blog.url_base || "https://seusite.com.br/blog"}/como-escolher-o-piso-certo",
      "palavras": 1320,
      "minutos": 6,
      "criado_em": "2026-01-20T12:00:00Z",
      "atualizado_em": "2026-01-22T09:30:00Z"
    }
  ]
}
\`\`\`

Os artigos já vêm do mais novo para o mais antigo — não reordene. Use \`titulo\`,
\`resumo\` e \`minutos\` nos cartões da listagem, e \`slug\` para montar o link de
cada um: \`${caminho}/{slug}\`.

## Resposta do artigo

O mesmo objeto da lista, com o corpo a mais:

| campo | o que é |
| --- | --- |
| \`html\` | o \`<article>\` inteiro, pronto para injetar |
| \`markdown\` | a mesma coisa em markdown, se preferir renderizar você |
| \`sumario\` | \`[{ nivel, id, texto }]\` — índice ancorado nos ids que estão no \`html\` |
| \`meta_tags\` | bloco de \`<title>\`, \`<meta>\` e \`<link rel="canonical">\` para o \`<head>\` |
| \`json_ld\` | array de objetos de dados estruturados (BlogPosting e, quando cabem, FAQPage e BreadcrumbList) |
| \`autor\` | assinatura do artigo |
| \`fonte\` | \`{ titulo, url }\` da matéria que originou o artigo, ou \`null\` |

O envelope vem como \`{ "blog": {...}, "artigo": {...} }\`.

Na página do artigo:

1. injete \`artigo.html\` como HTML (ele já vem escapado e com os links filtrados);
2. jogue \`artigo.meta_tags\` no \`<head>\`, ou monte as tags a partir de
   \`meta_title\`/\`meta_description\`/\`url\` se o seu framework preferir objeto;
3. imprima cada item de \`artigo.json_ld\` num
   \`<script type="application/ld+json">\`;
4. se \`artigo.fonte\` não for \`null\`, cite a matéria de origem com link.

## Respostas de erro

- \`404 { "error": "Não encontrado." }\` — slug inexistente, artigo ainda não
  aprovado, ou chave errada. Na página do artigo, trate como página 404 do site.
- \`5xx\` — falha temporária do CRM. Sirva o cache anterior se houver.

## Restrições importantes

1. Busque do SERVIDOR (Server Component, getStaticProps, rota de API, build
   step) — nunca de JavaScript rodando no navegador do visitante. A chave está
   na URL e ficaria visível para qualquer pessoa que abrisse o DevTools.
2. Guarde a URL inteira numa variável de ambiente (ex.: \`BLOG_API\`). Não
   escreva a chave no código versionado.
3. O \`slug\` é o endereço, dos dois lados: o que sai na lista é o que vai na URL
   da sua página E o que você manda no GET do artigo. Não gere slug a partir do
   título, não troque hífen por barra, não force minúsculas de novo.
4. Não rode um renderizador de markdown por cima de \`html\` — ele já está
   pronto. Use \`markdown\` só se for renderizar a partir dele, nunca os dois.
5. A API só devolve artigo aprovado. Artigo que some da lista foi despublicado
   no CRM: a sua página dele deve passar a responder 404, não ficar em cache
   para sempre.
6. Revalide a cada 5 minutos (é o cache que a API já declara). Não busque a
   cada request sem cache, e não cacheie para sempre.
7. As rotas do site devem bater com \`url_base\` (${blog.url_base || "ainda não configurado no CRM"}) — é dele que sai o canonical
   que vem em \`meta_tags\`. Se o caminho do blog no site for outro, corrija o
   endereço do blog no CRM em vez de reescrever o canonical aqui.`;
}

/**
 * O caminho do blog no site, para os exemplos do prompt: "/blog" a partir de
 * "https://site.com.br/blog". Sem `url_base` configurada, chuta "/blog" — é o
 * que todo site usa, e o prompt já manda conferir com o CRM.
 */
function caminhoDoBlog(urlBase: string): string {
  try {
    const caminho = new URL(urlBase).pathname.replace(/\/+$/, "");
    return caminho || "/blog";
  } catch {
    return "/blog";
  }
}
