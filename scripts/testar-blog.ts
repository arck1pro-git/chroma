// Confere o módulo Blog pelas funções reais, SEM falar com Google, n8n nem
// Anthropic: o globalThis.fetch vira um Search Console, um n8n e uma API da
// Anthropic falsos, e qualquer outro endereço lança (nada sai daqui).
//
//   node --env-file=.env scripts/jiti.mjs scripts/testar-blog.ts
//
// O que confere:
//   1. as contas puras: qual propriedade cobre o blog, URL do Google → artigo,
//      janela do período, próxima rodada da automação;
//   2. o blog no Google: os estados antes dos números (sem credencial, sem
//      endereço, sem acesso) e, com acesso, o placar do site e do blog, o dia a
//      dia completo, as páginas casadas com os artigos e um artigo inteiro
//      (números somados entre www e sem www, buscas e indexação);
//   3. a automação no n8n: a forma do workflow (agenda, fuso, endereço), o
//      estado (desatualizada, rodadas) e o ligar (pausa, reescreve, liga);
//   4. a curadoria da pauta: a ordem que a IA devolve, sem repetidos nem número
//      fora da lista, e a volta para a ordem por data quando ela falha;
//   5. contra o DEV, com um blog marcado e apagado no fim: a pauta da rodada
//      (só recentes, sem o que já virou artigo, na ordem da curadoria) e a cota
//      do dia (artigosDeHoje).
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { sql } from "../lib/db";
import {
  casarArtigo,
  googleDoArtigo,
  googleDoBlog,
  janelas,
  propriedadeDoEndereco,
} from "../lib/blog-google";
import { urlComparavel, variacao } from "../lib/blog-google-tipos";
import { AGENDA_AUTOMACAO, proximaRodada } from "../lib/blog-automacao-tipos";
import { estadoDaAutomacao, ligarAutomacao } from "../lib/blog-automacao";
import { NOME_WORKFLOW, NO_PAUTA, montarWorkflowRss } from "../lib/blog-rss-workflow";
import { escolherPautas } from "../lib/blog-curadoria";
import { artigosDeHoje, pautaDosBlogs } from "../lib/blog-pauta";
import { ENDERECO_DO_CRM } from "../lib/link-do-crm";
import type { Artigo } from "../lib/artigo";

const MARCA = "zz-teste-blog";
// O adaptador do n8n lê a base no carregamento do módulo (o .env): o n8n falso
// responde nesse mesmo host, e a intercepção garante que nada chega lá.
const HOST_N8N = new URL(process.env.N8N_BASE_URL || "https://n8n.teste").host;
let passos = 0;
const passo = (texto: string) => {
  passos++;
  console.log(`  ok ${passos}. ${texto}`);
};

// ── O fetch falso ───────────────────────────────────────────────────────────

type Pedido = { url: string; metodo: string; corpo: unknown };
const pedidos: Pedido[] = [];
const fetchOriginal = globalThis.fetch;

/** Cada parte troca o que o Google, o n8n e a Anthropic respondem. */
const falsos: {
  propriedades: { siteUrl: string; permissionLevel: string }[];
  analytics: (corpo: Record<string, unknown>) => unknown[];
  inspecao: () => unknown;
  workflows: { id: string; name: string; active: boolean }[];
  workflow: unknown;
  execucoes: unknown[];
  anthropic: () => Response;
  feed: string;
} = {
  propriedades: [],
  analytics: () => [],
  inspecao: () => ({}),
  workflows: [],
  workflow: null,
  execucoes: [],
  anthropic: () => Response.json({}, { status: 500 }),
  feed: "",
};

const json = (dados: unknown, status = 200) => Response.json(dados, { status });

async function fetchFalso(entrada: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
  const metodo = (init.method ?? (entrada instanceof Request ? entrada.method : "GET")).toUpperCase();
  const textoCorpo = typeof init.body === "string" ? init.body : entrada instanceof Request ? await entrada.clone().text() : "";
  let corpo: unknown = textoCorpo;
  try {
    corpo = textoCorpo ? JSON.parse(textoCorpo) : null;
  } catch {
    // corpo de formulário (o token do Google)
  }
  pedidos.push({ url, metodo, corpo });
  const u = new URL(url);

  if (u.host === "oauth2.googleapis.com") return json({ access_token: "token-falso", expires_in: 3600 });
  if (u.host === "www.googleapis.com" && u.pathname === "/webmasters/v3/sites") return json({ siteEntry: falsos.propriedades });
  if (u.host === "www.googleapis.com" && u.pathname.endsWith("/searchAnalytics/query")) {
    return json({ rows: falsos.analytics(corpo as Record<string, unknown>) });
  }
  if (u.host === "searchconsole.googleapis.com") return json({ inspectionResult: { indexStatusResult: falsos.inspecao() } });

  if (u.host === HOST_N8N) {
    const caminho = u.pathname.replace(/^\/api\/v1/, "");
    if (caminho === "/workflows" && metodo === "GET") return json({ data: falsos.workflows });
    if (caminho === "/workflows" && metodo === "POST") return json({ id: "wf-novo" });
    if (caminho === "/executions") return json({ data: falsos.execucoes });
    if (caminho === "/credentials") return json({ id: "cred-nova" });
    if (/^\/workflows\/[^/]+$/.test(caminho) && metodo === "GET") return json(falsos.workflow);
    if (/^\/workflows\/[^/]+$/.test(caminho) && metodo === "PUT") return json({ ok: true });
    if (/^\/workflows\/[^/]+\/(activate|deactivate)$/.test(caminho)) return json({ ok: true });
  }

  if (u.host === "api.anthropic.com") return falsos.anthropic();
  if (u.host === "example.com" && u.pathname === "/feed-teste") {
    return new Response(falsos.feed, { headers: { "content-type": "application/rss+xml; charset=utf-8" } });
  }
  throw new Error(`fetch inesperado no teste: ${metodo} ${url}`);
}

// ── 1. Contas puras ─────────────────────────────────────────────────────────

function partePuras() {
  const lista = [
    { siteUrl: "https://www.outro.com.br/", permissao: "siteFullUser" },
    { siteUrl: "https://exemplo.com.br/", permissao: "siteFullUser" },
    { siteUrl: "sc-domain:exemplo.com.br", permissao: "siteRestrictedUser" },
    { siteUrl: "sc-domain:naoverificado.com.br", permissao: "siteUnverifiedUser" },
  ];
  assert.equal(propriedadeDoEndereco("https://www.exemplo.com.br/blog", lista)?.siteUrl, "sc-domain:exemplo.com.br");
  assert.equal(propriedadeDoEndereco("https://blog.exemplo.com.br", lista)?.siteUrl, "sc-domain:exemplo.com.br");
  assert.equal(propriedadeDoEndereco("https://exemplo.com.br/blog", lista.slice(0, 2))?.siteUrl, "https://exemplo.com.br/");
  assert.equal(propriedadeDoEndereco("https://naoverificado.com.br/blog", lista), null);
  assert.equal(propriedadeDoEndereco("https://exemplo.com.br.golpe.com/blog", lista), null);
  assert.equal(propriedadeDoEndereco("não é url", lista), null);
  passo("propriedade: domínio vence prefixo, subdomínio entra, não verificada e domínio parecido ficam fora");

  const blog = { url_base: "https://exemplo.com.br/blog" };
  const artigos = [
    { id: 1, slug: "como-investir", titulo: "x", status: "aprovado" as const },
    { id: 2, slug: "outro-texto", titulo: "y", status: "aprovado" as const },
  ];
  assert.equal(casarArtigo("https://www.exemplo.com.br/blog/como-investir/", blog, artigos)?.id, 1);
  assert.equal(casarArtigo("https://exemplo.com.br/blog/categoria/outro-texto", blog, artigos)?.id, 2);
  assert.equal(casarArtigo("https://exemplo.com.br/como-investir", blog, artigos), null, "fora do caminho do blog");
  assert.equal(casarArtigo("https://exemplo.com.br/blog", blog, artigos), null, "a página do blog não é artigo");
  assert.equal(urlComparavel("https://WWW.Exemplo.com.br/Blog/?utm=1#x"), "exemplo.com.br/blog");
  passo("página do Google → artigo: com e sem www, barra no fim, categoria no caminho; fora do blog não casa");

  const j = janelas(28, new Date("2026-11-05T15:00:00Z"));
  assert.deepEqual(j.atual, { inicio: "2026-10-08", fim: "2026-11-04", dias: 28 });
  assert.deepEqual(j.anterior, { inicio: "2026-09-10", fim: "2026-10-07", dias: 28 });
  // 02h UTC de 06/11 ainda é dia 05 no Pacífico: a janela termina em 04/11.
  assert.equal(janelas(7, new Date("2026-11-06T02:00:00Z")).atual.fim, "2026-11-04");
  assert.equal(variacao(120, 100), 0.2);
  assert.equal(variacao(5, 0), null);
  passo("janela do período no fuso do Pacífico, terminando ontem; variação sem base é null");

  // Quinta 05/11 às 15h de Brasília → sexta 7h; sexta 8h → segunda 7h; segunda 6h → segunda 7h.
  assert.equal(proximaRodada(new Date("2026-11-05T18:00:00Z")), "2026-11-06T10:00:00.000Z");
  assert.equal(proximaRodada(new Date("2026-11-06T11:00:00Z")), "2026-11-09T10:00:00.000Z");
  assert.equal(proximaRodada(new Date("2026-11-09T09:00:00Z")), "2026-11-09T10:00:00.000Z");
  passo(`próxima rodada da agenda (${AGENDA_AUTOMACAO.texto}) pula o fim de semana`);
}

// ── 2. O blog no Google ─────────────────────────────────────────────────────

const linha = (chaves: string[], cliques: number, impressoes: number, posicao: number) => ({
  keys: chaves,
  clicks: cliques,
  impressions: impressoes,
  ctr: impressoes ? cliques / impressoes : 0,
  position: posicao,
});

async function parteGoogle() {
  const blog = { url_base: "https://exemplo.com.br/blog" };
  const artigos: Pick<Artigo, "id" | "slug" | "titulo" | "status">[] = [
    { id: 11, slug: "scp-imobiliaria", titulo: "SCP", status: "aprovado" },
    { id: 12, slug: "juros-hoje", titulo: "Juros", status: "aprovado" },
    { id: 13, slug: "rascunho", titulo: "Rascunho", status: "pendente" },
  ];

  delete process.env.GOOGLE_SA_EMAIL;
  assert.equal((await googleDoBlog(blog, artigos, 28)).estado, "sem-credencial");
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.GOOGLE_SA_EMAIL = "crm@teste.iam.gserviceaccount.com";
  process.env.GOOGLE_SA_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString().replace(/\n/g, "\\n");
  assert.equal((await googleDoBlog({ url_base: "" }, artigos, 28)).estado, "sem-endereco");

  falsos.propriedades = [{ siteUrl: "sc-domain:outro.com.br", permissionLevel: "siteOwner" }];
  const semAcesso = await googleDoBlog(blog, artigos, 28, true);
  assert.equal(semAcesso.estado, "sem-acesso");
  if (semAcesso.estado === "sem-acesso") {
    assert.equal(semAcesso.email, "crm@teste.iam.gserviceaccount.com");
    assert.equal(semAcesso.host, "exemplo.com.br");
    assert.deepEqual(semAcesso.propriedades, ["sc-domain:outro.com.br"]);
  }
  passo("estados antes dos números: sem credencial, sem endereço, sem acesso (com o e-mail para cadastrar)");

  falsos.propriedades = [{ siteUrl: "sc-domain:exemplo.com.br", permissionLevel: "siteRestrictedUser" }];
  const { atual, anterior } = janelas(28);
  falsos.analytics = (c) => {
    const dims = (c.dimensions as string[] | undefined) ?? [];
    const filtros = ((c.dimensionFilterGroups as { filters: { expression: string }[] }[] | undefined) ?? [])[0]?.filters ?? [];
    const doBlog = filtros.some((f) => f.expression === "exemplo.com.br/blog");
    const anteriorPedido = c.startDate === anterior.inicio;
    if (dims.length === 0) return [doBlog ? linha([], anteriorPedido ? 40 : 60, 2000, 9) : linha([], anteriorPedido ? 80 : 100, 5000, 12)];
    if (dims[0] === "date") return [linha([atual.inicio], 3, 100, 10), linha([atual.fim], 5, 160, 11)];
    if (dims[0] === "query") return [linha(["scp imobiliária"], 20, 400, 5)];
    if (dims[0] === "page" && doBlog) {
      return [
        linha(["https://exemplo.com.br/blog/scp-imobiliaria"], 30, 900, 6),
        linha(["https://www.exemplo.com.br/blog/scp-imobiliaria/"], 10, 100, 16),
        linha(["https://exemplo.com.br/blog/rascunho"], 2, 50, 20),
        linha(["https://exemplo.com.br/blog"], 4, 80, 7),
      ];
    }
    if (dims[0] === "page") return [linha(["https://exemplo.com.br/"], 40, 1500, 4), linha(["https://exemplo.com.br/blog/juros-hoje"], 9, 300, 14)];
    return [];
  };

  const r = await googleDoBlog(blog, artigos, 28, true);
  assert.equal(r.estado, "ok");
  if (r.estado !== "ok") return;
  assert.equal(r.propriedade, "sc-domain:exemplo.com.br");
  assert.deepEqual([r.site.cliques, r.siteAnterior.cliques, r.blog.cliques, r.blogAnterior.cliques], [100, 80, 60, 40]);
  assert.equal(r.porDia.length, 28, "um ponto por dia da janela");
  assert.equal(r.porDia[0].cliques, 3);
  assert.equal(r.porDia[1].cliques, 0, "dia sem linha vira zero, não buraco");
  assert.equal(r.porDia[27].cliques, 5);
  assert.deepEqual(Object.keys(r.artigos), ["11"], "só o publicado casa; rascunho e página do blog ficam fora");
  assert.deepEqual([r.artigos["11"].cliques, r.artigos["11"].impressoes], [40, 1000], "www e sem www somam");
  assert.equal(Math.round(r.artigos["11"].posicao * 10) / 10, 7, "posição média pesada pelas impressões");
  assert.deepEqual(r.paginas.map((p) => p.artigoId), [null, 12]);
  const doBlog = pedidos.filter((p) => JSON.stringify(p.corpo ?? "").includes("dimensionFilterGroups"));
  assert.ok(doBlog.length >= 3, "o recorte do blog vai como filtro para o Google, não filtrado aqui");
  passo("desempenho: site e blog contra o período anterior, 28 dias completos, artigos casados e somados");

  falsos.analytics = (c) => {
    const dims = (c.dimensions as string[] | undefined) ?? [];
    if (dims[0] === "page") return [linha(["https://exemplo.com.br/blog/scp-imobiliaria"], 30, 900, 6), linha(["https://www.exemplo.com.br/blog/scp-imobiliaria/"], 10, 100, 16), linha(["https://exemplo.com.br/blog/outro/scp-imobiliaria-2"], 99, 999, 1)];
    if (dims[0] === "date") return [linha([atual.fim, "https://exemplo.com.br/blog/scp-imobiliaria"], 4, 50, 6)];
    if (dims[0] === "query") {
      return [
        linha(["scp", "https://exemplo.com.br/blog/scp-imobiliaria"], 10, 300, 5),
        linha(["scp", "https://www.exemplo.com.br/blog/scp-imobiliaria/"], 2, 100, 9),
        linha(["o que é scp", "https://exemplo.com.br/blog/scp-imobiliaria"], 1, 500, 12),
      ];
    }
    return [];
  };
  falsos.inspecao = () => ({ verdict: "PASS", coverageState: "Enviada e indexada", lastCrawlTime: "2026-11-01T10:00:00Z", sitemap: ["https://exemplo.com.br/sitemap.xml"] });
  const a = await googleDoArtigo(blog, artigos[0], 28, true);
  assert.equal(a.estado, "ok");
  if (a.estado !== "ok") return;
  assert.deepEqual([a.metricas.cliques, a.metricas.impressoes], [40, 1000], "a página parecida (outro slug) não entra");
  assert.deepEqual(a.consultas.map((c) => [c.termo, c.cliques, c.impressoes]), [["o que é scp", 1, 500], ["scp", 12, 400]]);
  assert.equal(a.porDia.at(-1)?.cliques, 4);
  assert.equal(a.indexacao?.situacao, "indexada");
  const inspecionada = pedidos.filter((p) => p.url.includes("urlInspection")).at(-1)?.corpo as { inspectionUrl: string };
  assert.equal(inspecionada.inspectionUrl, "https://exemplo.com.br/blog/scp-imobiliaria", "inspeciona a URL que o Google conhece");
  assert.equal((await googleDoArtigo(blog, artigos[2], 28)).estado, "sem-url", "em revisão não tem página");
  passo("um artigo: números somados, buscas agregadas por termo, indexação da URL que o Google conhece");
}

// ── 3. Automação no n8n ─────────────────────────────────────────────────────

async function parteAutomacao() {
  const wf = montarWorkflowRss({ crmBaseUrl: ENDERECO_DO_CRM, credencialId: "c1", credencialNome: "cred" });
  const gatilho = wf.nodes.find((n) => n.type === "n8n-nodes-base.scheduleTrigger");
  assert.equal((gatilho?.parameters.rule as { interval: { expression: string }[] }).interval[0].expression, AGENDA_AUTOMACAO.cron);
  assert.equal(wf.settings.timezone, "America/Sao_Paulo");
  assert.equal(wf.nodes.find((n) => n.name === NO_PAUTA)?.parameters.url, `${ENDERECO_DO_CRM}/api/blogs/rss/pauta`);
  assert.ok(wf.connections[gatilho!.name], "o gatilho liga na pauta");
  passo("workflow: seg a sex 7h no fuso de Brasília, pauta no domínio de produção");

  const base = process.env.N8N_BASE_URL;
  const chave = process.env.N8N_API_KEY;
  delete process.env.N8N_BASE_URL;
  assert.equal((await estadoDaAutomacao()).estado, "sem-motor");
  process.env.N8N_BASE_URL = base || "https://n8n.teste";
  process.env.N8N_API_KEY = chave || "chave-falsa";
  const hostN8n = HOST_N8N;

  falsos.workflows = [];
  const naoCriada = await estadoDaAutomacao();
  assert.equal(naoCriada.estado, "nao-criada");
  assert.equal("podeLigarDaqui" in naoCriada && naoCriada.podeLigarDaqui, false, "fora da produção não liga");

  const antigo = montarWorkflowRss({ crmBaseUrl: ENDERECO_DO_CRM, credencialId: "c1", credencialNome: "cred" });
  (antigo.nodes[0].parameters.rule as { interval: { expression: string }[] }).interval[0].expression = "0 8 * * 1";
  falsos.workflows = [{ id: "wf1", name: NOME_WORKFLOW, active: true }, { id: "wf2", name: "SprintHub qualquer", active: true }];
  falsos.workflow = antigo;
  falsos.execucoes = [
    { id: 9, status: "success", startedAt: "2026-11-05T10:00:01Z", stoppedAt: "2026-11-05T10:06:00Z" },
    { id: 8, status: "error", startedAt: "2026-11-04T10:00:01Z", stoppedAt: "2026-11-04T10:01:00Z" },
    { id: 7, finished: false, startedAt: "2026-11-03T10:00:01Z", stoppedAt: null },
  ];
  const ligada = await estadoDaAutomacao();
  assert.equal(ligada.estado, "ligada");
  if (ligada.estado === "ligada") {
    assert.equal(ligada.desatualizada, true, "cron antigo é versão anterior");
    assert.deepEqual(ligada.execucoes.map((e) => e.situacao), ["sucesso", "erro", "rodando"]);
    assert.ok(ligada.proxima);
  }
  passo("estado: sem motor, não criada (e só a produção liga), ligada com agenda antiga e as rodadas");

  // Sem a credencial no DEV, o ligar a cria pelo n8n falso ("cred-nova") e a
  // grava em motor_credenciais — a linha sai no fim, pelo id exato.
  const [cred] = await sql`SELECT 1 FROM motor_credenciais WHERE motor = 'n8n' AND chave = 'crm_callback'`;
  process.env.CRM_SERVICE_TOKEN ||= "token-falso-do-teste";
  pedidos.length = 0;
  try {
    await ligarAutomacao();
  } finally {
    if (!cred) await sql`DELETE FROM motor_credenciais WHERE motor = 'n8n' AND chave = 'crm_callback' AND motor_cred_id = 'cred-nova'`;
  }
  if (!cred) {
    const criada = pedidos.find((p) => p.url.endsWith("/credentials"))?.corpo as { type: string; data: { name: string; value: string } };
    assert.equal(criada.type, "httpHeaderAuth");
    assert.equal(criada.data.name, "Authorization");
    assert.ok(criada.data.value.startsWith("Bearer "), "o token vai no cofre do n8n, não no workflow");
  }
  const ordem = pedidos.filter((p) => new URL(p.url).host === hostN8n).map((p) => `${p.metodo} ${new URL(p.url).pathname.replace(/^\/api\/v1/, "")}`);
  assert.deepEqual(
    ordem.filter((o) => !o.startsWith("GET") && !o.endsWith("/credentials")),
    ["POST /workflows/wf1/deactivate", "PUT /workflows/wf1", "POST /workflows/wf1/activate"],
  );
  const reescrito = pedidos.find((p) => p.metodo === "PUT")?.corpo as { settings: { timezone: string }; name: string };
  assert.equal(reescrito.settings.timezone, "America/Sao_Paulo");
  assert.equal(reescrito.name, NOME_WORKFLOW);
  assert.ok(!ordem.some((o) => o.includes("wf2")), "não toca workflow de outra gente");
  passo("ligar com o workflow existente: pausa, reescreve com a agenda nova e liga — só o do CRM");
}

// ── 4. Curadoria ────────────────────────────────────────────────────────────

async function parteCuradoria() {
  process.env.ANTHROPIC_API_KEY = "chave-falsa-do-teste";
  const itens = ["Ibovespa abre em alta", "Crédito imobiliário fica mais barato", "Dólar cai", "Lançamentos crescem 18%"].map((titulo, i) => ({
    titulo,
    link: `https://exemplo.com.br/n${i}`,
    data: new Date(Date.now() - i * 3_600_000).toISOString(),
  }));
  const blog = { nome: "Blog teste", descricao: "Investimento imobiliário para quem tem de R$ 50 mil a R$ 1 milhão." };

  let prompt = "";
  falsos.anthropic = () => {
    const corpo = pedidos.at(-1)?.corpo as { messages: { content: string }[]; model: string; output_config: { effort: string } };
    prompt = corpo.messages[0].content;
    assert.equal(corpo.output_config.effort, "low");
    return json({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: corpo.model,
      content: [{ type: "text", text: JSON.stringify({ escolhidas: [2, 4, 4, 99, 0] }) }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    });
  };
  const escolhidas = await escolherPautas(blog, itens, 3);
  assert.deepEqual(escolhidas.map((i) => i.titulo), ["Crédito imobiliário fica mais barato", "Lançamentos crescem 18%"]);
  assert.ok(prompt.includes("<<<dado_do_cliente>>>Ibovespa abre em alta<<<fim_dado_do_cliente>>>"), "título vai como dado");
  assert.ok(prompt.includes(blog.descricao), "a descrição do blog orienta");
  passo("curadoria: a ordem da IA, sem repetido, sem número fora da lista; título de terceiro vai como dado");

  falsos.anthropic = () => json({ type: "error", error: { type: "api_error", message: "fora" } }, 500);
  assert.deepEqual((await escolherPautas(blog, itens, 2)).map((i) => i.titulo), ["Ibovespa abre em alta", "Crédito imobiliário fica mais barato"]);
  assert.deepEqual((await escolherPautas({ ...blog, descricao: "" }, itens, 1)).map((i) => i.titulo), ["Ibovespa abre em alta"]);
  passo("curadoria que falha (ou blog sem descrição) volta para a ordem por data");
}

// ── 5. Contra o DEV ─────────────────────────────────────────────────────────

async function parteBanco() {
  const [b] = await sql`
    INSERT INTO blog (nome, descricao, url_base, rss_ativo)
    VALUES (${`${MARCA}-${Date.now()}`}, 'Investimento imobiliário.', 'https://exemplo.com.br/blog', true)
    RETURNING id`;
  const blogId = b.id as number;
  await sql`INSERT INTO blog_rss (blog_id, url) VALUES (${blogId}, 'https://example.com/feed-teste')`;
  // Já virou artigo hoje (conta na cota) / artigo à mão sem fonte (não conta).
  await sql`INSERT INTO artigo (blog_id, titulo, fonte_url) VALUES (${blogId}, 'usada', 'https://exemplo.com.br/usada')`;
  await sql`INSERT INTO artigo (blog_id, titulo, fonte_url) VALUES (${blogId}, 'a mão', '')`;
  await sql`INSERT INTO artigo (blog_id, titulo, fonte_url, created_at) VALUES (${blogId}, 'ontem', 'https://exemplo.com.br/ontem', now() - interval '2 days')`;

  const item = (titulo: string, link: string, horas: number) =>
    `<item><title>${titulo}</title><link>${link}</link><pubDate>${new Date(Date.now() - horas * 3_600_000).toUTCString()}</pubDate></item>`;
  falsos.feed = `<?xml version="1.0" encoding="UTF-8"?><rss><channel>${[
    item("Notícia velha", "https://exemplo.com.br/velha", 24 * 10),
    item("Já usada", "https://exemplo.com.br/usada", 2),
    item("Juros caem", "https://exemplo.com.br/juros", 3),
    item("Bolsa sobe", "https://exemplo.com.br/bolsa", 1),
  ].join("")}</channel></rss>`;
  let titulosNoPrompt = "";
  falsos.anthropic = () => {
    titulosNoPrompt = (pedidos.at(-1)?.corpo as { messages: { content: string }[] }).messages[0].content;
    return json({
      id: "msg_2", type: "message", role: "assistant", model: "claude-opus-5-5",
      content: [{ type: "text", text: JSON.stringify({ escolhidas: [2] }) }],
      stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
    });
  };

  try {
    const [pauta] = await pautaDosBlogs({ blogId, limite: 5, curar: true });
    assert.ok(!titulosNoPrompt.includes("Notícia velha"), "mais velha que 72 h não vai para a curadoria");
    assert.ok(!titulosNoPrompt.includes("Já usada"), "o que já virou artigo não volta");
    assert.deepEqual(pauta.itens.map((i) => i.titulo), ["Juros caem"], "a ordem da curadoria (2ª da lista recente)");
    const [tela] = await pautaDosBlogs({ blogId, limite: 30, incluirUsados: true });
    assert.deepEqual(tela.itens.map((i) => i.titulo), ["Bolsa sobe", "Juros caem", "Notícia velha", "Já usada"], "a tela mostra tudo, usadas no fim");
    passo("pauta da rodada no DEV: só recentes, sem as usadas, na ordem da curadoria; a tela vê tudo");

    assert.equal(await artigosDeHoje(blogId), 1, "só o de hoje com fonte conta na cota");
    passo("cota do dia: conta só artigo de notícia criado hoje (Brasília)");
  } finally {
    await sql`DELETE FROM blog WHERE id = ${blogId}`;
  }
}

// ── Roda ────────────────────────────────────────────────────────────────────

async function principal() {
  globalThis.fetch = fetchFalso as typeof fetch;
  try {
    console.log("1. contas puras");
    partePuras();
    console.log("2. o blog no Google (Search Console falso)");
    await parteGoogle();
    console.log("3. automação no n8n (n8n falso)");
    await parteAutomacao();
    console.log("4. curadoria (Anthropic falsa)");
    await parteCuradoria();
    console.log("5. contra o DEV");
    await parteBanco();
    const fora = pedidos.filter((p) => !["oauth2.googleapis.com", "www.googleapis.com", "searchconsole.googleapis.com", "api.anthropic.com", "example.com"].includes(new URL(p.url).host) && !p.url.includes("/api/v1/"));
    assert.equal(fora.length, 0, "nada saiu para endereço não previsto");
    console.log(`\nOK: ${passos} partes conferidas (${pedidos.length} pedidos aos serviços falsos).`);
  } finally {
    globalThis.fetch = fetchOriginal;
    const [sobra] = await sql`SELECT count(*)::int AS n FROM blog WHERE nome LIKE ${MARCA + "%"}`;
    console.log(`limpeza: ${sobra.n} blog(s) da marca restante(s)`);
    await sql.end();
  }
}

principal().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
