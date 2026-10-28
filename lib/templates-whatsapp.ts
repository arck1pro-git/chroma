// O template oficial do WhatsApp nos três sentidos: LER o que a Meta devolve
// (lerTemplate) num formato que a tela desenha sem conhecer o JSON da Graph
// API; MONTAR um novo a partir do editor de Templates (problemasDo,
// componentesDoRascunho, rascunhoDe); e ENVIAR — o valor de cada {{n}} e do
// link com variável no chat e nas campanhas, com dado do contato, e o payload
// das respostas rápidas (seção "Variáveis no envio").
//
// Puro, sem server-only, de propósito: as telas conferem as mesmas regras
// enquanto a pessoa digita, e o servidor confere de novo, porque o que chega do
// navegador não é confiável. Uma regra só, aplicada nos dois lugares. Testado
// por scripts/testar-templates-whatsapp.ts.
//
// As regras são as que a Meta aplica na criação (2026-10): exemplo obrigatório
// para cada variável (sem ele a Meta recusa o envio, e até 2026-10-27 o editor
// não pedia), variáveis numeradas e em sequência, texto que não começa nem
// termina com variável, até 10 botões com no máximo 2 links e 1 telefone,
// respostas rápidas agrupadas separadas dos botões de ação.
// Cabeçalho só de texto: imagem, vídeo e documento exigem subir a mídia na Meta
// antes (upload retomável), o que este editor não faz.
//
// LINK COM VARIÁVEL (2026-10-27): o botão de link pode terminar em {{1}}, que
// o CRM completa no envio (chat e campanha). As regras da revisão de segurança
// moram numa função só, problemaDoLinkVariavel, que o editor, a campanha e o
// chat usam (seção "Link com variável").
import type { TemplateMeta } from "@/lib/meta";
import { ENDERECO_DO_CRM } from "@/lib/link-do-crm";
import { soDigitos } from "@/lib/telefone";

export const IDIOMA_PADRAO = "pt_BR";

export const LIMITE = {
  nome: 512,
  cabecalho: 60,
  corpo: 1024,
  rodape: 60,
  textoBotao: 25,
  url: 2000,
  telefone: 20,
  exemplo: 200,
  /** Texto fixo de uma variável do corpo numa campanha; o do cabeçalho segue `cabecalho`. */
  valorFixo: 200,
  /** O valor que completa um link com variável (o que entra no lugar do {{1}}). */
  valorLink: 100,
  botoes: 10,
  links: 2,
  telefones: 1,
} as const;

export type Categoria = "MARKETING" | "UTILITY";
export type TipoBotao = "QUICK_REPLY" | "URL" | "PHONE_NUMBER";

/** O nome da categoria na tela. A Meta também devolve AUTHENTICATION, que este editor não cria. */
export const ROTULO_CATEGORIA: Record<string, string> = {
  MARKETING: "Marketing",
  UTILITY: "Utilidade",
  AUTHENTICATION: "Autenticação",
};

// ── O que a tela desenha ────────────────────────────────────────────────────

/** `destino` é o link (URL) ou o número (PHONE_NUMBER); nos outros tipos, null. */
export type BotaoTemplate = { tipo: string; texto: string; destino: string | null };

/** O que a prévia precisa: o template da Meta e o rascunho do editor viram isto. */
export type ConteudoTemplate = {
  /** formato TEXT, IMAGE, VIDEO, DOCUMENT ou LOCATION; texto só no TEXT. */
  cabecalho: { formato: string; texto: string | null } | null;
  corpo: string;
  rodape: string | null;
  botoes: BotaoTemplate[];
  exemplosCabecalho: string[];
  exemplosCorpo: string[];
};

export type TemplateWhatsApp = ConteudoTemplate & {
  id: string;
  nome: string;
  idioma: string;
  categoria: string;
  status: string;
  /** Código da Meta (INVALID_FORMAT, PROMOTIONAL…); null quando não foi rejeitado. */
  motivoRejeicao: string | null;
  /** GREEN, YELLOW, RED ou UNKNOWN; null quando a Meta não manda. */
  qualidade: string | null;
};

type ComponenteMeta = {
  type?: string;
  format?: string;
  text?: string;
  example?: { header_text?: string[]; body_text?: string[][] };
  buttons?: Array<{ type?: string; text?: string; url?: string; phone_number?: string }>;
};

export function lerTemplate(t: TemplateMeta): TemplateWhatsApp {
  const componentes = t.components as ComponenteMeta[];
  const achar = (tipo: string) => componentes.find((c) => String(c.type ?? "").toUpperCase() === tipo);
  const cab = achar("HEADER");
  const corpo = achar("BODY");
  const rodape = achar("FOOTER");
  return {
    id: t.id,
    nome: t.name,
    idioma: t.language,
    categoria: t.category,
    status: t.status,
    motivoRejeicao: t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : null,
    qualidade: t.quality_score?.score ?? null,
    cabecalho: cab ? { formato: String(cab.format ?? "TEXT").toUpperCase(), texto: cab.text ?? null } : null,
    corpo: corpo?.text ?? "",
    rodape: rodape?.text ?? null,
    botoes: (achar("BUTTONS")?.buttons ?? []).map((b) => ({
      tipo: String(b.type ?? "").toUpperCase(),
      texto: b.text ?? "",
      destino: b.url ?? b.phone_number ?? null,
    })),
    exemplosCabecalho: cab?.example?.header_text ?? [],
    exemplosCorpo: corpo?.example?.body_text?.[0] ?? [],
  };
}

/**
 * Por que o CRM não envia este template, nem pelo chat nem por campanha; null
 * quando envia. Barra o cabeçalho de mídia e a variável com nome
 * ({{first_name}}, criada no WhatsApp Manager): os dois envios só preenchem
 * variável de texto numerada. Link com variável o CRM envia desde 2026-10-27,
 * desde que a base siga problemaDoLinkVariavel; o que foge dela (criado fora
 * do editor) também barra aqui, antes de alguém preencher o valor à toa.
 */
export function motivoSemEnvio(t: ConteudoTemplate): string | null {
  if (t.cabecalho !== null && t.cabecalho.formato !== "TEXT") return "Tem cabeçalho de mídia, que o CRM ainda não envia.";
  if (temVariavelForaDoPadrao(`${t.cabecalho?.texto ?? ""} ${t.corpo}`))
    return "Tem variável com nome (como {{first_name}}), que o CRM ainda não envia.";
  // Botão que pede parâmetro no envio e o CRM não manda (copiar código, código
  // de acesso, formulário, catálogo): a Meta recusaria o envio inteiro.
  const semSuporte = t.botoes.find((b) => !["QUICK_REPLY", "URL", "PHONE_NUMBER"].includes(b.tipo));
  if (semSuporte) return `Tem o botão “${semSuporte.texto || semSuporte.tipo}”, de um tipo que o CRM ainda não envia.`;
  const links = linksVariaveisDe(t);
  for (const [indice, b] of t.botoes.entries()) {
    if (b.tipo !== "URL" || !(b.destino ?? "").includes("{{")) continue;
    const link = links.find((l) => l.indice === indice);
    const problema = link ? problemaDoLinkVariavel(link.url, null) : "a variável não está no fim.";
    if (problema) return `O link do botão “${b.texto}” está fora do padrão que o CRM envia: ${problema}`;
  }
  return null;
}

export function semEnvioPeloCrm(t: ConteudoTemplate): boolean {
  return motivoSemEnvio(t) !== null;
}

// ── O que o editor monta ────────────────────────────────────────────────────

/**
 * `exemplo` só vale no link com variável (destino terminando em {{1}}): o valor
 * de exemplo do {{1}}, que a Meta exige para analisar o template.
 */
export type BotaoRascunho = { tipo: TipoBotao; texto: string; destino: string; exemplo?: string };

export type Rascunho = {
  nome: string;
  categoria: Categoria;
  cabecalho: string;
  corpo: string;
  rodape: string;
  exemplosCabecalho: string[];
  exemplosCorpo: string[];
  botoes: BotaoRascunho[];
};

export type CampoRascunho = "nome" | "cabecalho" | "corpo" | "exemplos" | "rodape" | "botoes";
export type Problema = { campo: CampoRascunho; mensagem: string };

export const RASCUNHO_VAZIO: Rascunho = {
  nome: "",
  categoria: "MARKETING",
  cabecalho: "",
  corpo: "",
  rodape: "",
  exemplosCabecalho: [],
  exemplosCorpo: [],
  botoes: [],
};

/** Os números das variáveis {{n}} do texto, sem repetição, na ordem em que aparecem. */
export function variaveisDo(texto: string): number[] {
  return [...new Set(Array.from(texto.matchAll(/\{\{(\d+)\}\}/g), (m) => Number(m[1])))];
}

/** Sobra "{{" depois de tirar os {{n}}: variável nomeada ({{nome}}) ou com espaço ({{ 1 }}). */
const temVariavelForaDoPadrao = (texto: string) => texto.replace(/\{\{\d+\}\}/g, "").includes("{{");

/** O nome como a Meta aceita: minúsculas sem acento, números e _. */
export function nomeDeTemplate(bruto: string): string {
  return bruto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .slice(0, LIMITE.nome);
}

/**
 * Número do botão de ligar no formato da Meta. Com "+", respeita o país
 * digitado (um número dos EUA também tem 11 dígitos). Sem "+", tira o zero de
 * tronco ("0800", "(047)") e, com cara de BR (DDD + número), põe o 55.
 */
export function telefoneDoBotao(bruto: string): string {
  let d = soDigitos(bruto);
  if (!bruto.trim().startsWith("+")) {
    d = d.replace(/^0+/, "");
    if (d.length === 10 || d.length === 11) d = "55" + d;
  }
  return d ? `+${d}` : "";
}

/**
 * A Meta exige os botões agrupados: respostas rápidas de um lado, ações (link,
 * ligar) do outro. O editor mantém o rascunho sempre assim, então a prévia
 * mostra a ordem que vai ser enviada.
 */
export function emGrupos<T extends { tipo: string }>(botoes: T[]): T[] {
  return [...botoes.filter((b) => b.tipo === "QUICK_REPLY"), ...botoes.filter((b) => b.tipo !== "QUICK_REPLY")];
}

function emSequencia(numeros: number[]): boolean {
  return [...numeros].sort((a, b) => a - b).every((n, i) => n === i + 1);
}

const MENSAGEM_PADRAO_VARIAVEL = "Use variáveis numeradas, como {{1}}: sem nome e sem espaço dentro das chaves.";

/**
 * O que impede o envio, na ordem do formulário. Vazio quando está pronto. O
 * editor mostra o primeiro ao lado do botão de enviar; a rota devolve o
 * primeiro como erro 400.
 */
export function problemasDo(r: Rascunho): Problema[] {
  const p: Problema[] = [];
  const nome = r.nome.trim();
  if (!nome) p.push({ campo: "nome", mensagem: "Dê um nome ao template." });
  else if (!/^[a-z0-9_]+$/.test(nome) || nome.length > LIMITE.nome)
    p.push({ campo: "nome", mensagem: "Use só letras minúsculas, números e _ no nome." });

  const cabecalho = r.cabecalho.trim();
  const varsCabecalho = variaveisDo(cabecalho);
  if (cabecalho.length > LIMITE.cabecalho)
    p.push({ campo: "cabecalho", mensagem: `O cabeçalho tem até ${LIMITE.cabecalho} caracteres.` });
  if (temVariavelForaDoPadrao(cabecalho)) p.push({ campo: "cabecalho", mensagem: MENSAGEM_PADRAO_VARIAVEL });
  else if (varsCabecalho.length > 1 || (varsCabecalho.length === 1 && varsCabecalho[0] !== 1))
    p.push({ campo: "cabecalho", mensagem: "O cabeçalho aceita uma variável só, a {{1}}." });
  else if (varsCabecalho.length === 1 && !r.exemplosCabecalho[0]?.trim())
    p.push({ campo: "exemplos", mensagem: "Dê um exemplo para a {{1}} do cabeçalho." });

  const corpo = r.corpo.trim();
  const varsCorpo = variaveisDo(corpo);
  if (!corpo) p.push({ campo: "corpo", mensagem: "Escreva o texto da mensagem." });
  else if (corpo.length > LIMITE.corpo)
    p.push({ campo: "corpo", mensagem: `O texto tem até ${LIMITE.corpo.toLocaleString("pt-BR")} caracteres.` });
  if (temVariavelForaDoPadrao(corpo)) {
    p.push({ campo: "corpo", mensagem: MENSAGEM_PADRAO_VARIAVEL });
  } else if (!emSequencia(varsCorpo)) {
    p.push({ campo: "corpo", mensagem: "As variáveis vão em sequência, sem pular número: {{1}}, {{2}}, {{3}}…" });
  } else {
    if (/^\{\{\d+\}\}/.test(corpo) || /\{\{\d+\}\}$/.test(corpo))
      p.push({ campo: "corpo", mensagem: "O texto não pode começar nem terminar com variável: ponha uma palavra antes ou depois." });
    const semExemplo = [...varsCorpo].sort((a, b) => a - b).find((n) => !r.exemplosCorpo[n - 1]?.trim());
    if (semExemplo) p.push({ campo: "exemplos", mensagem: `Dê um exemplo para a {{${semExemplo}}} — a Meta exige para analisar.` });
  }
  if ([...r.exemplosCabecalho, ...r.exemplosCorpo].some((e) => e.trim().length > LIMITE.exemplo))
    p.push({ campo: "exemplos", mensagem: `Cada exemplo tem até ${LIMITE.exemplo} caracteres.` });

  const rodape = r.rodape.trim();
  if (rodape.length > LIMITE.rodape)
    p.push({ campo: "rodape", mensagem: `O rodapé tem até ${LIMITE.rodape} caracteres.` });
  if (rodape.includes("{{")) p.push({ campo: "rodape", mensagem: "O rodapé não aceita variável." });

  const botoes = r.botoes;
  if (botoes.length > LIMITE.botoes) p.push({ campo: "botoes", mensagem: `São até ${LIMITE.botoes} botões.` });
  if (botoes.filter((b) => b.tipo === "URL").length > LIMITE.links)
    p.push({ campo: "botoes", mensagem: `São até ${LIMITE.links} botões de link.` });
  if (botoes.filter((b) => b.tipo === "PHONE_NUMBER").length > LIMITE.telefones)
    p.push({ campo: "botoes", mensagem: "Só cabe um botão de ligar." });
  const textos = new Set<string>();
  for (const b of botoes) {
    const texto = b.texto.trim();
    const rotulo = texto ? `“${texto}”` : "sem texto";
    if (!texto) p.push({ campo: "botoes", mensagem: "Todo botão precisa de um texto." });
    else if (texto.length > LIMITE.textoBotao)
      p.push({ campo: "botoes", mensagem: `O texto do botão tem até ${LIMITE.textoBotao} caracteres.` });
    else if (texto.includes("{{")) p.push({ campo: "botoes", mensagem: "O texto do botão não aceita variável." });
    else if (textos.has(texto.toLowerCase())) p.push({ campo: "botoes", mensagem: `Dois botões com o texto ${rotulo}.` });
    textos.add(texto.toLowerCase());

    const destino = b.destino.trim();
    if (b.tipo === "URL") {
      if (destino.includes("{{")) {
        const exemplo = (b.exemplo ?? "").trim();
        const problema = problemaDoLinkVariavel(destino, null);
        if (problema) p.push({ campo: "botoes", mensagem: `O link do botão ${rotulo}: ${problema}` });
        else if (!exemplo) p.push({ campo: "botoes", mensagem: `Dê um exemplo para o {{1}} do link do botão ${rotulo} — a Meta exige para analisar.` });
        else {
          // O exemplo é um valor de verdade, não marca: é o link que a Meta abre na análise.
          const doExemplo = exemplo.includes("{{") ? "o exemplo é um valor de verdade, sem {{…}}." : problemaDoValorDoLink(exemplo);
          if (doExemplo) p.push({ campo: "botoes", mensagem: `O exemplo do link do botão ${rotulo}: ${doExemplo}` });
        }
      } else if (!ehLink(destino) || destino.length > LIMITE.url)
        p.push({ campo: "botoes", mensagem: `O botão ${rotulo} precisa de um link completo, como https://site.com.br` });
    } else if (b.tipo === "PHONE_NUMBER") {
      if (!/^\+[1-9]\d{10,14}$/.test(telefoneDoBotao(destino)))
        p.push({ campo: "botoes", mensagem: `O botão ${rotulo} precisa de um telefone com DDD.` });
    }
  }
  return p;
}

// Só https: link sem TLS numa mensagem oficial da marca não passa.
function ehLink(valor: string): boolean {
  if (!/^https:\/\//i.test(valor)) return false;
  try {
    return new URL(valor).hostname.includes(".");
  } catch {
    return false;
  }
}

// ── Link com variável ───────────────────────────────────────────────────────
//
// A Meta aprova a BASE (https://site.com.br/pagina/{{1}}) e o envio completa o
// {{1}}. Quem completa é a campanha (para um segmento inteiro) ou o atendente
// no chat, então o que entra ali é limitado (revisão de segurança, 2026-10-27):
//   · a base é https, com domínio de verdade, sem usuário (@) antes dele, e o
//     {{1}} vai no fim, logo depois de / = ? ou #: o valor nunca encosta no
//     domínio e não muda para onde o link leva;
//   · o valor fixo é curto e só tem [A-Za-z0-9._~-], começando por letra ou
//     número: sem barra, @, espaço ou "." na frente, nada que vire outro
//     caminho, outro domínio ("@golpe.com", ".golpe.com") ou texto na URL;
//   · o WhatsApp do próprio destinatário ({{numero}}) só vai no link de vídeo
//     rastreável do CRM, que existe para isso (lib/videos.ts): o número vai
//     para o nosso domínio e para nenhum outro.
// Mesma regra no editor (só a base), na campanha (a marca guardada) e no chat
// (o valor digitado).

/**
 * Os domínios do próprio CRM: o dos links que saem por WhatsApp
 * (lib/link-do-crm.ts) e o da Vercel, o mesmo par que lib/endereco.ts aceita.
 * Fixo e sem variável de ambiente porque a tela também confere.
 */
const HOSTS_DO_CRM = [new URL(ENDERECO_DO_CRM).host, "chromacrm.vercel.app"];

const VALOR_DO_LINK = /^[A-Za-z0-9][A-Za-z0-9._~-]*$/;
const LINK_COMPLETO = "precisa ser um link completo com https, como https://site.com.br/pagina/{{1}}.";

/**
 * O link de vídeo rastreável do CRM pronto para receber o número do contato:
 * https://<domínio do CRM>/v/<código>?w={{1}} — a mesma forma que a tela de
 * Vídeos dá para as cadências (?w={{numero}}). Puro: a tela usa para oferecer o
 * WhatsApp do contato só nesse link.
 */
export function ehLinkDeVideoDoCrm(base: string): boolean {
  const m = /^https:\/\/([^/?#@\\\s]+)\/v\/[a-z0-9]{6,16}\?w=\{\{1\}\}$/.exec(base.trim());
  return m !== null && HOSTS_DO_CRM.includes(m[1].toLowerCase());
}

function problemaDaBase(base: string): string | null {
  if (base.length > LIMITE.url) return `tem até ${LIMITE.url} caracteres.`;
  if (!base.endsWith("{{1}}") || base.indexOf("{{") !== base.length - 5 || base.slice(0, -5).includes("}}"))
    return "a variável é uma só, a {{1}}, e vai no fim: https://site.com.br/pagina/{{1}}.";
  if (!/[/=?#]\{\{1\}\}$/.test(base))
    return "antes do {{1}} vai /, =, ? ou #, como em https://site.com.br/pagina/{{1}} ou https://site.com.br/?id={{1}}.";
  if (!/^https:\/\//i.test(base) || /[\s\\]/.test(base)) return LINK_COMPLETO;
  try {
    // Dois valores diferentes no lugar do {{1}}: se o domínio mudar entre eles,
    // a variável está dentro dele ("https://site.com.br={{1}}").
    const semVariavel = base.slice(0, -5);
    const a = new URL(`${semVariavel}a`);
    const b = new URL(`${semVariavel}b`);
    if (a.protocol !== "https:" || !a.hostname.includes(".") || a.host !== b.host) return LINK_COMPLETO;
    if (a.username || a.password) return "não pode ter usuário nem @ antes do domínio.";
  } catch {
    return LINK_COMPLETO;
  }
  return null;
}

/** O valor fixo que completa o link (o exemplo do editor passa pela mesma regra). */
function problemaDoValorDoLink(valor: string): string | null {
  if (!valor) return "falta o valor que completa o link.";
  if (valor.length > LIMITE.valorLink) return `o valor que completa o link tem até ${LIMITE.valorLink} caracteres.`;
  if (!VALOR_DO_LINK.test(valor))
    return "o valor que completa o link aceita só letras sem acento, números, ponto, hífen, _ e ~, começando por letra ou número.";
  return null;
}

/**
 * O que impede este link com variável; null = pode. `valor` null confere só a
 * base (o editor de templates); com valor, confere também o que vai no {{1}}:
 * texto fixo ou, só no link de vídeo do CRM, a marca {{numero}}. O chat recusa
 * qualquer marca antes de chegar aqui (lá o valor é o que o atendente vê).
 *
 * A mensagem começa em minúscula: quem mostra põe na frente de qual botão é
 * ("O link do botão “Site”: …").
 */
export function problemaDoLinkVariavel(base: string, valor: string | null): string | null {
  const b = base.trim();
  const daBase = problemaDaBase(b);
  if (daBase || valor === null) return daBase;
  const v = valor.trim();
  if (v === marcaDoContato("numero"))
    return ehLinkDeVideoDoCrm(b) ? null : "o WhatsApp do contato só vai no link de vídeo do CRM (…/v/<código>?w={{1}}).";
  if (/\{\{|\}\}/.test(v)) return "no link vai texto fixo; dado do contato, só o WhatsApp e só no link de vídeo do CRM.";
  return problemaDoValorDoLink(v);
}

/** O que a Meta costuma recusar na análise, mas a API aceita receber. Não impede o envio. */
export function avisosDo(r: Rascunho): string[] {
  return /\}\}\s*\{\{/.test(r.corpo) ? ["Duas variáveis coladas, sem texto entre elas, costumam ser rejeitadas."] : [];
}

/** O rascunho no formato de `components` da Graph API. Só chamar sem problemas. */
export function componentesDoRascunho(r: Rascunho): Array<Record<string, unknown>> {
  const componentes: Array<Record<string, unknown>> = [];
  const cabecalho = r.cabecalho.trim();
  if (cabecalho) {
    componentes.push({
      type: "HEADER",
      format: "TEXT",
      text: cabecalho,
      ...(variaveisDo(cabecalho).length ? { example: { header_text: [r.exemplosCabecalho[0].trim()] } } : {}),
    });
  }
  const corpo = r.corpo.trim();
  const vars = variaveisDo(corpo).length;
  componentes.push({
    type: "BODY",
    text: corpo,
    ...(vars ? { example: { body_text: [r.exemplosCorpo.slice(0, vars).map((v) => v.trim())] } } : {}),
  });
  if (r.rodape.trim()) componentes.push({ type: "FOOTER", text: r.rodape.trim() });
  if (r.botoes.length) {
    componentes.push({
      type: "BUTTONS",
      buttons: emGrupos(r.botoes).map((b) =>
        b.tipo === "URL"
          ? {
              type: "URL",
              text: b.texto.trim(),
              url: b.destino.trim(),
              // Link com variável: a Meta quer o link inteiro de exemplo, com o {{1}} já trocado.
              ...(b.destino.includes("{{")
                ? { example: [b.destino.trim().replace(/\{\{1\}\}$/, () => (b.exemplo ?? "").trim())] }
                : {}),
            }
          : b.tipo === "PHONE_NUMBER"
            ? { type: "PHONE_NUMBER", text: b.texto.trim(), phone_number: telefoneDoBotao(b.destino) }
            : { type: "QUICK_REPLY", text: b.texto.trim() },
      ),
    });
  }
  return componentes;
}

// ── Variáveis no envio: texto ou dado do contato ────────────────────────────
//
// No envio — chat e campanha —, cada {{1}}, {{2}}… recebe um valor. O valor
// pode trazer dado do contato com as marcas das cadências ({{primeiro_nome}},
// {{nome}}…): na campanha a marca fica guardada e vira o dado de cada contato
// no disparo (pedido dele, 2026-10-27: "definimos nos campos de variável"); no
// chat, que tem um contato só, o menu já põe o valor real no campo.

// E-mail e WhatsApp só no chat, onde uma pessoa vê o valor antes de mandar. Na
// campanha, um número reciclado ou um contato casado por e-mail num lead
// mandaria o dado de uma pessoa para o telefone de outra (revisão de segurança
// de 2026-10-27). A exceção é o WhatsApp no link de vídeo do CRM (seção "Link
// com variável"): ali ele é o número do próprio destinatário e vai para o nosso
// domínio, não para o texto.
export const DADOS_DO_CONTATO = [
  { chave: "primeiro_nome", rotulo: "Primeiro nome", naCampanha: true },
  { chave: "nome", rotulo: "Nome completo", naCampanha: true },
  { chave: "cidade", rotulo: "Cidade", naCampanha: true },
  { chave: "email", rotulo: "E-mail", naCampanha: false },
  { chave: "numero", rotulo: "WhatsApp", naCampanha: false },
] as const;

export const DADOS_NA_CAMPANHA = DADOS_DO_CONTATO.filter((d) => d.naCampanha);

export type ChaveDoContato = (typeof DADOS_DO_CONTATO)[number]["chave"];
export type DadosDoContato = Record<ChaveDoContato, string>;
/**
 * O valor de cada {{n}}, na ordem: cabecalho[0] é a {{1}} do cabeçalho.
 * `botoes[i]` é o valor do {{1}} do botão de link variável na posição `i` dos
 * botões do template (as outras posições ficam vazias).
 */
export type ValoresDoEnvio = { cabecalho: string[]; corpo: string[]; botoes?: string[] };

const MARCA_DO_CONTATO = /\{\{([a-z_]+)\}\}/g;
const ehChaveDoContato = (x: string): x is ChaveDoContato => DADOS_DO_CONTATO.some((d) => d.chave === x);
const rotuloDoDado = (chave: ChaveDoContato) => DADOS_DO_CONTATO.find((d) => d.chave === chave)?.rotulo ?? chave;

export const marcaDoContato = (chave: ChaveDoContato) => `{{${chave}}}`;

/** O dado que o valor inteiro representa ("{{nome}}" → "nome"); null quando é texto. */
export function dadoDoValor(valor: string): ChaveDoContato | null {
  const m = /^\{\{([a-z_]+)\}\}$/.exec(valor.trim());
  return m && ehChaveDoContato(m[1]) ? m[1] : null;
}

// Os nomes que o próprio CRM grava quando não sabe o nome (lib/webhooks-recepcao.ts
// e NOME_PROVISORIO de lib/instagram.ts): "Olá Sem" não é mensagem que se mande.
const NOMES_PROVISORIOS = new Set(["sem nome", "contato do instagram"]);

/**
 * Nome e cidade vêm de formulário público (lead da Meta, webhook de site) e vão
 * DENTRO da mensagem oficial da marca. Só passa o que tem cara de nome: começa
 * por letra, sem link, domínio, @, número ou marca de formatação, e curto. O
 * resto vira vazio — e vazio é falha registrada naquele contato, nunca a
 * mensagem com o texto de quem preencheu o formulário (revisão de segurança de
 * 2026-10-27: um lead chamado "golpe.com/pix" iria pelo número da marca).
 */
function comCaraDeNome(valor: string | null | undefined, maximo: number): string {
  const v = (valor ?? "").replace(/\s+/g, " ").trim();
  if (!v || v.length > maximo || NOMES_PROVISORIOS.has(v.toLowerCase())) return "";
  if (!/^\p{L}/u.test(v) || /[\d@*_~{}<>\\/]|:\/\/|www\.|\.\p{L}{2,}/iu.test(v)) return "";
  return v;
}

/** Os dados do contato que uma variável pode levar, já saneados. Vazio = não serve. */
export function dadosDoContato(c: { nome?: string | null; whatsapp?: string | null; email?: string | null; cidade?: string | null }): DadosDoContato {
  const nome = comCaraDeNome(c.nome, 60);
  const email = (c.email ?? "").trim();
  return {
    // Só com o nome inteiro aprovado: "Ana golpe.com" não vira "Ana".
    primeiro_nome: nome ? comCaraDeNome(nome.split(" ")[0], 30) : "",
    nome,
    cidade: comCaraDeNome(c.cidade, 40),
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "",
    numero: soDigitos(c.whatsapp ?? ""),
  };
}

/** A Meta recusa parâmetro com quebra de linha, tabulação ou 4 espaços seguidos. */
export const parametroLimpo = (texto: string) => texto.replace(/\s+/g, " ").trim();

/**
 * Os valores com as marcas trocadas pelos dados deste contato. Faltando um dado
 * (contato sem e-mail para a {{2}}), devolve o que falta: a campanha registra a
 * falha nesse contato em vez de mandar a variável vazia, que a Meta recusa.
 *
 * `botoes` também: é ali que o {{numero}} do link de vídeo vira o WhatsApp do
 * contato. Posição vazia em `botoes` é botão sem link com variável e continua
 * vazia. QUAL marca pode ir em cada lugar quem decide é problemaNoEnvio, que o
 * disparo chama antes (o {{numero}} só no link de vídeo do CRM).
 */
export function valoresParaContato(v: ValoresDoEnvio, dados: DadosDoContato): ValoresDoEnvio | { falta: string } {
  const faltas: string[] = [];
  const resolver = (lista: string[], qual: (i: number) => string, vazioPode = false) =>
    lista.map((valor, i) => {
      const texto = parametroLimpo(
        // `?? ""`: a lista vem de JSON guardado, e posição vazia de array volta como null.
        (valor ?? "").replace(MARCA_DO_CONTATO, (bruto, chave: string) => {
          if (!ehChaveDoContato(chave)) return bruto;
          if (!dados[chave]) faltas.push(`${rotuloDoDado(chave).toLowerCase()} para ${qual(i)}`);
          return dados[chave];
        }),
      );
      if (!texto && !vazioPode && !faltas.length) faltas.push(`valor para ${qual(i)}`);
      return texto;
    });
  const resolvidos: ValoresDoEnvio = {
    cabecalho: resolver(v.cabecalho, (i) => `a {{${i + 1}}} do cabeçalho`),
    corpo: resolver(v.corpo, (i) => `a {{${i + 1}}}`),
    ...(v.botoes ? { botoes: resolver(v.botoes, (i) => `o link do botão ${i + 1}`, true) } : {}),
  };
  return faltas.length ? { falta: faltas[0] } : resolvidos;
}

/**
 * Os parâmetros dos botões no envio, pelo `indice` do botão entre TODOS os
 * botões do template (o `index` da Graph API): o valor do {{1}} de cada link
 * com variável e o payload que a Meta devolve no clique de cada resposta
 * rápida (a campanha usa para saber de qual envio veio o clique).
 */
export type BotoesDoEnvio = {
  links?: Array<{ indice: number; valor: string }>;
  respostas?: Array<{ indice: number; payload: string }>;
};

/**
 * Os parâmetros no formato de `components` do envio de template da Graph API.
 * Sem `botoes`, só cabeçalho e corpo, como sempre foi.
 */
export function componentesDoEnvio(v: ValoresDoEnvio, botoes?: BotoesDoEnvio): Array<Record<string, unknown>> {
  const componentes: Array<Record<string, unknown>> = [];
  if (v.cabecalho.length) componentes.push({ type: "header", parameters: v.cabecalho.map((text) => ({ type: "text", text })) });
  if (v.corpo.length) componentes.push({ type: "body", parameters: v.corpo.map((text) => ({ type: "text", text })) });
  const doBotao = [
    ...(botoes?.links ?? []).map((l) => ({
      indice: l.indice,
      componente: { type: "button", sub_type: "url", index: String(l.indice), parameters: [{ type: "text", text: l.valor }] },
    })),
    ...(botoes?.respostas ?? []).map((r) => ({
      indice: r.indice,
      componente: { type: "button", sub_type: "quick_reply", index: String(r.indice), parameters: [{ type: "payload", payload: r.payload }] },
    })),
  ].sort((a, b) => a.indice - b.indice);
  componentes.push(...doBotao.map((b) => b.componente));
  return componentes;
}

/** Os textos dos botões de resposta rápida, na ordem — as saídas do "Aguardar resposta" da campanha. */
export function respostasRapidasDe(t: ConteudoTemplate): string[] {
  return t.botoes.filter((b) => b.tipo === "QUICK_REPLY" && b.texto.trim()).map((b) => b.texto);
}

/**
 * A parte fixa de um link com variável: sem o {{1}} do fim e sem espaço nas
 * pontas. Uma só para o editor de templates e o chat (cada tela tinha a sua).
 */
export const baseDoLink = (url: string) => url.trim().replace(/\{\{1\}\}$/, "");

/**
 * Os botões de link que terminam em {{1}}: cada um pede um valor no envio
 * (ValoresDoEnvio.botoes[indice]). `indice` é a posição do botão entre TODOS os
 * botões do template — é o `index` que a Graph API espera.
 */
export function linksVariaveisDe(t: ConteudoTemplate): Array<{ indice: number; texto: string; url: string }> {
  return t.botoes.flatMap((b, indice) =>
    b.tipo === "URL" && /\{\{1\}\}$/.test(b.destino ?? "") ? [{ indice, texto: b.texto, url: b.destino ?? "" }] : [],
  );
}

/**
 * O que o template pede no envio: quantas variáveis (o maior {{n}}) no
 * cabeçalho de texto e no corpo, e o índice de cada botão de link com variável.
 */
export function variaveisDoTemplate(t: ConteudoTemplate): { cabecalho: number; corpo: number; links: number[] } {
  const maior = (texto: string) => Math.max(0, ...variaveisDo(texto));
  return {
    cabecalho: t.cabecalho?.formato === "TEXT" ? maior(t.cabecalho.texto ?? "") : 0,
    corpo: maior(t.corpo),
    links: linksVariaveisDe(t).map((l) => l.indice),
  };
}

/** Uma lista na posição de cada botão até o último link com variável; o resto vazio. */
function naPosicaoDosLinks(links: number[], valor: (indice: number) => string): string[] {
  return Array.from({ length: links.length ? Math.max(...links) + 1 : 0 }, (_, i) => (links.includes(i) ? valor(i) : ""));
}

/**
 * Os valores cortados no que o template pede. A sobra vazia (um cabeçalho [""]
 * num template sem cabeçalho, vindo da IA) passa na conferência, mas no disparo
 * viraria parâmetro — e a Meta recusa parâmetro a mais. Em `botoes` só fica o
 * valor das posições que são link com variável (`n.links`).
 */
export function ajustarValores(v: ValoresDoEnvio, n: { cabecalho: number; corpo: number; links?: number[] }): ValoresDoEnvio {
  const ajustados: ValoresDoEnvio = { cabecalho: v.cabecalho.slice(0, n.cabecalho), corpo: v.corpo.slice(0, n.corpo) };
  if (v.botoes) ajustados.botoes = naPosicaoDosLinks(n.links ?? [], (i) => v.botoes?.[i] ?? "");
  return ajustados;
}

/**
 * Valores iniciais de um template: a {{1}} do corpo começa como o primeiro
 * nome, o link de vídeo do CRM como o WhatsApp do contato, o resto em branco.
 */
export function valoresIniciais(t: ConteudoTemplate): ValoresDoEnvio {
  const n = variaveisDoTemplate(t);
  const links = linksVariaveisDe(t);
  const doVideo = (i: number) => links.some((l) => l.indice === i && ehLinkDeVideoDoCrm(l.url));
  return {
    cabecalho: Array.from({ length: n.cabecalho }, () => ""),
    corpo: Array.from({ length: n.corpo }, (_, i) => (i === 0 ? marcaDoContato("primeiro_nome") : "")),
    ...(n.links.length ? { botoes: naPosicaoDosLinks(n.links, (i) => (doVideo(i) ? marcaDoContato("numero") : "")) } : {}),
  };
}

/**
 * O que impede disparar este template com estes valores numa campanha (null =
 * pode). Conferido na criação, na ativação e de novo em cada disparo (o
 * template pode ter mudado na Meta); o editor de campanha mostra o mesmo texto
 * ao lado do botão. Valor a mais também barra: a Meta recusa parâmetro sobrando,
 * e a campanha queimaria o segmento inteiro.
 *
 * Link com variável: cada um pede valor em `v.botoes[indice]`, conferido por
 * problemaDoLinkVariavel (texto fixo, ou {{numero}} só no link de vídeo do
 * CRM). E-mail e WhatsApp continuam fora do cabeçalho e do corpo.
 */
export function problemaNoEnvio(t: ConteudoTemplate, v: ValoresDoEnvio): string | null {
  const semEnvio = motivoSemEnvio(t);
  if (semEnvio) return semEnvio;
  const n = variaveisDoTemplate(t);
  const listas: Array<[string[], number, string, number]> = [
    [v.cabecalho, n.cabecalho, " do cabeçalho", LIMITE.cabecalho],
    [v.corpo, n.corpo, "", LIMITE.valorFixo],
  ];
  for (const [lista, total, onde, maximo] of listas) {
    if (lista.slice(total).some((x) => x.trim()))
      return total ? `O template pede ${total === 1 ? "uma variável" : `${total} variáveis`}${onde} e sobrou valor.` : `O template não tem variável${onde}.`;
    for (let i = 0; i < total; i++) {
      const valor = (lista[i] ?? "").trim();
      const qual = `{{${i + 1}}}${onde}`;
      if (!valor) return `Escolha o que vai na ${qual}.`;
      if (valor.length > maximo) return `O texto da ${qual} tem até ${maximo} caracteres.`;
      for (const m of valor.matchAll(MARCA_DO_CONTATO)) {
        const dado = DADOS_DO_CONTATO.find((d) => d.chave === m[1]);
        if (dado?.chave === "numero") return "WhatsApp do contato não vai em campanha no texto: só no link de vídeo do CRM.";
        if (dado && !dado.naCampanha) return `${dado.rotulo} não vai em campanha, só no chat, onde alguém confere antes de mandar.`;
      }
      // Tirando as marcas conhecidas, não pode sobrar chave: {{Primeiro_nome}}
      // ou {{ nome }} iriam literais para o segmento inteiro.
      const resto = valor.replace(MARCA_DO_CONTATO, (bruto, chave: string) => (ehChaveDoContato(chave) ? "" : bruto));
      if (/\{\{|\}\}/.test(resto)) return `A ${qual} tem uma marca que não é dado do contato. Use o seletor.`;
    }
  }

  const links = linksVariaveisDe(t);
  const botoes = v.botoes ?? [];
  if (botoes.some((x, i) => (x ?? "").trim() && !links.some((l) => l.indice === i)))
    return links.length ? "Sobrou valor num botão que não é link com variável." : "O template não tem link com variável.";
  for (const l of links) {
    const valor = (botoes[l.indice] ?? "").trim();
    if (!valor) return `Preencha o final do link do botão “${l.texto}”.`;
    const problema = problemaDoLinkVariavel(l.url, valor);
    if (problema) return `O link do botão “${l.texto}”: ${problema}`;
  }
  return null;
}

/** O valor como a revisão mostra: a marca vira "[Primeiro nome do contato]". */
const paraRevisao = (valor: string) =>
  valor.replace(MARCA_DO_CONTATO, (marca, chave: string) => (ehChaveDoContato(chave) ? `[${rotuloDoDado(chave)} do contato]` : marca));

/**
 * A mensagem como a campanha vai mandar, com cada {{n}} trocado pelo que vai
 * ali — "[Primeiro nome do contato]" ou o texto fixo — e os botões no fim, com
 * o link já completo ("[WhatsApp do contato]" no lugar do {{numero}}). É o que
 * se confere antes de ativar, inclusive o rascunho que a IA montou.
 */
export function textoParaRevisao(t: ConteudoTemplate, v: ValoresDoEnvio): string {
  const trocar = (texto: string, lista: string[]) =>
    texto.replace(/\{\{(\d+)\}\}/g, (bruto, n: string) => {
      const valor = (lista[Number(n) - 1] ?? "").trim();
      return valor ? paraRevisao(valor) : bruto;
    });
  const botoes = t.botoes.flatMap((b, i) => {
    if (!b.texto.trim()) return [];
    if (b.tipo === "URL" && b.destino) {
      const valor = (v.botoes?.[i] ?? "").trim();
      const destino = valor ? b.destino.replace(/\{\{1\}\}$/, () => paraRevisao(valor)) : b.destino;
      return [`[${b.texto}] ${destino}`];
    }
    return [b.tipo === "PHONE_NUMBER" && b.destino ? `[${b.texto}] ${b.destino}` : `[${b.texto}]`];
  });
  return [
    t.cabecalho?.formato === "TEXT" && t.cabecalho.texto ? trocar(t.cabecalho.texto, v.cabecalho) : "",
    trocar(t.corpo, v.corpo),
    t.rodape ?? "",
    botoes.join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

// ── Duplicar ────────────────────────────────────────────────────────────────

const TIPOS_BOTAO: string[] = ["QUICK_REPLY", "URL", "PHONE_NUMBER"] satisfies TipoBotao[];
const ehTipoBotao = (tipo: string): tipo is TipoBotao => TIPOS_BOTAO.includes(tipo);

const MIDIA_DO_CABECALHO: Record<string, string> = {
  IMAGE: "o cabeçalho de imagem",
  VIDEO: "o cabeçalho de vídeo",
  DOCUMENT: "o cabeçalho de documento",
  LOCATION: "o cabeçalho de localização",
};

const proximaVersao = (nome: string) => {
  const m = /_v(\d+)$/.exec(nome);
  return m ? `${nome.slice(0, m.index)}_v${Number(m[1]) + 1}` : `${nome}_v2`;
};

/**
 * Um template existente como ponto de partida para um novo — o caminho para
 * corrigir um rejeitado —, com o próximo nome livre (`_v2`, `_v3`…) e os botões
 * já agrupados. `deFora` diz o que a cópia não leva, para o editor avisar em vez
 * de perder calado: mídia do cabeçalho, botões de tipo que este editor não cria
 * e a categoria Autenticação.
 */
export function rascunhoDe(t: TemplateWhatsApp, nomesUsados: Set<string>): { rascunho: Rascunho; deFora: string[] } {
  let nome = proximaVersao(t.nome);
  while (nomesUsados.has(nome)) nome = proximaVersao(nome);

  const deFora: string[] = [];
  const formato = t.cabecalho?.formato;
  if (formato && formato !== "TEXT") deFora.push(MIDIA_DO_CABECALHO[formato] ?? "o cabeçalho de mídia");
  const semSuporte = t.botoes.filter((b) => !ehTipoBotao(b.tipo)).length;
  if (semSuporte) deFora.push(semSuporte === 1 ? "1 botão de um tipo que este editor não cria" : `${semSuporte} botões de tipos que este editor não cria`);
  if (t.categoria === "AUTHENTICATION") deFora.push("a categoria Autenticação (a cópia sai como Marketing)");

  return {
    rascunho: {
      nome,
      categoria: t.categoria === "UTILITY" ? "UTILITY" : "MARKETING",
      cabecalho: formato === "TEXT" ? (t.cabecalho?.texto ?? "") : "",
      corpo: t.corpo,
      rodape: t.rodape ?? "",
      exemplosCabecalho: t.exemplosCabecalho,
      exemplosCorpo: t.exemplosCorpo,
      botoes: emGrupos(t.botoes.flatMap((b) => (ehTipoBotao(b.tipo) ? [{ tipo: b.tipo, texto: b.texto, destino: b.destino ?? "" }] : []))),
    },
    deFora,
  };
}
