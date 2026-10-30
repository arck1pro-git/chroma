// O FLUXO de uma campanha de WhatsApp oficial, em blocos (pedido dele,
// 2026-10-27: "o envio aguarda resposta e faz algo depois"). Este arquivo é o
// CONTRATO entre o motor (lib/campanhas-whatsapp.ts, que executa) e a tela
// (app/campanhas/, que desenha e edita): o formato, o catálogo dos blocos, a
// validação, qual saída uma resposta toma e a conversão das campanhas do
// formato antigo. Puro, sem server-only: a tela valida enquanto se monta, o
// servidor valida de novo antes de gravar e de ativar.
//
// COMO UM CONTATO ANDA: entra pelo início (inscrito pelos segmentos), executa
// os blocos imediatos em sequência e para nos de espera — "Aguardar resposta"
// (até responder ou vencer o prazo), "Esperar" (um tempo), "Horário de envio"
// (fora da janela, até ela abrir) e "Permissão de passagem" (cheia, até a vez
// dele). O bloco onde ele está fica em campanha_whatsapp_execucoes.bloco_atual;
// `proximo: null` é o fim. A "Condição" tem duas saídas, sim e não; o
// "Alternar" (2026-10-30), uma por caminho, que os contatos ocupam em rodízio.
//
// As ligações moram em cada bloco (`proximo`, ou as saídas do Aguardar), e não
// numa lista de arestas à parte: uma fonte só, sem aresta apontando para bloco
// que não existe mais.
//
// SEM LAÇO (revisão de segurança do desenho, 2026-10-27): nenhum caminho volta
// a um bloco anterior. Com laço, um robô que responde sozinho (número comercial
// com mensagem automática) faria o fluxo girar mandando texto, aviso à equipe e
// evento sem fim. "Reenviar até responder" se monta em sequência (template →
// aguardar → sem resposta → esperar → template…), e o limite de blocos limita
// os envios por contato.
import type { ChaveModulo } from "@/lib/auth/modulos";
import type { Operacao } from "@/lib/auth/permissoes";
import { respostasRapidasDe, type TemplateWhatsApp, type ValoresDoEnvio } from "@/lib/templates-whatsapp";

export const VERSAO_FLUXO = 2;

/** O nó fixo de entrada no canvas (os segmentos). Não é bloco: não executa nada. */
export const NO_INICIO = "inicio";

export type Posicao = { x: number; y: number };

/** Uma ligação: o id do próximo bloco, ou null para encerrar ali. */
export type Destino = string | null;

export type BlocoCampanha =
  | {
      tipo: "enviar_template";
      template_nome: string;
      template_idioma: string;
      /** Texto fixo ou marca de dado do contato ({{primeiro_nome}}…), por variável. */
      variaveis: ValoresDoEnvio;
      proximo: Destino;
    }
  | {
      tipo: "aguardar_resposta";
      prazo_minutos: number;
      /**
       * Uma saída por botão de resposta rápida do ÚLTIMO template enviado antes
       * deste bloco, pela chave do texto do botão (o que a Meta devolve no clique).
       */
      botoes: Record<string, Destino>;
      /** Resposta escrita que contém o texto (sem diferença de maiúscula e acento), na ordem. */
      palavras: Array<{ contem: string; proximo: Destino }>;
      /** Respondeu outra coisa (ou clicou num botão sem saída própria). */
      outra: Destino;
      /** O prazo venceu sem resposta. */
      sem_resposta: Destino;
    }
  | {
      tipo: "enviar_texto";
      /** Só sai com a janela de 24h aberta (o contato respondeu há menos de 24h). Aceita marcas do contato. */
      texto: string;
      proximo: Destino;
    }
  | { tipo: "esperar"; minutos: number; proximo: Destino }
  | { tipo: "mudar_tag"; acao: "adicionar" | "remover"; tagId: string; proximo: Destino }
  | { tipo: "mudar_segmento"; acao: "adicionar" | "remover"; segmentoId: string; proximo: Destino }
  | { tipo: "criar_oportunidade"; funilId: string; etapaId: string; nome: string; proximo: Destino }
  | {
      tipo: "mover_oportunidade";
      /** Move a oportunidade aberta mais recente do contato NESTE funil; sem nenhuma, segue em frente. */
      funilId: string;
      etapaId: string;
      proximo: Destino;
    }
  | { tipo: "registrar_conversao"; proximo: Destino }
  | {
      tipo: "avisar_equipe";
      /**
       * A instância uazapi que manda o WhatsApp à equipe (escolhida no bloco;
       * a compartilhada com o SprintHub não serve). Os avisos de um mesmo
       * destinatário saem AGRUPADOS a cada rodada do motor, nunca um por contato.
       */
      instanciaId: string;
      /** Quem da equipe recebe (só usuários ativos). */
      usuarioIds: string[];
      /** Também o responsável da oportunidade aberta do contato NESTE funil; null = não. */
      responsavelDoFunil: string | null;
      /** Texto do autor. O aviso leva o nome do contato e o link da conversa, nunca telefone, e-mail ou o que ele respondeu. */
      texto: string;
      proximo: Destino;
    }
  | { tipo: "ligar_ia"; iaId: string; proximo: Destino }
  // ── Blocos de 2026-10-28 (pedido dele: "crie mais blocos") ─────────────────
  | {
      tipo: "condicao";
      /** A pergunta sobre o contato, no instante em que ele chega ao bloco. */
      regra: RegraCondicao;
      sim: Destino;
      nao: Destino;
    }
  | {
      tipo: "horario";
      /** Dias em que passa, 0 = domingo … 6 = sábado, no fuso de Brasília. */
      dias: number[];
      /** "HH:MM". `ate` maior que `das`. Fora da janela, o contato espera a próxima abertura. */
      das: string;
      ate: string;
      proximo: Destino;
    }
  | {
      tipo: "enviar_arquivo";
      /** Arquivo da biblioteca de Documentos (imagem, PDF ou vídeo). Como o texto livre, só sai com a janela de 24h aberta. */
      documentoId: string;
      /** Legenda opcional; aceita marcas do contato. */
      legenda: string;
      proximo: Destino;
    }
  | {
      tipo: "limitar_passagem";
      /** Quantos contatos passam por janela ("permissão de passagem", pedido dele). */
      quantidade: number;
      /** O tamanho da janela, em segundos (1 s a 30 dias). Quem excede espera a vez, na ordem de chegada. */
      janela_segundos: number;
      proximo: Destino;
    }
  | {
      tipo: "alternar";
      /**
       * Os caminhos, em revezamento na ordem de chegada: o 1º contato vai pelo
       * primeiro, o 2º pelo segundo… e volta ao primeiro (pedido dele,
       * 2026-10-30: variar os templates de uma campanha). De 2 a 10.
       */
      saidas: Destino[];
    };

/** A pergunta do bloco Condição. */
export type RegraCondicao =
  | { tipo: "tem_tag"; tagId: string }
  | { tipo: "no_segmento"; segmentoId: string }
  /** A oportunidade aberta mais recente do contato NESTE funil está nesta etapa. */
  | { tipo: "na_etapa"; funilId: string; etapaId: string }
  /** Campo do contato (contatos.campos, a chave do campo personalizado). */
  | { tipo: "campo"; chave: string; operador: "preenchido" | "igual" | "contem"; valor: string };

export type TipoBloco = BlocoCampanha["tipo"];

export type FluxoCampanha = {
  versao: typeof VERSAO_FLUXO;
  /** O primeiro bloco depois da entrada; null = fluxo vazio. */
  inicio: Destino;
  blocos: Record<string, BlocoCampanha>;
  /** Posição de cada nó no canvas, inclusive o NO_INICIO. Só desenho. */
  posicoes: Record<string, Posicao>;
};

// ── Catálogo ────────────────────────────────────────────────────────────────

export type GrupoBloco = "mensagem" | "espera" | "controle" | "crm" | "equipe";

/** O que a tela mostra de cada tipo. As saídas do Aguardar dependem do template (saidasDe). */
export const CATALOGO_CAMPANHA: Record<TipoBloco, { rotulo: string; descricao: string; grupo: GrupoBloco }> = {
  enviar_template: { rotulo: "Enviar template", descricao: "Template aprovado, com variáveis do contato e botões.", grupo: "mensagem" },
  aguardar_resposta: { rotulo: "Aguardar resposta", descricao: "Segura até o contato responder ou o prazo vencer, e segue pelo botão que ele clicou.", grupo: "espera" },
  enviar_texto: { rotulo: "Enviar texto", descricao: "Mensagem livre — só depois que o contato respondeu (janela de 24h).", grupo: "mensagem" },
  esperar: { rotulo: "Esperar", descricao: "Pausa por um tempo antes do próximo bloco.", grupo: "espera" },
  mudar_tag: { rotulo: "Tag", descricao: "Adiciona ou tira uma tag do contato.", grupo: "crm" },
  mudar_segmento: { rotulo: "Segmento", descricao: "Põe ou tira o contato de um segmento.", grupo: "crm" },
  criar_oportunidade: { rotulo: "Criar oportunidade", descricao: "Abre um negócio em funil e etapa escolhidos.", grupo: "crm" },
  mover_oportunidade: { rotulo: "Mover oportunidade", descricao: "Leva a oportunidade aberta do contato para outra etapa.", grupo: "crm" },
  registrar_conversao: { rotulo: "Registrar conversão", descricao: "Conta o contato como resultado da campanha.", grupo: "crm" },
  avisar_equipe: { rotulo: "Avisar a equipe", descricao: "WhatsApp agrupado para alguém do time ou para o responsável.", grupo: "equipe" },
  ligar_ia: { rotulo: "Passar para a IA", descricao: "Liga a IA de atendimento no contato daqui em diante.", grupo: "equipe" },
  enviar_arquivo: { rotulo: "Enviar arquivo", descricao: "Imagem, PDF ou vídeo da biblioteca. Só depois que o contato respondeu.", grupo: "mensagem" },
  horario: { rotulo: "Horário de envio", descricao: "Só deixa passar nos dias e horas escolhidos.", grupo: "espera" },
  condicao: { rotulo: "Condição", descricao: "Divide o caminho por tag, segmento, etapa ou campo.", grupo: "controle" },
  limitar_passagem: { rotulo: "Permissão de passagem", descricao: "Deixa passar X contatos a cada intervalo.", grupo: "controle" },
  alternar: { rotulo: "Alternar", descricao: "Reveza os contatos entre caminhos, um de cada vez.", grupo: "controle" },
};

export const LIMITES_FLUXO = {
  blocos: 60,
  /** Blocos imediatos seguidos que o motor executa por contato numa rodada (trava contra laço). */
  passosPorRodada: 25,
  prazoMinimo: 5,
  prazoMaximo: 43_200,
  texto: 1000,
  palavras: 10,
  /** Permissão de passagem: de 1 a 10 mil contatos por janela, janela de 1 s a 30 dias. */
  passagemQuantidadeMaxima: 10_000,
  passagemJanelaMinima: 1,
  passagemJanelaMaxima: 2_592_000,
  /** Alternar: de 2 a 10 caminhos. */
  caminhosMinimo: 2,
  caminhosMaximo: 10,
} as const;

/** O nome de cada caminho do Alternar, na ordem: "Caminho A", "Caminho B"… */
export const rotuloDoCaminho = (i: number) => `Caminho ${String.fromCharCode(65 + i)}`;

/** Uma saída de bloco, como o canvas desenha (o id é o `sourceHandle` da ligação). */
export type SaidaBloco = { id: string; rotulo: string; destino: Destino };

/**
 * As saídas de um bloco, na ordem em que o canvas desenha. No Aguardar: uma
 * por botão (id "botao:<texto>"), uma por palavra ("palavra:<i>"), "outra" e
 * "sem_resposta"; no Alternar, uma por caminho ("caminho:<i>"); nos demais,
 * "proximo".
 */
export function saidasDe(b: BlocoCampanha): SaidaBloco[] {
  if (b.tipo === "condicao") {
    return [
      { id: "sim", rotulo: "Sim", destino: b.sim },
      { id: "nao", rotulo: "Não", destino: b.nao },
    ];
  }
  if (b.tipo === "alternar") return b.saidas.map((destino, i) => ({ id: `caminho:${i}`, rotulo: rotuloDoCaminho(i), destino }));
  if (b.tipo !== "aguardar_resposta") return [{ id: "proximo", rotulo: "", destino: b.proximo }];
  return [
    ...Object.entries(b.botoes).map(([texto, destino]) => ({ id: `botao:${texto}`, rotulo: texto, destino })),
    ...b.palavras.map((p, i) => ({ id: `palavra:${i}`, rotulo: `Contém “${p.contem}”`, destino: p.proximo })),
    { id: "outra", rotulo: "Outra resposta", destino: b.outra },
    { id: "sem_resposta", rotulo: "Sem resposta", destino: b.sem_resposta },
  ];
}

/** Liga a saída `saidaId` do bloco a `destino`, devolvendo o bloco novo (imutável). */
export function ligar(b: BlocoCampanha, saidaId: string, destino: Destino): BlocoCampanha {
  if (b.tipo === "condicao") {
    if (saidaId === "sim") return { ...b, sim: destino };
    if (saidaId === "nao") return { ...b, nao: destino };
    return b;
  }
  if (b.tipo === "alternar") {
    const i = saidaId.startsWith("caminho:") ? Number(saidaId.slice(8)) : -1;
    return i >= 0 && i < b.saidas.length ? { ...b, saidas: b.saidas.map((d, j) => (j === i ? destino : d)) } : b;
  }
  if (b.tipo !== "aguardar_resposta") return { ...b, proximo: destino };
  if (saidaId.startsWith("botao:")) return { ...b, botoes: { ...b.botoes, [saidaId.slice(6)]: destino } };
  if (saidaId.startsWith("palavra:")) {
    const i = Number(saidaId.slice(8));
    return { ...b, palavras: b.palavras.map((p, j) => (j === i ? { ...p, proximo: destino } : p)) };
  }
  if (saidaId === "outra") return { ...b, outra: destino };
  if (saidaId === "sem_resposta") return { ...b, sem_resposta: destino };
  return b;
}

// ── A resposta escolhe a saída ──────────────────────────────────────────────

/** Sem maiúscula, sem acento, espaços colapsados: "  SIM, Quero! " ≈ "sim, quero!". */
export function normalizarResposta(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Para onde vai quem respondeu. O clique num botão vale pelo texto do botão
 * (é o que a Meta devolve, em `button.text`); sem saída para aquele botão, ou
 * escrevendo, valem as palavras em ordem e, por fim, "outra".
 */
export function saidaDaResposta(
  b: Extract<BlocoCampanha, { tipo: "aguardar_resposta" }>,
  resposta: { texto: string; botao: string | null },
): { saidaId: string; destino: Destino } {
  if (resposta.botao) {
    const chave = Object.keys(b.botoes).find((t) => normalizarResposta(t) === normalizarResposta(resposta.botao!));
    if (chave !== undefined) return { saidaId: `botao:${chave}`, destino: b.botoes[chave] };
  }
  const texto = normalizarResposta(resposta.texto);
  const i = b.palavras.findIndex((p) => p.contem.trim() && texto.includes(normalizarResposta(p.contem)));
  if (i >= 0) return { saidaId: `palavra:${i}`, destino: b.palavras[i].proximo };
  return { saidaId: "outra", destino: b.outra };
}

/**
 * Mensagem que é só um pedido de descadastro: encerra o fluxo do contato antes
 * de escolher qualquer saída (a Meta cobra respeito ao opt-out, e seguir
 * mandando derruba a qualidade do número).
 */
const PALAVRAS_DE_SAIDA = new Set(["sair", "parar", "pare", "stop", "cancelar", "descadastrar", "nao quero mais"]);
export function ehDescadastro(texto: string): boolean {
  return PALAVRAS_DE_SAIDA.has(normalizarResposta(texto).replace(/[.!]+$/, ""));
}

// ── Permissão ───────────────────────────────────────────────────────────────

/**
 * Basta UMA das opções. O motor roda sem sessão, então a autoridade é a de
 * quem salva e de quem ativa: as duas pontas conferem isto (revisão de
 * segurança do desenho). Sem isso, quem só tem Campanhas moveria card de
 * colega, ligaria IA e avisaria a equipe com dado de lead.
 */
export type Exigencia = {
  motivo: string;
  /** Sem `operacao`, basta VER o módulo (lib/auth/permissoes.ts só tem criar, editar e excluir). */
  algumDe: Array<{ modulo: ChaveModulo; operacao?: Operacao; escopoTodos?: boolean }>;
};

export function exigenciasDoFluxo(f: FluxoCampanha): Exigencia[] {
  const tipos = new Set(Object.values(f.blocos).map((b) => b.tipo));
  const e: Exigencia[] = [];
  if (tipos.has("mover_oportunidade"))
    e.push({ motivo: "mover oportunidade", algumDe: [{ modulo: "inicio", operacao: "editar", escopoTodos: true }] });
  if (tipos.has("criar_oportunidade"))
    e.push({ motivo: "criar oportunidade", algumDe: [{ modulo: "inicio", operacao: "criar", escopoTodos: true }] });
  if (tipos.has("ligar_ia"))
    e.push({
      motivo: "passar para a IA",
      algumDe: [
        { modulo: "chat", operacao: "editar" },
        { modulo: "inicio", operacao: "editar" },
        { modulo: "contatos", operacao: "editar" },
      ],
    });
  if (tipos.has("mudar_tag") || tipos.has("mudar_segmento"))
    e.push({ motivo: "mudar tag ou segmento", algumDe: [{ modulo: "contatos", operacao: "editar" }, { modulo: "inicio", operacao: "editar" }] });
  if (tipos.has("avisar_equipe"))
    e.push({ motivo: "avisar a equipe", algumDe: [{ modulo: "contatos", operacao: "editar" }, { modulo: "inicio", operacao: "editar", escopoTodos: true }] });
  // Mandar um arquivo da biblioteca a quem responder: quem salva precisa ver a
  // biblioteca (a tela de Documentos pede só o módulo para ler e escolher).
  // A "Condição" só lê o contato: basta Campanhas.
  // O arquivo no cabeçalho do template (variaveis.midia) vem da mesma biblioteca.
  const comMidia = Object.values(f.blocos).some((b) => b.tipo === "enviar_template" && !!b.variaveis.midia);
  if (tipos.has("enviar_arquivo") || comMidia) e.push({ motivo: "enviar arquivo da biblioteca", algumDe: [{ modulo: "documentos" }] });
  return e;
}

// ── Validação ───────────────────────────────────────────────────────────────

/** O que o validador precisa saber dos templates aprovados: as respostas rápidas de cada um. */
export type TemplateDoFluxo = { nome: string; idioma: string; respostasRapidas: string[] };

export function templateDoFluxo(t: TemplateWhatsApp): TemplateDoFluxo {
  return { nome: t.nome, idioma: t.idioma, respostasRapidas: respostasRapidasDe(t) };
}

export type ProblemaDoFluxo = { blocoId: string | null; mensagem: string };

/**
 * O que impede salvar ou ativar, com o bloco a destacar. Confere a forma do
 * grafo (ligação para bloco que não existe, bloco solto, laço) e o mínimo de
 * cada bloco. O que depende do template (variáveis, botões de link) é de
 * problemaNoEnvio, em lib/templates-whatsapp.ts; o que depende do banco (tag,
 * funil, IA, usuário ativo existirem) e a forma bruta da entrada (tipos,
 * tamanhos) o servidor confere à parte. "Enviar texto (ou arquivo) depois de
 * uma resposta" aqui é só estrutural: a janela de 24h real o motor confere no
 * envio. A "Condição" segue as duas saídas.
 */
export function problemasDoFluxo(f: FluxoCampanha, templates: TemplateDoFluxo[]): ProblemaDoFluxo[] {
  const p: ProblemaDoFluxo[] = [];
  const ids = Object.keys(f.blocos);
  if (!ids.length || !f.inicio) return [{ blocoId: null, mensagem: "Ligue o início a um bloco de envio." }];
  if (ids.length > LIMITES_FLUXO.blocos) p.push({ blocoId: null, mensagem: `São até ${LIMITES_FLUXO.blocos} blocos.` });
  if (!f.blocos[f.inicio]) p.push({ blocoId: null, mensagem: "O início aponta para um bloco que não existe." });

  // Alcance a partir do início, e o último template visto em cada caminho.
  const alcancados = new Set<string>();
  const fila: Array<{ id: string; template: TemplateDoFluxo | null; respondeu: boolean }> = [];
  if (f.blocos[f.inicio]) fila.push({ id: f.inicio, template: null, respondeu: false });
  const vistos = new Set<string>();
  while (fila.length) {
    const { id, template, respondeu } = fila.shift()!;
    const chave = `${id}|${template?.nome ?? ""}|${respondeu}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    alcancados.add(id);
    const b = f.blocos[id];
    let tpl = template;
    if (b.tipo === "enviar_template") {
      tpl = templates.find((t) => t.nome === b.template_nome && t.idioma === b.template_idioma) ?? null;
    }
    if (b.tipo === "enviar_texto" && !respondeu)
      p.push({ blocoId: id, mensagem: "Enviar texto só depois de uma resposta." });
    if (b.tipo === "enviar_arquivo" && !respondeu) p.push({ blocoId: id, mensagem: "Enviar arquivo só depois de uma resposta." });
    if (b.tipo === "aguardar_resposta") {
      if (!tpl) p.push({ blocoId: id, mensagem: "Aguardar resposta precisa de um template enviado antes dele." });
      else {
        const sobrando = Object.keys(b.botoes).filter((t) => !tpl!.respostasRapidas.includes(t));
        if (sobrando.length) p.push({ blocoId: id, mensagem: `O template não tem o botão “${sobrando[0]}”.` });
      }
    }
    for (const s of saidasDe(b)) {
      if (s.destino === null) continue;
      if (!f.blocos[s.destino]) {
        p.push({ blocoId: id, mensagem: "Uma ligação aponta para um bloco que não existe." });
        continue;
      }
      const depoisDeResposta = b.tipo === "aguardar_resposta" ? s.id !== "sem_resposta" : respondeu;
      fila.push({ id: s.destino, template: tpl, respondeu: depoisDeResposta });
    }
  }
  for (const id of ids) if (!alcancados.has(id)) p.push({ blocoId: id, mensagem: "Bloco solto: nada chega até ele." });

  for (const [id, b] of Object.entries(f.blocos)) {
    const m = problemaDoBloco(b);
    if (m) p.push({ blocoId: id, mensagem: m });
  }
  const laco = blocoEmLaco(f);
  if (laco) p.push({ blocoId: laco, mensagem: "Este caminho volta para um bloco anterior. Monte a repetição em sequência." });
  return p;
}

function problemaDoBloco(b: BlocoCampanha): string | null {
  switch (b.tipo) {
    case "enviar_template":
      return b.template_nome ? null : "Escolha o template.";
    case "aguardar_resposta":
      if (b.prazo_minutos < LIMITES_FLUXO.prazoMinimo || b.prazo_minutos > LIMITES_FLUXO.prazoMaximo)
        return "O prazo vai de 5 minutos a 30 dias.";
      if (b.palavras.length > LIMITES_FLUXO.palavras) return `São até ${LIMITES_FLUXO.palavras} palavras.`;
      return b.palavras.some((x) => !x.contem.trim()) ? "Toda palavra precisa de um texto." : null;
    case "esperar":
      return b.minutos < LIMITES_FLUXO.prazoMinimo || b.minutos > LIMITES_FLUXO.prazoMaximo ? "A espera vai de 5 minutos a 30 dias." : null;
    case "enviar_texto":
      if (!b.texto.trim()) return "Escreva o texto.";
      return b.texto.length > LIMITES_FLUXO.texto ? `O texto tem até ${LIMITES_FLUXO.texto} caracteres.` : null;
    case "mudar_tag":
      return b.tagId ? null : "Escolha a tag.";
    case "mudar_segmento":
      return b.segmentoId ? null : "Escolha o segmento.";
    case "criar_oportunidade":
    case "mover_oportunidade":
      return b.funilId && b.etapaId ? null : "Escolha o funil e a etapa.";
    case "avisar_equipe":
      if (!b.instanciaId) return "Escolha o número que manda o aviso.";
      if (!b.usuarioIds.length && !b.responsavelDoFunil) return "Escolha quem recebe o aviso.";
      return b.texto.trim() ? null : "Escreva o aviso.";
    case "ligar_ia":
      return b.iaId ? null : "Escolha a IA.";
    case "registrar_conversao":
      return null;
    case "condicao":
      return problemaDaRegra(b.regra);
    case "horario": {
      // "Escolha ao menos um dia" é também o resumo vazio do bloco na tela. Dia
      // repetido ou fora de 0 (domingo) a 6 (sábado): a tela não mostra os números.
      if (!b.dias.length) return "Escolha ao menos um dia.";
      if (b.dias.some((d) => !Number.isInteger(d) || d < 0 || d > 6) || new Set(b.dias).size !== b.dias.length) return "Escolha os dias do horário.";
      const das = minutosDoHorario(b.das);
      const ate = minutosDoHorario(b.ate);
      if (das === null || ate === null) return "Os horários são no formato HH:MM.";
      return ate > das ? null : "O fim da janela tem de ser depois do começo.";
    }
    case "enviar_arquivo":
      if (!b.documentoId) return "Escolha o arquivo.";
      return b.legenda.length > LIMITES_FLUXO.texto ? `A legenda tem até ${LIMITES_FLUXO.texto} caracteres.` : null;
    case "limitar_passagem":
      if (!Number.isInteger(b.quantidade) || b.quantidade < 1 || b.quantidade > LIMITES_FLUXO.passagemQuantidadeMaxima)
        return "Passam de 1 a 10.000 contatos por intervalo.";
      if (
        !Number.isInteger(b.janela_segundos) ||
        b.janela_segundos < LIMITES_FLUXO.passagemJanelaMinima ||
        b.janela_segundos > LIMITES_FLUXO.passagemJanelaMaxima
      )
        return "O intervalo vai de 1 segundo a 30 dias.";
      return null;
    case "alternar":
      if (b.saidas.length < LIMITES_FLUXO.caminhosMinimo || b.saidas.length > LIMITES_FLUXO.caminhosMaximo)
        return `O Alternar tem de ${LIMITES_FLUXO.caminhosMinimo} a ${LIMITES_FLUXO.caminhosMaximo} caminhos.`;
      // Caminho solto encerraria o fluxo de uma parte dos contatos sem ninguém notar.
      return b.saidas.some((d) => d === null) ? "Ligue cada caminho do Alternar a um bloco." : null;
  }
}

function problemaDaRegra(r: RegraCondicao): string | null {
  switch (r.tipo) {
    case "tem_tag":
      return r.tagId ? null : "Escolha a tag da condição.";
    case "no_segmento":
      return r.segmentoId ? null : "Escolha o segmento da condição.";
    case "na_etapa":
      return r.funilId && r.etapaId ? null : "Escolha o funil e a etapa da condição.";
    case "campo":
      if (!r.chave) return "Escolha o campo do contato.";
      return r.operador === "preenchido" || r.valor.trim() ? null : "Escreva o valor que o campo deve ter.";
  }
}

/** "HH:MM" (00:00 a 23:59) em minutos do dia; null fora do formato. A validação e o motor leem por aqui. */
export function minutosDoHorario(hhmm: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Um bloco que fecha um ciclo, ou null. Qualquer ciclo, com ou sem espera (ver o cabeçalho). */
function blocoEmLaco(f: FluxoCampanha): string | null {
  const proximos = (id: string) => saidasDe(f.blocos[id]).map((s) => s.destino).filter((d): d is string => !!d && !!f.blocos[d]);
  const estado = new Map<string, 1 | 2>();
  const visitar = (id: string): string | null => {
    estado.set(id, 1);
    for (const d of proximos(id)) {
      if (estado.get(d) === 1) return d;
      if (!estado.get(d)) {
        const achado = visitar(d);
        if (achado) return achado;
      }
    }
    estado.set(id, 2);
    return null;
  };
  for (const id of Object.keys(f.blocos)) {
    if (estado.get(id)) continue;
    const achado = visitar(id);
    if (achado) return achado;
  }
  return null;
}

// ── Formato antigo ──────────────────────────────────────────────────────────

/** As ações do formato de antes (lib/campanhas-whatsapp.ts, AcaoCampanha). */
export type AcaoAntiga =
  | { tipo: "adicionar_tag"; tagId: string }
  | { tipo: "adicionar_segmento"; segmentoId: string }
  | { tipo: "criar_oportunidade"; funilId: string; etapaId: string; nome: string }
  | { tipo: "registrar_lead" };

/**
 * Os ids fixos dos blocos que a conversão cria. Execução antiga não tem
 * bloco_atual: o motor a põe pelo ESTADO — na fila ou enviando → ENVIO;
 * aguardando resposta → AGUARDAR (pôr no início reenviaria o template a todos
 * que já receberam); estado final → nada.
 */
export const ID_ENVIO_ANTIGO = "envio";
export const ID_AGUARDAR_ANTIGO = "aguardar";

/**
 * O formato fixo de antes (template → aguardar → respondeu / não respondeu →
 * ações) como fluxo. É o que permite às campanhas e rascunhos antigos seguirem
 * rodando e aparecerem no canvas novo sem migração de dados.
 */
export function fluxoDoFormatoAntigo(d: {
  template_nome: string;
  template_idioma: string;
  espera_minutos: number;
  variaveis: ValoresDoEnvio;
  ao_responder: AcaoAntiga[];
  ao_expirar: AcaoAntiga[];
}): FluxoCampanha {
  const blocos: Record<string, BlocoCampanha> = {};
  const posicoes: Record<string, Posicao> = { [NO_INICIO]: { x: 0, y: 160 } };
  const cadeia = (acoes: AcaoAntiga[], prefixo: string, y: number): Destino => {
    let primeiro: Destino = null;
    let anterior: string | null = null;
    acoes.forEach((a, i) => {
      const id = `${prefixo}${i + 1}`;
      blocos[id] =
        a.tipo === "adicionar_tag"
          ? { tipo: "mudar_tag", acao: "adicionar", tagId: a.tagId, proximo: null }
          : a.tipo === "adicionar_segmento"
            ? { tipo: "mudar_segmento", acao: "adicionar", segmentoId: a.segmentoId, proximo: null }
            : a.tipo === "criar_oportunidade"
              ? { tipo: "criar_oportunidade", funilId: a.funilId, etapaId: a.etapaId, nome: a.nome, proximo: null }
              : { tipo: "registrar_conversao", proximo: null };
      posicoes[id] = { x: 760 + i * 300, y };
      if (anterior) blocos[anterior] = ligar(blocos[anterior], "proximo", id);
      else primeiro = id;
      anterior = id;
    });
    return primeiro;
  };
  blocos[ID_ENVIO_ANTIGO] = { tipo: "enviar_template", template_nome: d.template_nome, template_idioma: d.template_idioma, variaveis: d.variaveis, proximo: ID_AGUARDAR_ANTIGO };
  posicoes[ID_ENVIO_ANTIGO] = { x: 240, y: 160 };
  const respondeu = cadeia(d.ao_responder, "respondeu", 20);
  const expirou = cadeia(d.ao_expirar, "expirou", 320);
  blocos[ID_AGUARDAR_ANTIGO] = { tipo: "aguardar_resposta", prazo_minutos: d.espera_minutos, botoes: {}, palavras: [], outra: respondeu, sem_resposta: expirou };
  posicoes[ID_AGUARDAR_ANTIGO] = { x: 500, y: 160 };
  return { versao: VERSAO_FLUXO, inicio: ID_ENVIO_ANTIGO, blocos, posicoes };
}

// ── Opções e consequências ──────────────────────────────────────────────────

export type OpcaoDaCampanha = { id: string; nome: string };

/**
 * O que, fora do próprio bloco, acontece quando ele roda (revisões de
 * 2026-10-28): mover para uma etapa com cadência manda WhatsApp pela uazapi a
 * quem chegar; etapa com evento manda conversão à Meta; pôr alguém num
 * segmento de outra campanha ativa o inscreve nela. A IA ecoa e o modal de
 * ativação mostra pela mesma lista, para as duas não divergirem.
 */
export type ContextoDasConsequencias = {
  /** Etapas cuja entrada inscreve numa cadência ativa. */
  etapasComCadencia: OpcaoDaCampanha[];
  /** Etapas que mandam evento à Meta (Conversions API). */
  etapasComEventoMeta: OpcaoDaCampanha[];
  /** Segmentos que inscrevem em outra campanha ativa. */
  segmentosEmCampanha: Array<{ segmentoId: string; campanha: string }>;
};

/**
 * Tudo o que os blocos escolhem, lido de um lugar só no servidor: a página
 * entrega à tela e a IA do construtor lê o mesmo (antes eram duas consultas
 * que já divergiam na ordem das etapas). Só id e nome, nunca contato, token
 * ou número.
 */
export type OpcoesDaCampanha = {
  tags: OpcaoDaCampanha[];
  segmentos: Array<OpcaoDaCampanha & { contatos: number }>;
  funis: OpcaoDaCampanha[];
  /** Na ordem das etapas dentro de cada funil. */
  etapas: Array<OpcaoDaCampanha & { funil_id: string }>;
  usuarios: OpcaoDaCampanha[];
  ias: OpcaoDaCampanha[];
  instancias: OpcaoDaCampanha[];
  /** Os arquivos da biblioteca que o "Enviar arquivo" manda: não arquivados, tipo "imagem", "pdf" ou "video". */
  documentos: Array<{ id: string; nome: string; tipo: string }>;
  /** Os campos personalizados do contato (campos_personalizados, entidade contato), para a "Condição" por campo. */
  camposContato: Array<{ chave: string; rotulo: string }>;
  consequencias: ContextoDasConsequencias;
};

// ── Desenho da IA ───────────────────────────────────────────────────────────

/** O `t` do evento NDJSON que leva o desenho da IA para a tela (lib/ia/conversa.ts, eventosFinais). */
export const EVENTO_DESENHO = "fluxo";

/**
 * O que a IA do construtor manda para a tela (pedido dele, 2026-10-28: "falo o
 * nome do template e a IA monta como quero, via chat"): o fluxo inteiro, já
 * conferido na forma pelo servidor e sem posições, porque quem organiza o
 * desenho é a tela. Não foi gravado em lugar nenhum: substitui o canvas, e a
 * pessoa revisa antes de ativar ou salvar, que conferem tudo de novo.
 */
export type DesenhoDaIa = {
  fluxo: FluxoCampanha;
  /** Nome sugerido para a campanha; null mantém o da tela. */
  nome: string | null;
  /** O público, só em campanha nova; null mantém o que a tela tem. */
  segmentoIds: string[] | null;
  /**
   * A campanha em edição a que o desenho responde (null = campanha nova). A
   * tela só aplica no editor da mesma campanha: resposta atrasada não cai em
   * outra, onde um "Salvar" gravaria o desenho errado.
   */
  campanhaId: string | null;
};

/**
 * Bloco que mudou de tipo ao editar uma campanha que já rodou. O motor guarda
 * o estado de cada contato pelo id do bloco (bloco_atual, envio já feito,
 * espera já começada): reaproveitar o id com outro tipo faria quem está ali
 * executar o bloco novo na hora, ou pular um envio ou uma espera (revisão de
 * segurança, 2026-10-28). A tela nunca reaproveita id; quem pode é a IA, que
 * reescreve o fluxo inteiro, ou um PUT montado à mão.
 */
export function blocosQueMudaramDeTipo(antes: FluxoCampanha, depois: FluxoCampanha): ProblemaDoFluxo[] {
  return Object.entries(depois.blocos)
    .filter(([id, b]) => Object.hasOwn(antes.blocos, id) && antes.blocos[id].tipo !== b.tipo)
    .map(([id]) => ({ blocoId: id, mensagem: "Não dá para trocar o tipo de um bloco em uso. Apague e crie outro." }));
}

/** O primeiro template do fluxo, pelo início: vai nas colunas template_nome/idioma da campanha (listas e relatórios). */
export function primeiroTemplate(f: FluxoCampanha): { template_nome: string; template_idioma: string } | null {
  const vistos = new Set<string>();
  let id = f.inicio;
  while (id && f.blocos[id] && !vistos.has(id)) {
    vistos.add(id);
    const b = f.blocos[id];
    if (b.tipo === "enviar_template") return { template_nome: b.template_nome, template_idioma: b.template_idioma };
    id = saidasDe(b)[0]?.destino ?? null;
  }
  return null;
}
