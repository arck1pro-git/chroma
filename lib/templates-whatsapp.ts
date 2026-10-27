// O template oficial do WhatsApp nos dois sentidos, para a tela de Templates:
// LER o que a Meta devolve (lerTemplate) num formato que a tela desenha sem
// conhecer o JSON da Graph API, e MONTAR um novo a partir do editor
// (problemasDo, componentesDoRascunho, rascunhoDe).
//
// Puro, sem server-only, de propósito: o editor confere as mesmas regras
// enquanto a pessoa digita, e a rota (app/api/meta/templates) confere de novo,
// porque o que chega do navegador não é confiável. Uma regra só, aplicada nos
// dois lugares. Testado por scripts/testar-templates-whatsapp.ts.
//
// As regras são as que a Meta aplica na criação (2026-10): exemplo obrigatório
// para cada variável (sem ele a Meta recusa o envio, e até 2026-10-27 o editor
// não pedia), variáveis numeradas e em sequência, texto que não começa nem
// termina com variável, até 10 botões com no máximo 2 links e 1 telefone,
// respostas rápidas agrupadas separadas dos botões de ação.
// Cabeçalho só de texto: imagem, vídeo e documento exigem subir a mídia na Meta
// antes (upload retomável), o que este editor não faz.
import type { TemplateMeta } from "@/lib/meta";
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

/** Tem cabeçalho de mídia ou link variável: o chat não envia, só as campanhas (app/chat/actions.ts). */
export function soPorCampanhas(t: ConteudoTemplate): boolean {
  return (t.cabecalho !== null && t.cabecalho.formato !== "TEXT") || t.botoes.some((b) => /\{\{\d+\}\}/.test(b.destino ?? ""));
}

// ── O que o editor monta ────────────────────────────────────────────────────

export type BotaoRascunho = { tipo: TipoBotao; texto: string; destino: string };

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
      if (destino.includes("{{")) p.push({ campo: "botoes", mensagem: "Link com variável não dá para criar por aqui." });
      else if (!ehLink(destino) || destino.length > LIMITE.url)
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
          ? { type: "URL", text: b.texto.trim(), url: b.destino.trim() }
          : b.tipo === "PHONE_NUMBER"
            ? { type: "PHONE_NUMBER", text: b.texto.trim(), phone_number: telefoneDoBotao(b.destino) }
            : { type: "QUICK_REPLY", text: b.texto.trim() },
      ),
    });
  }
  return componentes;
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
