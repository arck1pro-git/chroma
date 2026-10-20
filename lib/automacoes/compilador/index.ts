// Compilador: DefinicaoFluxo (CRM) → workflow do motor.
//
// PURO. Sem I/O, sem Date.now(), sem banco — tudo que precisa entra por `ctx`.
// Isso é o que torna o compilado determinístico: mesma entrada, mesmo hash, e
// por isso dá para detectar que alguém editou o workflow direto no n8n.
//
// Este arquivo não conhece o formato do n8n. Ele monta uma árvore neutra e
// delega a tradução ao motor — todo conhecimento do JSON do n8n vive em
// lib/automacoes/motores/n8n/.

import { blocoPorTipo } from "../catalogo";
import { NO_ENTRADA, type DefinicaoFluxo } from "../tipos";

/**
 * Versão do ARTEFATO que vai ao motor — compilador e adaptador juntos, não só
 * este arquivo. É ela que `fluxo_publicacoes.compilador_versao` grava, e é
 * comparando com ela que a tela sabe se o workflow que está no n8n foi gerado
 * pelo código de hoje ou por um anterior.
 *
 * Mudou para 1.1.0 quando o adaptador passou a pôr a guarda de inscrição antes
 * de cada envio: fluxo publicado com 1.0.0 não tem esse nó, e nele desinscrever
 * não para a mensagem. Republicar é o que resolve — e é a tela que pede, porque
 * ninguém adivinha isso olhando o fluxo.
 *
 * 1.2.0: a mensagem passou a poder levar um documento anexado
 * (`config.documento_id` → `documento_id` no corpo que vai ao CRM). Fluxo
 * publicado com 1.1.0 ignora o anexo — o nó dele não manda o campo, então o
 * lead recebe o texto sem o arquivo. Republicar resolve, e de novo é a tela que
 * precisa pedir: um anexo que não sai não deixa rastro no n8n.
 *
 * 1.3.0: o nó que registra a mensagem passou a gravar o ANEXO
 * (documento_id, tipo e os campos de mídia). Em 1.2.0 o arquivo saía para o
 * lead e não aparecia no histórico do /chat — a conversa guardava só a legenda,
 * como se fosse texto puro. Republicar corrige daí pra frente; o que já foi
 * registrado não volta atrás.
 *
 * 1.4.0: "Enviar notificação" deixou de ser No-Op e passou a mandar WhatsApp
 * para a pessoa escolhida (usuarios.whatsapp). Fluxo publicado antes atravessa
 * o bloco sem avisar ninguém — era o que acontecia com toda coluna "Ligação" da
 * cadência. Republicar é o que liga.
 *
 * 1.5.0: o aviso à equipe aceita `usuario_id: "responsavel"` (o responsável da
 * oportunidade na hora) e `so_sem_resposta` (a guarda das mensagens na frente
 * do aviso). Fluxo publicado antes não tem nenhum dos dois.
 *
 * 1.6.0 (2026-10-20): SEGURANÇA. As variáveis do lead saem escapadas para
 * JSON no corpo do envio (um nome com aspas reescrevia o destino da mensagem) e
 * todo {{ }} que não seja variável vira texto inerte (o n8n o executava como
 * código). Fluxo publicado antes continua com o furo até ser REPUBLICADO.
 * Também entram aqui a espera "até X da reunião", o lembrete que ignora a
 * resposta e as variáveis [[reuniao_x]] (só em fluxo que as usa).
 */
export const VERSAO_COMPILADOR = "1.6.0";

// Passo já resolvido: posição, tipo, config e para onde vai cada saída.
export type PassoCompilado = {
  id: string;
  tipo: string;
  rotulo: string;
  config: Record<string, unknown>;
  posicao: { x: number; y: number };
  // saida.id → id do próximo nó (ou null se aquela saída não vai a lugar nenhum)
  destinos: Record<string, string | null>;
};

export type PlanoCompilado = {
  fluxoId: string;
  nome: string;
  webhookCaminho: string;
  // Uma entrada só: a inscrição começa no primeiro bloco da corrente.
  //
  // Houve aqui uma lista de entradas alternativas, para inscrever alguém
  // direto na 4ª mensagem (o quadro da cadência arrastava cards entre
  // colunas). Saiu junto com o arraste: mover prometia uma precisão que a
  // cadência não tem — a coluna é onde o motor chegou, não um lugar onde se
  // põe alguém. O que ficou no lugar é tirar a oportunidade do fluxo.
  entrada: { id: string; posicao: { x: number; y: number }; proximo: string | null };
  passos: PassoCompilado[];
};

export type ContextoCompilacao = {
  fluxoId: string;
  nome: string;
  webhookCaminho: string;
};

export class ErroCompilacao extends Error {
  constructor(
    message: string,
    readonly noId?: string,
  ) {
    super(message);
    this.name = "ErroCompilacao";
  }
}

const ID_DE_NO = /^[A-Za-z0-9_-]{1,64}$/;

// Cada trecho {{ … }} achado num valor: só a leitura de um campo de um nó.
const EXPRESSAO_SEGURA = /^\{\{\s*\$\('[\w .[\]-]+'\)\.(?:first\(\)|item)\.json(?:\.[A-Za-z_][\w]*)+\s*(?:\?\?\s*(?:''|""|0|null))?\s*\}\}$/;

/** Os trechos {{ … }} de todas as strings dentro de um valor (objeto, lista). */
function expressoesDe(valor: unknown): string[] {
  if (typeof valor === "string") return valor.match(/\{\{[\s\S]*?\}\}/g) ?? (valor.includes("{{") ? [valor] : []);
  if (Array.isArray(valor)) return valor.flatMap(expressoesDe);
  if (valor && typeof valor === "object") return Object.values(valor).flatMap(expressoesDe);
  return [];
}

export function compilar(
  definicao: DefinicaoFluxo,
  ctx: ContextoCompilacao,
): PlanoCompilado {
  const arestasDe = new Map<string, { ramo: string; para: string }[]>();
  for (const a of definicao.arestas) {
    const lista = arestasDe.get(a.de) ?? [];
    lista.push({ ramo: a.ramo ?? "padrao", para: a.para });
    arestasDe.set(a.de, lista);
  }

  // A entrada é a raiz. Sem aresta saindo dela o fluxo não faz nada — publicar
  // isso geraria um workflow que roda e não executa passo nenhum.
  const daEntrada = arestasDe.get(NO_ENTRADA) ?? [];
  if (daEntrada.length === 0) {
    throw new ErroCompilacao(
      "A entrada do fluxo não está ligada a nenhum bloco.",
      NO_ENTRADA,
    );
  }

  const passos: PassoCompilado[] = [];

  for (const [id, no] of Object.entries(definicao.nos)) {
    if (id === NO_ENTRADA) continue;

    // O id vira NOME de nó no n8n, e o nome entra em expressões ($('… [id]')):
    // uma aspa nele sairia da string e escreveria código no motor (auditoria
    // de 2026-10-20). Só letras, números, _ e -.
    if (!ID_DE_NO.test(id)) {
      throw new ErroCompilacao(`Id de bloco inválido: use só letras, números, _ e - (até 64).`, id);
    }

    const bloco = blocoPorTipo(no.tipo);
    if (!bloco) {
      throw new ErroCompilacao(`Bloco desconhecido: ${no.tipo}`, id);
    }

    // A condição do "se" e os casos do "alternador" vão crus para o n8n, que
    // AVALIA o que estiver entre {{ }}. Só passa expressão que lê um campo de
    // um nó do próprio fluxo; qualquer outra é código e é recusada.
    if (no.tipo === "se" || no.tipo === "alternador") {
      const perigosa = expressoesDe(no.config?.condicao ?? no.config?.casos).find((t) => !EXPRESSAO_SEGURA.test(t));
      if (perigosa) {
        throw new ErroCompilacao(
          `A condição deste bloco tem uma expressão que o motor executaria como código (${perigosa.slice(0, 60)}). Use só a leitura de um campo, como {{ $('Carregar lead').first().json.valor }}.`,
          id,
        );
      }
    }

    // Contrato de semântica (§5.4): o motor precisa garantir o que o bloco
    // declara. Quem não garante recusa aqui, em vez de publicar algo que se
    // comporta diferente do prometido.
    if (bloco.indisponivel) {
      throw new ErroCompilacao(
        `"${bloco.rotulo}" não pode ser publicado: ${bloco.indisponivel}`,
        id,
      );
    }

    const saidas = arestasDe.get(id) ?? [];
    const destinos: Record<string, string | null> = {};
    for (const s of bloco.saidas) {
      destinos[s.id] = saidas.find((x) => x.ramo === s.id)?.para ?? null;
    }

    passos.push({
      id,
      tipo: no.tipo,
      rotulo: bloco.rotulo,
      config: no.config ?? {},
      posicao: definicao.layout[id] ?? { x: 0, y: 0 },
      destinos,
    });
  }

  // Nó solto não quebra a execução, mas quase sempre é engano do usuário — e
  // silenciar isso faz o fluxo publicar "funcionando" sem fazer o que ele quis.
  const alcancaveis = new Set<string>([NO_ENTRADA]);
  const fila = [NO_ENTRADA];
  while (fila.length) {
    const atual = fila.pop()!;
    for (const a of arestasDe.get(atual) ?? []) {
      if (!alcancaveis.has(a.para)) {
        alcancaveis.add(a.para);
        fila.push(a.para);
      }
    }
  }
  const orfao = passos.find((p) => !alcancaveis.has(p.id));
  if (orfao) {
    throw new ErroCompilacao(
      `"${orfao.rotulo}" não está ligado à entrada do fluxo.`,
      orfao.id,
    );
  }

  return {
    fluxoId: ctx.fluxoId,
    nome: ctx.nome,
    webhookCaminho: ctx.webhookCaminho,
    entrada: {
      id: NO_ENTRADA,
      posicao: definicao.layout[NO_ENTRADA] ?? { x: 0, y: 0 },
      proximo: daEntrada[0]?.para ?? null,
    },
    passos,
  };
}
