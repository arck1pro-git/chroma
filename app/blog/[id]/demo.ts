// /blog/<id>?demo=1 com dados fictícios (app/mock/blog.json), para olhar a tela
// cheia sem gravar nada no banco nem chamar Google, n8n ou os feeds. Só em
// desenvolvimento: page.tsx recusa em produção. Mesmo espírito do ?demo=1 do
// chat (app/chat/demo.ts).
//
// Devolve EXATAMENTE os tipos das leituras de verdade (Blog, Artigo,
// GoogleDoBlog, EstadoAutomacao, PautaDoBlog): voltar para o banco é não passar
// o parâmetro. As datas andam com o relógio — a pauta "de 20 minutos atrás" é
// sempre de 20 minutos atrás.
import dados from "../../mock/blog.json";
import type { Artigo, Blog } from "@/lib/artigo";
import { proximaRodada, type EstadoAutomacao } from "@/lib/blog-automacao-tipos";
import type { DiaGoogle, GoogleDoArtigo, GoogleDoBlog, MetricasGoogle } from "@/lib/blog-google-tipos";
import type { PautaDoBlog } from "@/lib/blog-pauta-tipos";
import type { DadosDemo } from "./tela-blog";

const HORA = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const dia = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Um corpo de artigo que passa (ou não) no checklist de SEO, conforme a nota do mock. */
function corpo(chave: string, palavras: number, completo: boolean): string {
  const frase = `Quem acompanha ${chave} sabe que o detalhe decide o resultado. A conta muda com o prazo, com o custo e com o momento do mercado.`;
  const paragrafo = Array.from({ length: 4 }, () => frase).join(" ");
  const secoes = Math.max(3, Math.round(palavras / 260));
  const partes = [
    `Entender ${chave} é o primeiro passo para decidir bem. ${paragrafo}`,
    ...Array.from({ length: secoes }, (_, i) => `## ${i === 0 ? `O que é ${chave}` : `Ponto ${i + 1} sobre ${chave}`}\n\n${paragrafo}\n\n${paragrafo}`),
    "- Prazo do investimento\n- Liquidez\n- Governança",
    "> O dado mais forte da matéria vai em destaque.",
    "Veja também [o guia da SCP](/como-funciona-scp-imobiliaria) e [o short stay](/short-stay-predio-inteligente). Fonte: [a matéria](https://www.infomoney.com.br/).",
  ];
  if (completo) {
    partes.push(
      "## Perguntas frequentes",
      `### O que é ${chave}?\n\n${frase} ${frase}`,
      `### Vale a pena agora?\n\n${frase} ${frase}`,
      `### Quanto preciso para começar?\n\n${frase} ${frase}`,
    );
  }
  partes.push(`## Conclusão\n\n${paragrafo}`);
  return partes.join("\n\n");
}

function slugDe(titulo: string) {
  return titulo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

/** Números redondinhos e estáveis: o mesmo dia dá sempre o mesmo valor. */
function ruido(n: number) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function somar(dias: DiaGoogle[]): MetricasGoogle {
  const cliques = dias.reduce((t, d) => t + d.cliques, 0);
  const impressoes = dias.reduce((t, d) => t + d.impressoes, 0);
  return { cliques, impressoes, ctr: impressoes ? cliques / impressoes : 0, posicao: 12.4 };
}

export function demonstracao(): { blog: Blog; artigos: Artigo[]; tela: DadosDemo } {
  const agora = Date.now();

  const blog: Blog = {
    ...dados.blog,
    created_at: iso(agora - 120 * 24 * HORA),
    artigos: dados.artigos.length,
    em_revisao: dados.artigos.filter((a) => a.status === "pendente").length,
    feeds: dados.fontes.length,
  };

  const artigos: Artigo[] = dados.artigos.map((a) => {
    const quando = iso(agora - a.horas * HORA);
    const completo = a.nota >= 75;
    return {
      id: a.id,
      blog_id: blog.id,
      titulo: a.titulo,
      slug: a.slug ?? (a.status === "aprovado" ? slugDe(a.titulo) : ""),
      meta_title: `${a.palavra_chave.charAt(0).toUpperCase()}${a.palavra_chave.slice(1)}: guia AMAAN`,
      meta_description: completo
        ? `Entenda ${a.palavra_chave} sem complicação: o que muda, quanto custa e como a AMAAN avalia cada oportunidade para o investidor.`
        : "",
      palavra_chave: a.palavra_chave,
      keywords: "investimento imobiliário, scp, renda com imóveis",
      resumo: a.resumo,
      conteudo: corpo(a.palavra_chave, a.palavras, completo),
      imagem_alt: completo ? `Ilustração sobre ${a.palavra_chave}` : "",
      status: a.status as Artigo["status"],
      fonte_titulo: a.titulo,
      fonte_url: a.fonte_url,
      created_at: quando,
      updated_at: a.status === "aprovado" ? iso(agora - (a.horas - 1) * HORA) : quando,
    };
  });

  // ── Google ──────────────────────────────────────────────────────────────
  const fim = agora - 24 * HORA;
  const porDia: DiaGoogle[] = Array.from({ length: 28 }, (_, i) => {
    const t = fim - (27 - i) * 24 * HORA;
    const semana = new Date(t).getUTCDay();
    const fimDeSemana = semana === 0 || semana === 6 ? 0.6 : 1;
    const cliques = Math.round((5 + i * 0.22 + ruido(i) * 4) * fimDeSemana);
    const impressoes = Math.round(cliques * (24 + ruido(i + 40) * 10));
    return { dia: dia(t), cliques, impressoes, ctr: cliques / impressoes, posicao: 11 + ruido(i + 80) * 3 };
  });
  const site = somar(porDia);
  const siteAnterior = { cliques: Math.round(site.cliques * 0.81), impressoes: Math.round(site.impressoes * 0.9), ctr: (site.cliques * 0.81) / (site.impressoes * 0.9), posicao: 13.9 };
  const blogSo = { cliques: Math.round(site.cliques * 0.62), impressoes: Math.round(site.impressoes * 0.71), ctr: (site.cliques * 0.62) / (site.impressoes * 0.71), posicao: 10.8 };

  const porSlug = new Map(artigos.filter((a) => a.slug).map((a) => [a.slug, a.id]));
  const paginas = dados.paginas.map(([url, cliques, impressoes, posicao]) => ({
    url: url as string,
    artigoId: porSlug.get(String(url).split("/").pop() ?? "") ?? null,
    cliques: cliques as number,
    impressoes: impressoes as number,
    ctr: (cliques as number) / (impressoes as number),
    posicao: posicao as number,
  }));
  const metricasDosArtigos: Record<string, MetricasGoogle> = {};
  for (const p of paginas) {
    if (p.artigoId) metricasDosArtigos[String(p.artigoId)] = { cliques: p.cliques, impressoes: p.impressoes, ctr: p.ctr, posicao: p.posicao };
  }

  const google: GoogleDoBlog = {
    estado: "ok",
    propriedade: "sc-domain:amaan.com.br",
    periodo: { inicio: porDia[0].dia, fim: porDia[27].dia, dias: 28 },
    site,
    siteAnterior,
    blog: blogSo,
    blogAnterior: { ...blogSo, cliques: Math.round(blogSo.cliques * 0.7), impressoes: Math.round(blogSo.impressoes * 0.82) },
    porDia,
    consultas: dados.consultas.map(([termo, cliques, impressoes, posicao]) => ({
      termo: termo as string,
      cliques: cliques as number,
      impressoes: impressoes as number,
      ctr: (cliques as number) / (impressoes as number),
      posicao: posicao as number,
    })),
    paginas,
    artigos: metricasDosArtigos,
    lidoEm: iso(agora - 4 * 60_000),
  };

  const googleDosArtigos: Record<string, GoogleDoArtigo> = {};
  for (const a of artigos.filter((x) => x.status === "aprovado")) {
    const m = metricasDosArtigos[String(a.id)];
    const fatia = m ? m.impressoes / site.impressoes : 0;
    googleDosArtigos[String(a.id)] = {
      estado: "ok",
      propriedade: google.propriedade,
      url: `${blog.url_base}/${a.slug}`,
      periodo: google.periodo,
      metricas: m ?? { cliques: 0, impressoes: 0, ctr: 0, posicao: 0 },
      porDia: porDia.map((d) => ({
        ...d,
        cliques: Math.round(d.cliques * fatia * 1.4),
        impressoes: Math.round(d.impressoes * fatia),
      })),
      consultas: m ? google.consultas.slice(0, 5) : [],
      indexacao: {
        situacao: m ? "indexada" : "fora",
        cobertura: m ? "Enviada e indexada" : "Descoberta, mas não indexada no momento",
        ultimoRastreio: m ? iso(agora - 30 * HORA) : "",
        canonicaGoogle: m ? `${blog.url_base}/${a.slug}` : "",
        canonicaSite: m ? `${blog.url_base}/${a.slug}` : "",
        sitemaps: m ? ["https://amaan.com.br/sitemap.xml"] : [],
        lidoEm: iso(agora - 20 * 60_000),
      },
      lidoEm: google.lidoEm,
    };
  }

  // ── Automação, pautas e fontes ──────────────────────────────────────────
  const rodadas = Array.from({ length: 6 }, (_, i) => agora - (i + 1) * 24 * HORA)
    .filter((t) => {
      const d = new Date(t - 3 * HORA).getUTCDay();
      return d !== 0 && d !== 6;
    })
    .slice(0, 4)
    .map((t, i) => {
      const inicio = new Date(t - 3 * HORA);
      inicio.setUTCHours(10, 0, 3, 0); // 7h de Brasília
      return {
        id: `demo-${i}`,
        inicio: inicio.toISOString(),
        fim: new Date(inicio.getTime() + (4 + i) * 60_000).toISOString(),
        situacao: (i === 2 ? "erro" : "sucesso") as "erro" | "sucesso",
      };
    });
  const automacao: EstadoAutomacao = {
    estado: "ligada",
    workflowId: "demo",
    desatualizada: false,
    proxima: proximaRodada(new Date(agora)),
    execucoes: rodadas,
    podeLigarDaqui: true,
  };

  const pautas: PautaDoBlog = {
    blogId: blog.id,
    blogNome: blog.nome,
    feeds: dados.fontes.length,
    lidos: 70,
    itens: [
      ...dados.pautas.map((p) => ({ titulo: p.titulo, link: p.link, data: iso(agora - p.horas * HORA), artigoId: null })),
      ...artigos.slice(0, 3).map((a) => ({ titulo: a.titulo, link: a.fonte_url, data: a.created_at, artigoId: a.id })),
    ],
  };

  return {
    blog,
    artigos,
    tela: {
      google,
      automacao,
      pautas,
      fontes: dados.fontes.map((f) => ({ url: f.url, itens: f.itens, ultima: iso(agora - f.horas * HORA) })),
      googleDosArtigos,
    },
  };
}
