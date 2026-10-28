// O que a TELA faz com o fluxo de uma campanha de WhatsApp oficial. O formato,
// o catálogo, as saídas e a validação são do contrato (lib/campanhas-fluxo.ts);
// aqui fica só a edição: bloco novo com valores de partida, apagar e ligar no
// canvas, as saídas de botão do "Aguardar resposta" acompanhando o template de
// antes, organizar o desenho, ler o desenho que a IA manda, os problemas que a
// tela mostra e a revisão que se lê antes de ativar. Sem React e sem rede.
import { duracaoEmTexto } from "@/lib/automacoes/cadencia";
import {
  CATALOGO_CAMPANHA,
  NO_INICIO,
  VERSAO_FLUXO,
  ligar,
  problemasDoFluxo,
  saidasDe,
  templateDoFluxo,
  type BlocoCampanha,
  type DesenhoDaIa,
  type Destino,
  type FluxoCampanha,
  type OpcaoDaCampanha,
  type OpcoesDaCampanha,
  type Posicao,
  type ProblemaDoFluxo,
  type TipoBloco,
} from "@/lib/campanhas-fluxo";
import { consequenciasDoFluxo, problemasDosEnvios } from "@/lib/campanhas-fluxo-envios";
import {
  IDIOMA_PADRAO,
  respostasRapidasDe,
  textoParaRevisao,
  valoresIniciais,
  type ConteudoTemplate,
  type TemplateWhatsApp,
  type ValoresDoEnvio,
} from "@/lib/templates-whatsapp";

export type Opcao = OpcaoDaCampanha;

/**
 * O que os blocos escolhem: o tipo do contrato (lib/campanhas-fluxo.ts), lido
 * de um lugar só no servidor e entregue pela page.tsx — o mesmo que a IA lê.
 */
export type OpcoesFluxo = OpcoesDaCampanha;

/** Os números da campanha no ar, como o GET devolve. A chave de porSaida é `${blocoId}|${saidaId}`. */
export type MetricasFluxo = {
  porBloco: Record<string, { agora: number; passaram: number }>;
  porSaida: Record<string, number>;
};

const nomeDe = (lista: Opcao[], id: string | null) => (id ? lista.find((o) => o.id === id)?.nome : undefined);

/** "1 contato", "1.250 contatos". */
export const quantosContatos = (n: number) => `${n.toLocaleString("pt-BR")} ${n === 1 ? "contato" : "contatos"}`;

export function acharTemplate(templates: TemplateWhatsApp[], nome: string, idioma: string): TemplateWhatsApp | null {
  return templates.find((t) => t.nome === nome && t.idioma === idioma) ?? null;
}

// ── Bloco novo ──────────────────────────────────────────────────────────────

export function idNovo(f: FluxoCampanha): string {
  let id = "";
  do {
    id = `b_${crypto.randomUUID().slice(0, 8)}`;
  } while (f.blocos[id]);
  return id;
}

/**
 * O bloco como nasce da paleta: o que pede escolha nasce vazio (o painel
 * aponta), menos o que só tem uma opção possível. O template nasce vazio de
 * propósito — nascer no primeiro da lista seria mandar o template errado por
 * esquecimento.
 */
export function blocoNovo(tipo: TipoBloco, o: OpcoesFluxo): BlocoCampanha {
  switch (tipo) {
    case "enviar_template":
      return { tipo, template_nome: "", template_idioma: IDIOMA_PADRAO, variaveis: { cabecalho: [], corpo: [] }, proximo: null };
    case "aguardar_resposta":
      return { tipo, prazo_minutos: 1440, botoes: {}, palavras: [], outra: null, sem_resposta: null };
    case "enviar_texto":
      return { tipo, texto: "", proximo: null };
    case "esperar":
      return { tipo, minutos: 1440, proximo: null };
    case "mudar_tag":
      return { tipo, acao: "adicionar", tagId: "", proximo: null };
    case "mudar_segmento":
      return { tipo, acao: "adicionar", segmentoId: "", proximo: null };
    case "criar_oportunidade":
      return { tipo, funilId: "", etapaId: "", nome: "Oportunidade · {{nome}}", proximo: null };
    case "mover_oportunidade":
      return { tipo, funilId: "", etapaId: "", proximo: null };
    case "registrar_conversao":
      return { tipo, proximo: null };
    case "avisar_equipe":
      return { tipo, instanciaId: o.instancias.length === 1 ? o.instancias[0].id : "", usuarioIds: [], responsavelDoFunil: null, texto: "", proximo: null };
    case "ligar_ia":
      return { tipo, iaId: o.ias.length === 1 ? o.ias[0].id : "", proximo: null };
  }
}

/** A campanha nova: início → primeiro template aprovado → aguardar resposta, com os botões dele. */
export function fluxoInicial(templates: TemplateWhatsApp[]): FluxoCampanha {
  const t = templates.find((x) => x.status === "APPROVED") ?? null;
  const envio = "b_envio";
  const aguardar = "b_aguardar";
  return organizarFluxo({
    versao: VERSAO_FLUXO,
    inicio: envio,
    blocos: {
      [envio]: {
        tipo: "enviar_template",
        template_nome: t?.nome ?? "",
        template_idioma: t?.idioma ?? IDIOMA_PADRAO,
        variaveis: t ? valoresIniciais(t) : { cabecalho: [], corpo: [] },
        proximo: aguardar,
      },
      [aguardar]: {
        tipo: "aguardar_resposta",
        prazo_minutos: 1440,
        botoes: Object.fromEntries((t ? respostasRapidasDe(t) : []).map((b) => [b, null])),
        palavras: [],
        outra: null,
        sem_resposta: null,
      },
    },
    posicoes: {},
  });
}

// ── Ligar e apagar ──────────────────────────────────────────────────────────

/** Liga uma saída (ou o início) a um destino; null desliga. Uma saída tem um destino só: ligar de novo troca. */
export function ligarSaida(f: FluxoCampanha, origem: string, saidaId: string, destino: Destino): FluxoCampanha {
  if (origem === NO_INICIO) return { ...f, inicio: destino };
  const b = f.blocos[origem];
  return b ? { ...f, blocos: { ...f.blocos, [origem]: ligar(b, saidaId, destino) } } : f;
}

/**
 * Ligar origem → destino fecharia um laço: do destino já se chega à origem. O
 * contrato proíbe qualquer laço (ver o cabeçalho de lib/campanhas-fluxo.ts); a
 * tela barra na hora de ligar, em vez de só reclamar depois.
 */
export function fechaLaco(f: FluxoCampanha, origem: string, destino: string): boolean {
  if (origem === destino) return true;
  const vistos = new Set<string>();
  const fila = [destino];
  while (fila.length) {
    const id = fila.pop()!;
    if (id === origem) return true;
    const b = f.blocos[id];
    if (!b || vistos.has(id)) continue;
    vistos.add(id);
    for (const s of saidasDe(b)) if (s.destino) fila.push(s.destino);
  }
  return false;
}

/** Tira o bloco e solta as ligações que chegavam nele (o início também). */
export function apagarBloco(f: FluxoCampanha, id: string): FluxoCampanha {
  const blocos: Record<string, BlocoCampanha> = {};
  for (const [outro, b] of Object.entries(f.blocos)) {
    if (outro === id) continue;
    let solto = b;
    for (const s of saidasDe(b)) if (s.destino === id) solto = ligar(solto, s.id, null);
    blocos[outro] = solto;
  }
  const posicoes = { ...f.posicoes };
  delete posicoes[id];
  return { ...f, inicio: f.inicio === id ? null : f.inicio, blocos, posicoes };
}

/**
 * As saídas de botão de cada "Aguardar resposta" seguem as respostas rápidas
 * do template enviado antes dele: trocou o template, os botões trocam, e os
 * que continuam mantêm a ligação. Só mexe quando todos os caminhos até o
 * Aguardar trazem o MESMO template e ele está na conta; sem template antes, ou
 * com dois diferentes, deixa como está e a validação aponta.
 */
export function sincronizarBotoes(f: FluxoCampanha, templates: TemplateWhatsApp[]): FluxoCampanha {
  const anteriores = new Map<string, string[]>();
  for (const [id, b] of Object.entries(f.blocos))
    for (const s of saidasDe(b)) if (s.destino) anteriores.set(s.destino, [...(anteriores.get(s.destino) ?? []), id]);

  let blocos = f.blocos;
  for (const [id, b] of Object.entries(f.blocos)) {
    if (b.tipo !== "aguardar_resposta") continue;
    const achados = new Set<TemplateWhatsApp | null>();
    const vistos = new Set<string>([id]);
    const fila = [...(anteriores.get(id) ?? [])];
    while (fila.length) {
      const atual = fila.pop()!;
      if (vistos.has(atual)) continue;
      vistos.add(atual);
      const a = f.blocos[atual];
      if (a?.tipo === "enviar_template") achados.add(acharTemplate(templates, a.template_nome, a.template_idioma));
      else fila.push(...(anteriores.get(atual) ?? []));
    }
    const [t] = achados;
    if (achados.size !== 1 || !t) continue;
    const textos = respostasRapidasDe(t);
    const atuais = Object.keys(b.botoes);
    if (textos.length === atuais.length && textos.every((x, i) => x === atuais[i])) continue;
    blocos = { ...blocos, [id]: { ...b, botoes: Object.fromEntries(textos.map((x) => [x, b.botoes[x] ?? null])) } };
  }
  return blocos === f.blocos ? f : { ...f, blocos };
}

// ── Organizar ───────────────────────────────────────────────────────────────

// As medidas dos cartões de no-campanha.tsx (medidas no Chrome em 2026-10-28,
// sem a faixa de números da campanha que já rodou). A entrada e a saída única
// ficam na altura do título; no Aguardar, cada saída é uma linha de 28px
// embaixo da cabeça, e "Sem resposta" vem 5px abaixo, depois do tracejado.
// A estimada é o teto (resumo em duas linhas, balão no máximo do corte): o
// canvas mede e reorganiza com a altura real logo depois.
/** A entrada e a saída única do cartão (no-campanha.tsx desenha as alças aqui). */
export const ALCA_DO_TITULO = 24;
const ALTURA_DO_INICIO = 74;
const ALTURA_DO_CARTAO = 72;
/** Cabeçalho, 4 linhas de corpo, rodapé e duas fileiras de botões. */
const ALTURA_DO_BALAO = 162;
/** O texto livre não tem resumo: só a cabeça curta e o balão de 4 linhas. */
const ALTURA_DO_TEXTO = 64;
const CABECA_DO_AGUARDAR = 56;
const LINHA_DE_SAIDA = 28;

/** Do começo de uma camada ao da próxima: o cartão (256) e o vão por onde as curvas passam. */
export const COLUNA = 352;
const VAO = 40;
/** O que separa o fluxo dos blocos soltos, que vão embaixo. */
const VAO_DOS_SOLTOS = 120;

/** A altura de um cartão sem medir: o Aguardar cresce com as saídas, o template com o balão. */
export function alturaEstimada(b: BlocoCampanha): number {
  if (b.tipo === "enviar_template") return ALTURA_DO_CARTAO + ALTURA_DO_BALAO;
  if (b.tipo === "enviar_texto") return ALTURA_DO_CARTAO + ALTURA_DO_TEXTO;
  if (b.tipo === "aguardar_resposta") return CABECA_DO_AGUARDAR + saidasDe(b).length * LINHA_DE_SAIDA + 14;
  return ALTURA_DO_CARTAO;
}

/** Onde sai a ligação `i` do cartão, contando do topo. */
function alturaDaSaida(b: BlocoCampanha, i: number): number {
  if (b.tipo !== "aguardar_resposta") return ALCA_DO_TITULO;
  const ultima = i === saidasDe(b).length - 1; // "Sem resposta", depois do tracejado
  return CABECA_DO_AGUARDAR + 5 + i * LINHA_DE_SAIDA + LINHA_DE_SAIDA / 2 + (ultima ? 5 : 0);
}

/**
 * O fluxo com o desenho refeito, da esquerda para a direita: cada bloco numa
 * camada pela MAIOR distância desde o início (com a menor, um bloco que se
 * alcança por dois caminhos de tamanhos diferentes ficaria na mesma coluna de
 * um dos pais, e a ligação voltaria para trás). Dentro da camada, cada bloco
 * quer ficar na altura da saída que chega nele, na ordem das saídas do pai, e
 * desce só o que precisa para não encostar no de cima — um caminho único sai
 * reto, e as saídas do Aguardar se abrem em leque sem cruzar à toa.
 *
 * `alturas` são as medidas reais dos cartões (o canvas mede); o que falta sai
 * de alturaEstimada. Bloco que nada alcança vai embaixo, com o mesmo arranjo
 * entre os soltos. Ligação que fecharia laço (o contrato proíbe, mas o
 * desenho não pode travar por isso) não conta para as camadas.
 */
export function organizarFluxo(f: FluxoCampanha, alturas: Record<string, number> = {}): FluxoCampanha {
  // Object.hasOwn: id vindo de fora não acha propriedade do Object.prototype.
  const existe = (id: Destino): id is string => !!id && Object.hasOwn(f.blocos, id);
  const altura = (id: string) => alturas[id] ?? (id === NO_INICIO ? ALTURA_DO_INICIO : alturaEstimada(f.blocos[id]));
  const saidas = (id: string): Array<{ destino: string; y: number }> => {
    if (id === NO_INICIO) return existe(f.inicio) ? [{ destino: f.inicio, y: ALCA_DO_TITULO }] : [];
    const b = f.blocos[id];
    return saidasDe(b).flatMap((s, i) => (existe(s.destino) ? [{ destino: s.destino, y: alturaDaSaida(b, i) }] : []));
  };
  const posicoes: Record<string, Posicao> = {};

  // Põe em camadas o que se alcança de `raizes` e ainda não tem lugar, a
  // partir de `topo`; devolve onde termina o mais baixo.
  function dispor(raizes: string[], camadaDasRaizes: number, topo: number): number {
    // Ordem topológica (todo pai antes dos filhos) pelo pós-ordem invertido.
    // Visitar de trás para a frente deixa raízes e irmãos na ordem dada, que
    // é o desempate dentro da camada.
    const ordem: string[] = [];
    const vistos = new Set<string>();
    const visitar = (id: string) => {
      vistos.add(id);
      for (const s of saidas(id).reverse()) if (!vistos.has(s.destino) && !posicoes[s.destino]) visitar(s.destino);
      ordem.push(id);
    };
    for (const r of [...raizes].reverse()) if (!vistos.has(r)) visitar(r);
    ordem.reverse();

    const indice = new Map(ordem.map((id, i) => [id, i]));
    const camada = new Map(raizes.map((r) => [r, camadaDasRaizes]));
    const chegadas = new Map<string, Array<{ de: string; y: number }>>();
    for (const id of ordem) {
      for (const s of saidas(id)) {
        const j = indice.get(s.destino);
        if (j === undefined || j <= indice.get(id)!) continue; // já tem lugar, ou voltaria (laço)
        camada.set(s.destino, Math.max(camada.get(s.destino) ?? 0, camada.get(id)! + 1));
        chegadas.set(s.destino, [...(chegadas.get(s.destino) ?? []), { de: id, y: s.y }]);
      }
    }

    const porCamada = new Map<number, string[]>();
    for (const id of ordem) porCamada.set(camada.get(id)!, [...(porCamada.get(camada.get(id)!) ?? []), id]);
    let fundo = topo;
    for (const c of [...porCamada.keys()].sort((a, b) => a - b)) {
      const querem = porCamada.get(c)!.map((id, i) => {
        const ys = (chegadas.get(id) ?? []).map((ch) => posicoes[ch.de].y + ch.y - ALCA_DO_TITULO);
        return { id, quer: ys.length ? Math.min(...ys) : topo, i };
      });
      let livre = topo;
      for (const { id, quer } of querem.sort((a, b) => a.quer - b.quer || a.i - b.i)) {
        const y = Math.max(quer, livre);
        posicoes[id] = { x: c * COLUNA, y: Math.round(y) };
        livre = y + altura(id) + VAO;
        fundo = Math.max(fundo, y + altura(id));
      }
    }
    return fundo;
  }

  let topo = dispor([NO_INICIO], 0, 0) + VAO_DOS_SOLTOS;
  const semLugar = () => Object.keys(f.blocos).filter((id) => !posicoes[id]);
  for (let soltos = semLugar(); soltos.length; soltos = semLugar()) {
    const apontados = new Set(soltos.flatMap((id) => saidas(id).map((s) => s.destino)));
    const raizes = soltos.filter((id) => !apontados.has(id));
    // Sem raiz, só sobrou laço entre soltos: qualquer um serve de começo.
    topo = dispor(raizes.length ? raizes : soltos.slice(0, 1), 1, topo) + VAO_DOS_SOLTOS;
  }
  return { ...f, posicoes };
}

// ── Desenho da IA ───────────────────────────────────────────────────────────

/**
 * O evento EVENTO_DESENHO como chegou do stream, conferido na forma mínima
 * antes de tocar no canvas: versão, `blocos` objeto com tipos do catálogo
 * (tipo desconhecido derrubaria o cartão) e `inicio`. O conteúdo de cada bloco
 * o servidor já conferiu (lib/campanhas-fluxo-entrada.ts); null = ignorar. O
 * fluxo volta sem posições: quem desenha é organizarFluxo.
 */
export function lerDesenhoDaIa(v: unknown): DesenhoDaIa | null {
  if (!v || typeof v !== "object") return null;
  const d = v as Record<string, unknown>;
  const f = d.fluxo as Record<string, unknown> | null | undefined;
  if (!f || typeof f !== "object" || f.versao !== VERSAO_FLUXO) return null;
  const blocos = f.blocos;
  if (!blocos || typeof blocos !== "object" || Array.isArray(blocos)) return null;
  const tipoConhecido = (b: unknown) => !!b && typeof b === "object" && Object.hasOwn(CATALOGO_CAMPANHA, String((b as { tipo?: unknown }).tipo));
  if (!Object.values(blocos).every(tipoConhecido)) return null;
  if (f.inicio !== null && typeof f.inicio !== "string") return null;
  return {
    fluxo: { versao: VERSAO_FLUXO, inicio: f.inicio, blocos: blocos as Record<string, BlocoCampanha>, posicoes: {} },
    nome: typeof d.nome === "string" && d.nome.trim() ? d.nome.trim() : null,
    segmentoIds: Array.isArray(d.segmentoIds) ? d.segmentoIds.filter((x): x is string => typeof x === "string") : null,
    campanhaId: typeof d.campanhaId === "string" && d.campanhaId ? d.campanhaId : null,
  };
}

// ── Problemas ───────────────────────────────────────────────────────────────

/**
 * Tudo o que impede ativar, como a tela mostra: as MESMAS regras que o
 * servidor confere ao salvar e ao ativar (conferirFluxo) — a forma do fluxo
 * (problemasDoFluxo, com os templates aprovados, como lá) e cada envio contra
 * os templates da conta (problemasDosEnvios, lib/campanhas-fluxo-envios.ts).
 * Até 2026-10-28 a tela tinha a própria cópia das regras do envio, que já
 * divergia. Só o banco (tag apagada, IA desligada) fica para o servidor, que
 * aponta na volta. A mesma frase duas vezes no mesmo bloco — dois caminhos
 * chegando nele — é uma pendência só.
 */
export function problemasDaTela(f: FluxoCampanha, templates: TemplateWhatsApp[]): ProblemaDoFluxo[] {
  const aprovados = templates.filter((t) => t.status === "APPROVED");
  const p = [...problemasDoFluxo(f, aprovados.map(templateDoFluxo)), ...problemasDosEnvios(f, templates)];
  const vistas = new Set<string>();
  return p.filter((x) => {
    const chave = `${x.blocoId}|${x.mensagem}`;
    if (vistas.has(chave)) return false;
    vistas.add(chave);
    return true;
  });
}

// ── O que a tela escreve sobre cada bloco ───────────────────────────────────

/**
 * Um texto livre como a campanha vai mandar, com cada marca virando
 * "[Primeiro nome do contato]". A troca é a mesma de textoParaRevisao: o texto
 * entra como o valor da {{1}} de um corpo que é só ela — uma regra só para o
 * template e para o texto livre.
 */
export function revisaoDoTexto(texto: string): string {
  if (!texto.trim()) return "";
  return textoParaRevisao(
    { cabecalho: null, corpo: "{{1}}", rodape: null, botoes: [], exemplosCabecalho: [], exemplosCorpo: [] },
    { cabecalho: [], corpo: [texto] },
  );
}

/** A mensagem em partes, como o cartão do canvas desenha o balão do WhatsApp. */
export type BalaoDaMensagem = {
  /** O formato da mídia do cabeçalho (IMAGE, VIDEO…), quando não é texto. */
  midia: string | null;
  cabecalho: string | null;
  corpo: string;
  rodape: string | null;
  botoes: Array<{ tipo: string; texto: string }>;
};

/**
 * O template como sai, em partes: cabeçalho e corpo com as variáveis trocadas
 * pela MESMA regra da revisão (textoParaRevisao, cada parte como o corpo de um
 * template que é só ela), o rodapé e os botões com o tipo, para o ícone.
 */
export function balaoDoTemplate(t: ConteudoTemplate, v: ValoresDoEnvio): BalaoDaMensagem {
  const trocado = (texto: string, valores: string[]) =>
    textoParaRevisao(
      { cabecalho: null, corpo: texto, rodape: null, botoes: [], exemplosCabecalho: [], exemplosCorpo: [] },
      { cabecalho: [], corpo: valores },
    );
  return {
    midia: t.cabecalho && t.cabecalho.formato !== "TEXT" ? t.cabecalho.formato : null,
    cabecalho: t.cabecalho?.formato === "TEXT" && t.cabecalho.texto ? trocado(t.cabecalho.texto, v.cabecalho) : null,
    corpo: trocado(t.corpo, v.corpo),
    rodape: t.rodape?.trim() || null,
    botoes: t.botoes.filter((b) => b.texto.trim()).map((b) => ({ tipo: b.tipo, texto: b.texto })),
  };
}

function etapaLegivel(o: OpcoesFluxo, funilId: string, etapaId: string): string | null {
  if (!funilId || !etapaId) return null;
  return `${nomeDe(o.funis, funilId) ?? "funil removido"} › ${nomeDe(o.etapas, etapaId) ?? "etapa removida"}`;
}

function destinatarios(b: Extract<BlocoCampanha, { tipo: "avisar_equipe" }>, o: OpcoesFluxo): string {
  const nomes = b.usuarioIds.map((id) => nomeDe(o.usuarios, id) ?? "usuário removido");
  if (b.responsavelDoFunil) nomes.push(`responsável em ${nomeDe(o.funis, b.responsavelDoFunil) ?? "funil removido"}`);
  return nomes.join(", ");
}

/** Uma linha do que o bloco faz, para o cartão do canvas e as listas. */
export function resumoDoBloco(b: BlocoCampanha, o: OpcoesFluxo): string {
  switch (b.tipo) {
    case "enviar_template":
      return b.template_nome || "Escolha o template";
    case "aguardar_resposta":
      return `Até ${duracaoEmTexto(b.prazo_minutos)}`;
    case "enviar_texto":
      return revisaoDoTexto(b.texto) || "Escreva o texto";
    case "esperar":
      return duracaoEmTexto(b.minutos);
    case "mudar_tag": {
      if (!b.tagId) return "Escolha a tag";
      return `${b.acao === "adicionar" ? "Adiciona" : "Tira"} “${nomeDe(o.tags, b.tagId) ?? "tag removida"}”`;
    }
    case "mudar_segmento": {
      if (!b.segmentoId) return "Escolha o segmento";
      return `${b.acao === "adicionar" ? "Põe em" : "Tira de"} “${nomeDe(o.segmentos, b.segmentoId) ?? "segmento removido"}”`;
    }
    case "criar_oportunidade":
    case "mover_oportunidade":
      return etapaLegivel(o, b.funilId, b.etapaId) ?? "Escolha o funil e a etapa";
    case "registrar_conversao":
      return "Conta como resultado da campanha";
    case "avisar_equipe":
      return destinatarios(b, o) || "Escolha quem recebe";
    case "ligar_ia":
      return b.iaId ? (nomeDe(o.ias, b.iaId) ?? "IA removida") : "Escolha a IA";
  }
}

/** O nome do bloco nas listas de destino: o tipo e o resumo, curto. */
export function rotuloDoBloco(b: BlocoCampanha, o: OpcoesFluxo): string {
  const texto = `${CATALOGO_CAMPANHA[b.tipo].rotulo} · ${resumoDoBloco(b, o)}`;
  return texto.length > 64 ? `${texto.slice(0, 63)}…` : texto;
}

/** Os blocos na ordem em que o contato chega neles, a partir do início. */
export function blocosEmOrdem(f: FluxoCampanha): string[] {
  const ordem: string[] = [];
  const fila = f.inicio ? [f.inicio] : [];
  while (fila.length) {
    const id = fila.shift()!;
    const b = f.blocos[id];
    if (!b || ordem.includes(id)) continue;
    ordem.push(id);
    for (const s of saidasDe(b)) if (s.destino) fila.push(s.destino);
  }
  return ordem;
}

// ── Revisão antes de ativar ─────────────────────────────────────────────────

export type MensagemDaRevisao = { blocoId: string; tipo: "enviar_template" | "enviar_texto"; titulo: string; texto: string };
/** `consequencias`: o que o bloco causa fora dele (cadência da etapa, evento da Meta, outra campanha). */
export type EfeitoDaRevisao = { blocoId: string; tipo: TipoBloco; texto: string; consequencias: string[] };

/**
 * Tudo o que o fluxo pode mandar e fazer, na ordem em que o contato chega:
 * cada template como sai (textoParaRevisao: variáveis trocadas e os botões no
 * fim, com o link completo), cada texto livre, e os efeitos no CRM e na
 * equipe, cada um com o que causa fora do bloco (consequenciasDoFluxo, as
 * mesmas frases que a IA do construtor ecoa: mover para uma etapa com cadência
 * manda WhatsApp pela uazapi, etapa com evento manda conversão à Meta). É o que
 * se lê antes de ativar — o clique de ativar não pode ser às cegas, ainda mais
 * num rascunho que a IA montou.
 */
export function revisaoDoFluxo(
  f: FluxoCampanha,
  templates: TemplateWhatsApp[],
  o: OpcoesFluxo,
): { mensagens: MensagemDaRevisao[]; efeitos: EfeitoDaRevisao[] } {
  const mensagens: MensagemDaRevisao[] = [];
  const efeitos: EfeitoDaRevisao[] = [];
  const consequencias = new Map<string, string[]>();
  for (const c of consequenciasDoFluxo(f, o.consequencias)) consequencias.set(c.blocoId, [...(consequencias.get(c.blocoId) ?? []), c.texto]);
  for (const id of blocosEmOrdem(f)) {
    const b = f.blocos[id];
    const efeito = (texto: string) => efeitos.push({ blocoId: id, tipo: b.tipo, texto, consequencias: consequencias.get(id) ?? [] });
    switch (b.tipo) {
      case "enviar_template": {
        const t = acharTemplate(templates, b.template_nome, b.template_idioma);
        mensagens.push({
          blocoId: id,
          tipo: b.tipo,
          titulo: `Template ${b.template_nome}`,
          texto: t ? textoParaRevisao(t, b.variaveis) : "Template não encontrado nesta conta.",
        });
        break;
      }
      case "enviar_texto":
        mensagens.push({ blocoId: id, tipo: b.tipo, titulo: "Texto livre (só com a janela de 24 h aberta)", texto: revisaoDoTexto(b.texto) });
        break;
      case "mudar_tag":
      case "mudar_segmento":
      case "registrar_conversao":
      case "ligar_ia":
        efeito(`${CATALOGO_CAMPANHA[b.tipo].rotulo}: ${resumoDoBloco(b, o)}`);
        break;
      case "criar_oportunidade":
        efeito(`Cria “${b.nome.replaceAll("{{nome}}", "[Nome do contato]")}” em ${resumoDoBloco(b, o)}`);
        break;
      case "mover_oportunidade":
        efeito(`Move a oportunidade aberta para ${resumoDoBloco(b, o)}`);
        break;
      case "avisar_equipe":
        efeito(`Avisa ${destinatarios(b, o)} pelo número ${nomeDe(o.instancias, b.instanciaId) ?? "removido"}: “${b.texto.trim()}”`);
        break;
      case "aguardar_resposta":
      case "esperar":
        break;
    }
  }
  return { mensagens, efeitos };
}
