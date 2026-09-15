# Conexão do blog com o site

O CRM escreve os artigos; o site do cliente os exibe. A ponte entre os dois são
duas URLs públicas, uma por blog, com uma **chave** no caminho.

A chave fica na tela do blog (`/blog/<id>`, painel "Conexão com o site"), com
botão de copiar e de trocar. Ela nasce junto com o blog — não há blog sem.

## As duas URLs

```
GET  {CRM}/api/publico/{chave}/artigos          → o índice
GET  {CRM}/api/publico/{chave}/artigos/{slug}   → um artigo
```

O `slug` da segunda é o mesmo que sai em cada item da primeira. É ele que o site
usa no próprio endereço: `meusite.com.br/blog/como-escolher-piso` vira
`/api/publico/bk_…/artigos/como-escolher-piso`.

**Só artigo aprovado sai.** Pendente é trabalho interno do CRM — aprovar é o que
publica. Um artigo sem slug também não aparece, e por isso aprovar preenche o
slug a partir do título quando ele está vazio.

Chave errada e artigo inexistente devolvem o mesmo `404 {"error":"Não
encontrado."}`, de propósito: respostas diferentes deixariam descobrir chaves
válidas por tentativa.

## O que volta

Índice:

```jsonc
{
  "blog": { "nome": "…", "descricao": "…", "url_base": "…", "autor": "…" },
  "artigos": [
    {
      "slug": "como-escolher-piso",
      "titulo": "…",
      "resumo": "…",
      "meta_title": "…",          // cai no título quando vazio
      "meta_description": "…",    // cai no resumo quando vazio
      "palavra_chave": "…",
      "keywords": ["…"],          // array, não string
      "imagem_alt": "…",
      "url": "https://site.com.br/blog/como-escolher-piso",  // "" sem url_base
      "palavras": 1320,
      "minutos": 6,
      "criado_em": "2026-09-14T12:00:00Z",
      "atualizado_em": "2026-09-14T12:00:00Z"
    }
  ]
}
```

Artigo: o mesmo objeto do índice **mais** o corpo —

| campo       | o que é                                                        |
| ----------- | -------------------------------------------------------------- |
| `html`      | o `<article>` pronto, já com os ids das seções                  |
| `markdown`  | a fonte, para quem quiser renderizar do seu jeito               |
| `sumario`   | `[{ nivel, id, texto }]` — o índice, ancorado nos ids do `html` |
| `meta_tags` | bloco de `<title>`/`<meta>`/`<link rel=canonical>` para o `<head>` |
| `json_ld`   | BlogPosting, e FAQPage/BreadcrumbList quando cabem              |
| `autor`     | a assinatura padrão do blog                                     |
| `fonte`     | `{ titulo, url }` da matéria de origem, ou `null`               |

O envelope `{ blog, artigo }` repete os dados do blog — a página do post não
precisa buscar o índice para saber o nome e o autor.

## Consumindo

```tsx
// app/blog/[slug]/page.tsx no site do cliente
const BASE = process.env.BLOG_API!; // …/api/publico/bk_…/artigos

export default async function Post({ params }) {
  const { slug } = await params;
  const r = await fetch(`${BASE}/${slug}`, { next: { revalidate: 300 } });
  if (!r.ok) notFound();

  const { artigo } = await r.json();
  return <article dangerouslySetInnerHTML={{ __html: artigo.html }} />;
}
```

A chave é segredo de configuração: guarde em variável de ambiente do site, não
no código do cliente.

## Cache e CORS

As respostas saem com `s-maxage=300, stale-while-revalidate=1800` — aprovar um
artigo aparece no site em até cinco minutos, e uma rajada de acessos não vira
uma rajada de consultas ao banco. Se o site precisar de menos atraso, ele manda:
`revalidate` do lado dele é quem decide.

`Access-Control-Allow-Origin: *`, só `GET` e `OPTIONS`. É aberto porque o
domínio do site muda (preview, staging, produção) e travar em um quebraria a
conexão a cada ambiente; o que protege é a chave, e o conteúdo é material
aprovado para ficar público.

## Trocar a chave

O botão "Trocar chave" derruba a URL antiga **na hora** — quem estiver usando
para de funcionar até colar a nova. Use quando a chave vazar ou quando o site
que a usava sair do ar.

## Schema

`migration-blog-publicacao.sql`: a coluna `blog.chave` e a troca dos três status
do artigo (`rascunho`/`revisao`/`publicado`) por dois (`pendente`/`aprovado`).
A conversão é irreversível — rascunho e em revisão caem os dois em pendente.
