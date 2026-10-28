// O FORMATO em que a IA do construtor de campanhas (lib/ia/campanhas-construtor.ts)
// lê e escreve o fluxo, e a regra do que ela escreve que leva para fora do CRM.
//
// OS BLOCOS EM LISTA, com id e campos em snake_case: é o mesmo formato que
// ver_fluxo_aberto devolve e desenhar_fluxo recebe, para o modelo editar o que
// leu. fluxoDoDesenho converte para o FluxoCampanha do contrato
// (lib/campanhas-fluxo.ts) e confere a forma por lerFluxoDaEntrada;
// blocoParaIa faz a volta, com o texto livre embrulhado por comoDado (numa
// campanha pausada ou rascunho ele pode ter sido escrito por um colega). As
// marcas que o modelo copiar de volta saem na conversão.
//
// LINK, TELEFONE E E-MAIL (revisões de segurança de 2026-10-28): no texto que
// sai para o contato, para a equipe ou para o card, só passa o trecho que a
// PESSOA escreveu na conversa ou que já estava no fluxo aberto
// (contatosNaoEscritos). Com qualquer outro, o desenho não vai para o canvas:
// a IA não inventa para onde mandar alguém. Link é qualquer palavra.tld.
import "server-only";
import { z } from "zod";
import { ehIdDeBloco, lerFluxoDaEntrada } from "@/lib/campanhas-fluxo-entrada";
import { VERSAO_FLUXO, type BlocoCampanha, type Destino, type FluxoCampanha, type ProblemaDoFluxo } from "@/lib/campanhas-fluxo";
import { dadoDoValor, IDIOMA_PADRAO } from "@/lib/templates-whatsapp";
import { soDigitos } from "@/lib/telefone";
import { comoDado } from "./sanitizar";

/** Um fluxo lido pela forma do contrato: o fluxo, ou o que está fora dela. */
export type FluxoAberto = ReturnType<typeof lerFluxoDaEntrada>;

// ── O formato da IA ─────────────────────────────────────────────────────────

const idBloco = z.string().describe("Id do bloco: minúsculas, números, _ ou - (até 40). Em campanha salva, o dos blocos que continuam não muda.");
const proximo = z.string().nullable().optional().describe("Id do próximo bloco; null encerra o caminho.");
const acao = z.enum(["adicionar", "remover"]);

const blocoDaIa = z.discriminatedUnion("tipo", [
  z.object({
    id: idBloco,
    tipo: z.literal("enviar_template"),
    template_nome: z.string(),
    template_idioma: z.string().optional().describe("O idioma do template em listar_alvos_campanha."),
    variaveis: z
      .object({ cabecalho: z.array(z.string()).optional(), corpo: z.array(z.string()).optional(), botoes: z.array(z.string()).optional() })
      .optional()
      .describe("O valor de cada {{n}}, na ordem: dado do contato ou texto fixo curto. Em botoes, o final de cada link com variável, na posição (indice) do botão."),
    proximo,
  }),
  z.object({
    id: idBloco,
    tipo: z.literal("aguardar_resposta"),
    prazo_minutos: z.number().describe("De 5 a 43200. Um dia = 1440."),
    botoes: z
      .array(z.object({ botao: z.string().describe("O texto EXATO de uma resposta rápida do último template enviado antes deste bloco."), proximo }))
      .optional(),
    palavras: z.array(z.object({ contem: z.string(), proximo })).optional().describe("Resposta escrita que contém o texto, conferidas na ordem (até 10)."),
    outra: proximo.describe("Respondeu outra coisa."),
    sem_resposta: proximo.describe("O prazo venceu sem resposta."),
  }),
  z.object({ id: idBloco, tipo: z.literal("enviar_texto"), texto: z.string(), proximo }),
  z.object({ id: idBloco, tipo: z.literal("esperar"), minutos: z.number().describe("De 5 a 43200."), proximo }),
  z.object({ id: idBloco, tipo: z.literal("mudar_tag"), acao, tag_id: z.string(), proximo }),
  z.object({ id: idBloco, tipo: z.literal("mudar_segmento"), acao, segmento_id: z.string(), proximo }),
  z.object({ id: idBloco, tipo: z.literal("criar_oportunidade"), funil_id: z.string(), etapa_id: z.string(), nome: z.string(), proximo }),
  z.object({ id: idBloco, tipo: z.literal("mover_oportunidade"), funil_id: z.string(), etapa_id: z.string(), proximo }),
  z.object({ id: idBloco, tipo: z.literal("registrar_conversao"), proximo }),
  z.object({
    id: idBloco,
    tipo: z.literal("avisar_equipe"),
    instancia_id: z.string().describe("Um id de numeros_de_aviso."),
    usuario_ids: z.array(z.string()).optional().describe("Ids de equipe."),
    responsavel_do_funil: z.string().nullable().optional().describe("Id do funil: avisa também o responsável da oportunidade aberta do contato nele."),
    texto: z.string(),
    proximo,
  }),
  z.object({ id: idBloco, tipo: z.literal("ligar_ia"), ia_id: z.string(), proximo }),
]);

export const entradaDoDesenho = z.object({
  inicio: z.string().nullable().describe("Id do primeiro bloco depois da entrada."),
  blocos: z.array(blocoDaIa).describe("TODOS os blocos do fluxo, inclusive os que não mudaram."),
  nome: z.string().optional().describe("Nome sugerido para a campanha."),
  segmento_ids: z
    .array(z.string())
    .optional()
    .describe("Só em campanha nova: os ids dos segmentos que a pessoa nomeou. Omitido ou vazio mantém o público que está na tela."),
});

export type EntradaDoDesenho = z.infer<typeof entradaDoDesenho>;
type BlocoDaIa = z.infer<typeof blocoDaIa>;

// O modelo pode copiar de volta as marcas de comoDado do que leu. Texto de
// campanha de verdade não tem "<<<…>>>" (comoDado troca a imitação na ida).
const MARCAS = /<<<[^>]*>>>/g;
export const semMarcas = (s: string) => s.replace(MARCAS, "");
const ate = (d: string | null | undefined): Destino => d ?? null;

function blocoDoDesenho(b: BlocoDaIa): BlocoCampanha {
  switch (b.tipo) {
    case "enviar_template": {
      const v = b.variaveis ?? {};
      return {
        tipo: b.tipo,
        template_nome: semMarcas(b.template_nome).trim(),
        template_idioma: semMarcas(b.template_idioma ?? "").trim() || IDIOMA_PADRAO,
        variaveis: {
          cabecalho: (v.cabecalho ?? []).map(semMarcas),
          corpo: (v.corpo ?? []).map(semMarcas),
          ...(v.botoes ? { botoes: v.botoes.map(semMarcas) } : {}),
        },
        proximo: ate(b.proximo),
      };
    }
    case "aguardar_resposta":
      return {
        tipo: b.tipo,
        prazo_minutos: b.prazo_minutos,
        botoes: Object.fromEntries((b.botoes ?? []).map((x) => [semMarcas(x.botao).trim(), ate(x.proximo)])),
        palavras: (b.palavras ?? []).map((p) => ({ contem: semMarcas(p.contem), proximo: ate(p.proximo) })),
        outra: ate(b.outra),
        sem_resposta: ate(b.sem_resposta),
      };
    case "enviar_texto":
      return { tipo: b.tipo, texto: semMarcas(b.texto), proximo: ate(b.proximo) };
    case "esperar":
      return { tipo: b.tipo, minutos: b.minutos, proximo: ate(b.proximo) };
    case "mudar_tag":
      return { tipo: b.tipo, acao: b.acao, tagId: b.tag_id.trim(), proximo: ate(b.proximo) };
    case "mudar_segmento":
      return { tipo: b.tipo, acao: b.acao, segmentoId: b.segmento_id.trim(), proximo: ate(b.proximo) };
    case "criar_oportunidade":
      return { tipo: b.tipo, funilId: b.funil_id.trim(), etapaId: b.etapa_id.trim(), nome: semMarcas(b.nome), proximo: ate(b.proximo) };
    case "mover_oportunidade":
      return { tipo: b.tipo, funilId: b.funil_id.trim(), etapaId: b.etapa_id.trim(), proximo: ate(b.proximo) };
    case "registrar_conversao":
      return { tipo: b.tipo, proximo: ate(b.proximo) };
    case "avisar_equipe":
      return {
        tipo: b.tipo,
        instanciaId: b.instancia_id.trim(),
        usuarioIds: [...new Set((b.usuario_ids ?? []).map((u) => u.trim()))],
        responsavelDoFunil: b.responsavel_do_funil?.trim() || null,
        texto: semMarcas(b.texto),
        proximo: ate(b.proximo),
      };
    case "ligar_ia":
      return { tipo: b.tipo, iaId: b.ia_id.trim(), proximo: ate(b.proximo) };
  }
}

/**
 * A entrada de desenhar_fluxo como FluxoCampanha (sem posições), já pela forma
 * do contrato (lerFluxoDaEntrada). Id fora do padrão ou repetido é problema
 * aqui, antes de virar chave de objeto: "__proto__" e "constructor" não chegam
 * a ser chave.
 */
export function fluxoDoDesenho(e: Pick<EntradaDoDesenho, "inicio" | "blocos">): FluxoAberto {
  const problemas: ProblemaDoFluxo[] = [];
  const vistos = new Set<string>();
  for (const b of e.blocos) {
    if (!ehIdDeBloco(b.id))
      problemas.push({ blocoId: null, mensagem: `O id “${b.id.slice(0, 40)}” está fora do padrão: minúsculas, números, _ ou -, até 40, e não pode ser “inicio”.` });
    else if (vistos.has(b.id)) problemas.push({ blocoId: b.id, mensagem: "Dois blocos com o mesmo id." });
    vistos.add(b.id);
  }
  if (problemas.length) return { ok: false, problemas };
  const blocos = Object.fromEntries(e.blocos.map((b) => [b.id, blocoDoDesenho(b)]));
  return lerFluxoDaEntrada({ versao: VERSAO_FLUXO, inicio: e.inicio ?? null, blocos, posicoes: {} });
}

/** Valor de variável: a marca pura vai como está; texto fixo, embrulhado. */
const valorParaIa = (v: string) => (!v || dadoDoValor(v) ? v : comoDado(v));

/** Um bloco no formato da IA, com o texto livre embrulhado (pode ser de um colega). */
export function blocoParaIa(id: string, b: BlocoCampanha): BlocoDaIa {
  switch (b.tipo) {
    case "enviar_template":
      return {
        id,
        tipo: b.tipo,
        template_nome: b.template_nome,
        template_idioma: b.template_idioma,
        variaveis: {
          cabecalho: b.variaveis.cabecalho.map(valorParaIa),
          corpo: b.variaveis.corpo.map(valorParaIa),
          ...(b.variaveis.botoes ? { botoes: b.variaveis.botoes.map(valorParaIa) } : {}),
        },
        proximo: b.proximo,
      };
    case "aguardar_resposta":
      return {
        id,
        tipo: b.tipo,
        prazo_minutos: b.prazo_minutos,
        botoes: Object.entries(b.botoes).map(([botao, destino]) => ({ botao: comoDado(botao), proximo: destino })),
        palavras: b.palavras.map((p) => ({ contem: comoDado(p.contem), proximo: p.proximo })),
        outra: b.outra,
        sem_resposta: b.sem_resposta,
      };
    case "enviar_texto":
      return { id, tipo: b.tipo, texto: comoDado(b.texto), proximo: b.proximo };
    case "esperar":
      return { id, tipo: b.tipo, minutos: b.minutos, proximo: b.proximo };
    case "mudar_tag":
      return { id, tipo: b.tipo, acao: b.acao, tag_id: b.tagId, proximo: b.proximo };
    case "mudar_segmento":
      return { id, tipo: b.tipo, acao: b.acao, segmento_id: b.segmentoId, proximo: b.proximo };
    case "criar_oportunidade":
      return { id, tipo: b.tipo, funil_id: b.funilId, etapa_id: b.etapaId, nome: comoDado(b.nome), proximo: b.proximo };
    case "mover_oportunidade":
      return { id, tipo: b.tipo, funil_id: b.funilId, etapa_id: b.etapaId, proximo: b.proximo };
    case "registrar_conversao":
      return { id, tipo: b.tipo, proximo: b.proximo };
    case "avisar_equipe":
      return {
        id,
        tipo: b.tipo,
        instancia_id: b.instanciaId,
        usuario_ids: b.usuarioIds,
        responsavel_do_funil: b.responsavelDoFunil,
        texto: comoDado(b.texto),
        proximo: b.proximo,
      };
    case "ligar_ia":
      return { id, tipo: b.tipo, ia_id: b.iaId, proximo: b.proximo };
  }
}

// ── Link, telefone e e-mail que a pessoa não escreveu ───────────────────────

/** O texto de um bloco que sai do CRM: para o contato, para a equipe ou para o card. */
export function textosQueSaem(b: BlocoCampanha): string[] {
  if (b.tipo === "enviar_texto" || b.tipo === "avisar_equipe") return [b.texto];
  if (b.tipo === "criar_oportunidade") return [b.nome];
  if (b.tipo === "enviar_template") return [...b.variaveis.cabecalho, ...b.variaveis.corpo, ...(b.variaveis.botoes ?? [])].map((v) => v ?? "");
  return [];
}

const ARROBA = /[^\s@<>"'“”]*@[^\s@<>"'“”]*/g;
// Qualquer palavra.tld (revisão de segurança M1, 2026-10-28): rótulos com letra,
// número, _ ou -, e o TLD de 2 a 24 letras que não emenda em outra letra —
// "golpe.xyz/pix", "bit.ly/x" e "loja.imob" contam; "Sr.João" não, porque o
// "jo" emenda no "ão". Ponto colado em palavra ("obrigado.Te") também conta: o
// modelo põe o espaço e desenha de novo.
const LINK =
  /\bhttps?:\/\/[^\s<>"'“”]+|\bwww\.[^\s<>"'“”]+|(?<![\p{L}\p{N}_@.-])(?:[\p{L}\p{N}_-]+\.)+[a-z]{2,24}(?![\p{L}\p{N}_-])(?:\/[^\s<>"'“”]*)?/giu;
// Dinheiro com R$ sai antes do número, para "R$ 15.000.000" não virar telefone.
const DINHEIRO = /R\$\s?\d{1,3}(?:[.\s]\d{3})*(?:,\d{1,2})?/gi;
// 8 ou mais dígitos, com separador de telefone no meio, inclusive ponto
// ("(47) 99999-9999", "47.99999.9999"). Data com ponto também conta.
const NUMERO = /\+?\(?\d(?:[\s().-]{0,2}\d){7,}/g;
const PONTA = /[.,;:!?)\]}”’'"]+$/;

/** Os trechos com cara de contato, cada um uma vez: e-mail e @ antes, depois link, depois número solto. */
function trechosDeContato(texto: string): Array<{ tipo: "arroba" | "link" | "numero"; trecho: string }> {
  const achados: Array<{ tipo: "arroba" | "link" | "numero"; trecho: string }> = [];
  let resto = texto.replace(DINHEIRO, " ");
  for (const [tipo, padrao] of [["arroba", ARROBA], ["link", LINK], ["numero", NUMERO]] as const) {
    resto = resto.replace(padrao, (m) => {
      const trecho = m.replace(PONTA, "");
      if (tipo !== "arroba" || trecho.includes("@")) achados.push({ tipo, trecho });
      return " ";
    });
  }
  return achados;
}

/**
 * Link, telefone ou e-mail no que sai, que não aparece nas falas da pessoa nem
 * no fluxo aberto. Link vale sem o "https://" e o "www." (a mesma página);
 * telefone pelos dígitos (com ou sem o 55 na frente). Com algum, o desenho não
 * vai para o canvas (desenhar_fluxo): o modelo tira ou pergunta.
 */
export function contatosNaoEscritos(fluxo: FluxoCampanha, escritos: string[]): ProblemaDoFluxo[] {
  const fonte = escritos.join("\n").toLowerCase();
  const numerosDaFonte = [...fonte.matchAll(/\+?\(?\d(?:[\s().-]{0,2}\d)*/g)].map((m) => soDigitos(m[0])).filter((n) => n.length >= 8);
  const escreveu = (tipo: "arroba" | "link" | "numero", trecho: string) => {
    if (tipo === "numero") {
      const n = soDigitos(trecho);
      return numerosDaFonte.some((f) => f.includes(n) || `55${f}` === n);
    }
    const t = trecho.toLowerCase();
    return fonte.includes(tipo === "link" ? t.replace(/^https?:\/\//, "").replace(/^www\./, "") : t);
  };
  const p: ProblemaDoFluxo[] = [];
  const ditos = new Set<string>();
  for (const [id, b] of Object.entries(fluxo.blocos)) {
    for (const texto of textosQueSaem(b)) {
      for (const { tipo, trecho } of trechosDeContato(texto)) {
        if (!trecho || escreveu(tipo, trecho) || ditos.has(`${id}|${trecho}`)) continue;
        ditos.add(`${id}|${trecho}`);
        p.push({ blocoId: id, mensagem: `Link, telefone ou e-mail que a pessoa não escreveu nesta conversa: “${trecho.slice(0, 120)}”. Tire, ou pergunte a ela qual vai.` });
      }
    }
  }
  return p;
}
