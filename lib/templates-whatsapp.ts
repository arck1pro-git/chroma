// O template oficial do WhatsApp nos três sentidos: LER o que a Meta devolve
// (lerTemplate) num formato que a tela desenha sem conhecer o JSON da Graph
// API; MONTAR um novo a partir do editor de Templates (problemasDo,
// componentesDoRascunho, rascunhoDe); e ENVIAR — o valor de cada {{n}} no chat
// e nas campanhas, com dado do contato (seção "Variáveis no envio").
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
  /** Texto fixo de uma variável do corpo numa campanha; o do cabeçalho segue `cabecalho`. */
  valorFixo: 200,
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
 * Tem cabeçalho de mídia, link variável ou variável com nome ({{first_name}},
 * criado no WhatsApp Manager): o CRM ainda não envia, nem pelo chat nem por
 * campanha — os dois só preenchem variável de texto numerada.
 */
export function semEnvioPeloCrm(t: ConteudoTemplate): boolean {
  return (
    (t.cabecalho !== null && t.cabecalho.formato !== "TEXT") ||
    t.botoes.some((b) => /\{\{\d+\}\}/.test(b.destino ?? "")) ||
    temVariavelForaDoPadrao(`${t.cabecalho?.texto ?? ""} ${t.corpo}`)
  );
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
// de 2026-10-27).
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
/** O valor de cada {{n}}, na ordem: cabecalho[0] é a {{1}} do cabeçalho. */
export type ValoresDoEnvio = { cabecalho: string[]; corpo: string[] };

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
 */
export function valoresParaContato(v: ValoresDoEnvio, dados: DadosDoContato): ValoresDoEnvio | { falta: string } {
  const faltas: string[] = [];
  const resolver = (lista: string[], onde: string) =>
    lista.map((valor, i) => {
      const texto = parametroLimpo(
        valor.replace(MARCA_DO_CONTATO, (bruto, chave: string) => {
          if (!ehChaveDoContato(chave)) return bruto;
          if (!dados[chave]) faltas.push(`${rotuloDoDado(chave).toLowerCase()} para a {{${i + 1}}}${onde}`);
          return dados[chave];
        }),
      );
      if (!texto && !faltas.length) faltas.push(`valor para a {{${i + 1}}}${onde}`);
      return texto;
    });
  const resolvidos = { cabecalho: resolver(v.cabecalho, " do cabeçalho"), corpo: resolver(v.corpo, "") };
  return faltas.length ? { falta: faltas[0] } : resolvidos;
}

/** Os parâmetros no formato de `components` do envio de template da Graph API. */
export function componentesDoEnvio(v: ValoresDoEnvio): Array<Record<string, unknown>> {
  const componentes: Array<Record<string, unknown>> = [];
  if (v.cabecalho.length) componentes.push({ type: "header", parameters: v.cabecalho.map((text) => ({ type: "text", text })) });
  if (v.corpo.length) componentes.push({ type: "body", parameters: v.corpo.map((text) => ({ type: "text", text })) });
  return componentes;
}

/** Quantas variáveis o template pede (o maior {{n}}) no cabeçalho de texto e no corpo. */
export function variaveisDoTemplate(t: ConteudoTemplate): { cabecalho: number; corpo: number } {
  const maior = (texto: string) => Math.max(0, ...variaveisDo(texto));
  return { cabecalho: t.cabecalho?.formato === "TEXT" ? maior(t.cabecalho.texto ?? "") : 0, corpo: maior(t.corpo) };
}

/**
 * Os valores cortados no que o template pede. A sobra vazia (um cabeçalho [""]
 * num template sem cabeçalho, vindo da IA) passa na conferência, mas no disparo
 * viraria parâmetro — e a Meta recusa parâmetro a mais.
 */
export function ajustarValores(v: ValoresDoEnvio, n: { cabecalho: number; corpo: number }): ValoresDoEnvio {
  return { cabecalho: v.cabecalho.slice(0, n.cabecalho), corpo: v.corpo.slice(0, n.corpo) };
}

/** Valores iniciais de um template: a {{1}} do corpo começa como o primeiro nome, o resto em branco. */
export function valoresIniciais(t: ConteudoTemplate): ValoresDoEnvio {
  const n = variaveisDoTemplate(t);
  return {
    cabecalho: Array.from({ length: n.cabecalho }, () => ""),
    corpo: Array.from({ length: n.corpo }, (_, i) => (i === 0 ? marcaDoContato("primeiro_nome") : "")),
  };
}

/**
 * O que impede disparar este template com estes valores numa campanha (null =
 * pode). Conferido na criação, na ativação e de novo em cada disparo (o
 * template pode ter mudado na Meta); o editor de campanha mostra o mesmo texto
 * ao lado do botão. Valor a mais também barra: a Meta recusa parâmetro sobrando,
 * e a campanha queimaria o segmento inteiro.
 */
export function problemaNoEnvio(t: ConteudoTemplate, v: ValoresDoEnvio): string | null {
  if (semEnvioPeloCrm(t)) return "Este template tem cabeçalho de mídia, link variável ou variável com nome, que o CRM ainda não envia.";
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
        if (dado && !dado.naCampanha) return `${dado.rotulo} não vai em campanha, só no chat, onde alguém confere antes de mandar.`;
      }
      // Tirando as marcas conhecidas, não pode sobrar chave: {{Primeiro_nome}}
      // ou {{ nome }} iriam literais para o segmento inteiro.
      const resto = valor.replace(MARCA_DO_CONTATO, (bruto, chave: string) => (ehChaveDoContato(chave) ? "" : bruto));
      if (/\{\{|\}\}/.test(resto)) return `A ${qual} tem uma marca que não é dado do contato. Use o seletor.`;
    }
  }
  return null;
}

/**
 * A mensagem como a campanha vai mandar, com cada {{n}} trocado pelo que vai
 * ali — "[Primeiro nome do contato]" ou o texto fixo. É o que se confere antes
 * de ativar, inclusive o rascunho que a IA montou.
 */
export function textoParaRevisao(t: ConteudoTemplate, v: ValoresDoEnvio): string {
  const trocar = (texto: string, lista: string[]) =>
    texto.replace(/\{\{(\d+)\}\}/g, (bruto, n: string) => {
      const valor = (lista[Number(n) - 1] ?? "").trim();
      if (!valor) return bruto;
      return valor.replace(MARCA_DO_CONTATO, (marca, chave: string) =>
        ehChaveDoContato(chave) ? `[${rotuloDoDado(chave)} do contato]` : marca,
      );
    });
  return [
    t.cabecalho?.formato === "TEXT" && t.cabecalho.texto ? trocar(t.cabecalho.texto, v.cabecalho) : "",
    trocar(t.corpo, v.corpo),
    t.rodape ?? "",
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
