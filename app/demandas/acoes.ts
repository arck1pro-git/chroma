"use server";

// Mutações de Demandas. Toda ação daqui é ponto de entrada de rede: o cliente
// posta direto nela, então cada uma confere quem está falando antes de tocar
// no banco — e a regra de quem pode o quê fica em lib/demandas.ts, na própria
// consulta.
import { revalidatePath } from "next/cache";
import { exigirLogin, exigirModulo } from "@/lib/auth/dal";
import {
  anexarDepois,
  anexoPorId,
  conferirEnviados,
  descartarEnvios,
  prepararEnvio,
  tirarAnexo,
  vincular,
} from "@/lib/demandas-anexos";
import {
  adicionarItem,
  apagarDemandas,
  atualizarDemandas,
  copiasDe,
  inserirChamado,
  inserirDemandas,
  inserirItens,
  marcarEmAndamento,
  marcarFeita,
  marcarItem,
  mudarPrazo,
  podeCriarPara,
  removerItem,
  renomearItem,
} from "@/lib/demandas";
import {
  ehPrioridade,
  PARA_O_TI,
  PARA_TODOS,
  TETO_ITENS,
  TETO_TEXTO_ITEM,
  type AnexoDemanda,
  type DadosDemanda,
  type Prioridade,
  type ResultadoDemanda,
} from "@/lib/demandas-tipos";

const TETO_TITULO = 200;
const TETO_DESCRICAO = 4000;

function idValido(id: unknown): id is string {
  return typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id);
}

/**
 * Os ids de um cartão. Vários quando o cartão junta a demanda "para todos";
 * o teto é só para ninguém mandar uma lista de mil pela rede.
 */
function idsValidos(ids: unknown): string[] | null {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500) return null;
  return ids.every(idValido) ? ids : null;
}

/** Os passos do checklist que vieram do formulário: texto de verdade, sem vazio, dentro dos tetos. */
function itensDe(dados: DadosDemanda): string[] {
  if (!Array.isArray(dados?.itens)) return [];
  return dados.itens.map((i) => texto(i, TETO_TEXTO_ITEM)).filter(Boolean).slice(0, TETO_ITENS);
}

function texto(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

type Campos = { titulo: string; descricao: string | null; prazo: string | null; prioridade: Prioridade };

/** O que vale nos dois formulários (demanda e chamado). */
function camposDe(dados: DadosDemanda): { erro: string } | Campos {
  const titulo = texto(dados?.titulo, TETO_TITULO);
  if (!titulo) return { erro: "Dê um título." };

  const prazo = texto(dados?.prazo, 10);
  // A data inexistente (31/02) passa por aqui e o Postgres recusa no INSERT.
  if (prazo && !/^\d{4}-\d{2}-\d{2}$/.test(prazo)) return { erro: "Prazo inválido." };

  return {
    titulo,
    descricao: texto(dados?.descricao, TETO_DESCRICAO) || null,
    prazo: prazo || null,
    prioridade: ehPrioridade(dados?.prioridade) ? dados.prioridade : "normal",
  };
}

function mensagemDoErro(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/date\/time field value out of range|invalid input syntax for type date/i.test(msg)) {
    return "Prazo inválido.";
  }
  if (/relation "demandas" does not exist/i.test(msg)) {
    return "A tabela de demandas ainda não existe: rode migration-demandas.sql.";
  }
  return msg;
}

/** O chamado, venha do botão do Dashboard ou da "Nova demanda" do módulo. */
async function gravarChamado(
  campos: Campos,
  autorId: string,
  itens: string[],
  anexos: AnexoDemanda[],
): Promise<ResultadoDemanda> {
  try {
    const id = await inserirChamado(campos, autorId);
    if (!id) {
      await descartarEnvios(anexos);
      return { ok: false, mensagem: "O departamento TI não existe no banco." };
    }
    await inserirItens([id], itens);
    await vincular([id], anexos);
  } catch (e) {
    await descartarEnvios(anexos);
    return { ok: false, mensagem: mensagemDoErro(e) };
  }

  revalidatePath("/demandas");
  return { ok: true, mensagem: "Chamado aberto. O TI recebe em Demandas." };
}

/**
 * "Nova demanda", em /demandas. Todo mundo cria para si, para qualquer pessoa
 * da equipe ou abre um chamado para o TI; "para todos", só Admin e TI (a regra
 * é podeCriarPara, em lib/demandas.ts).
 */
export async function criarDemanda(dados: DadosDemanda): Promise<ResultadoDemanda> {
  const { usuario } = await exigirModulo("demandas");

  const campos = camposDe(dados);
  if ("erro" in campos) return { ok: false, mensagem: campos.erro };

  const para = dados?.para;
  if (para !== PARA_TODOS && para !== PARA_O_TI && !idValido(para)) {
    return { ok: false, mensagem: "Escolha para quem é a demanda." };
  }
  if (!podeCriarPara(usuario, para)) {
    return {
      ok: false,
      mensagem: "Demanda para todos de uma vez, só Admin e TI. Escolha uma pessoa.",
    };
  }

  const itens = itensDe(dados);
  const enviados = await conferirEnviados(dados?.anexos);
  if ("erro" in enviados) return { ok: false, mensagem: enviados.erro };
  const anexos = enviados.anexos;
  if (para === PARA_O_TI) return gravarChamado(campos, usuario.id, itens, anexos);

  let criadas: number;
  try {
    const ids = await inserirDemandas(campos, para, usuario.id);
    // Uma cópia do checklist em cada demanda — na "para todos", cada pessoa
    // marca os itens dela. Os anexos, idem: cada cópia com o seu arquivo.
    await inserirItens(ids, itens);
    await vincular(ids, anexos);
    criadas = ids.length;
  } catch (e) {
    await descartarEnvios(anexos);
    return { ok: false, mensagem: mensagemDoErro(e) };
  }

  if (criadas === 0) {
    await descartarEnvios(anexos);
    return {
      ok: false,
      mensagem:
        "Ninguém recebeu: a pessoa precisa estar ativa e ter o módulo Demandas.",
    };
  }

  revalidatePath("/demandas");
  return {
    ok: true,
    mensagem:
      para === PARA_TODOS
        ? `Demanda criada para ${criadas} ${criadas === 1 ? "pessoa" : "pessoas"}.`
        : para === usuario.id
          ? "Demanda criada para você."
          : "Demanda criada.",
  };
}

/**
 * O botão "Abrir chamado" do Dashboard. Basta estar logado: abrir chamado para
 * o TI não depende de módulo nenhum — quem mais precisa dele é justamente quem
 * esbarrou num acesso que não tem.
 */
export async function abrirChamado(dados: DadosDemanda): Promise<ResultadoDemanda> {
  const usuario = await exigirLogin();

  const campos = camposDe(dados);
  if ("erro" in campos) return { ok: false, mensagem: campos.erro };

  const enviados = await conferirEnviados(dados?.anexos);
  if ("erro" in enviados) return { ok: false, mensagem: enviados.erro };
  return gravarChamado(campos, usuario.id, itensDe(dados), enviados.anexos);
}

// ── Anexos ──────────────────────────────────────────────────────────────────
// O arquivo vai do navegador direto para o Storage (lib/demandas-anexos.ts);
// estas ações só assinam o envio e ligam o arquivo que chegou à demanda.

export type ResultadoEnvio = { ok: true; id: string; url: string } | { ok: false; mensagem: string };

/**
 * Passo 1 do anexo: o id e a URL assinada para subir. Basta estar logado — o
 * "Abrir chamado" do Dashboard também anexa, e ele não exige módulo. O que
 * subir sem virar anexo de uma demanda não aparece para ninguém.
 */
export async function prepararAnexoDemanda(tamanho: number): Promise<ResultadoEnvio> {
  await exigirLogin();
  try {
    const r = await prepararEnvio(tamanho);
    return "erro" in r ? { ok: false, mensagem: r.erro } : { ok: true, ...r };
  } catch (e) {
    console.error("[demandas] preparar anexo:", e);
    return { ok: false, mensagem: "Não consegui preparar o envio do arquivo. Tente de novo." };
  }
}

/** Anexar depois de criada, pela gaveta. Só quem criou; vale para as cópias. */
export async function adicionarAnexoDemanda(demandaId: string, anexo: AnexoDemanda): Promise<ResultadoDemanda> {
  const { usuario } = await exigirModulo("demandas");
  if (!idValido(demandaId)) return { ok: false, mensagem: "Demanda inválida." };
  const r = await anexarDepois(demandaId, await copiasDe(demandaId), [anexo], usuario);
  if ("erro" in r) return { ok: false, mensagem: r.erro };
  revalidatePath("/demandas");
  return { ok: true, mensagem: `“${r.anexos[0]?.nome}” anexado.` };
}

/** Tira o anexo (de todas as cópias). Só quem criou a demanda. */
export async function removerAnexoDemanda(anexoId: string): Promise<ResultadoDemanda> {
  const { usuario } = await exigirModulo("demandas");
  const anexo = await anexoPorId(anexoId);
  if (!anexo) return { ok: false, mensagem: "Anexo não encontrado." };
  if (!(await tirarAnexo(anexo.nome, await copiasDe(anexo.demandaId), usuario))) {
    return { ok: false, mensagem: "Só quem criou a demanda tira anexos." };
  }
  revalidatePath("/demandas");
  return { ok: true, mensagem: `“${anexo.nome}” tirado.` };
}

export async function marcarDemanda(id: string, feita: boolean): Promise<ResultadoDemanda> {
  const { usuario } = await exigirModulo("demandas");
  if (!idValido(id)) return { ok: false, mensagem: "Demanda inválida." };

  const ok = await marcarFeita(id, feita === true, usuario);
  if (!ok) return { ok: false, mensagem: "Só quem recebeu a demanda dá o check." };

  revalidatePath("/demandas");
  return { ok: true, mensagem: feita ? "Feita." : "Voltou para pendente." };
}

/** O arraste para "Em andamento" (ou de volta para a coluna do prazo). */
export async function andamentoDemanda(id: string, sim: boolean): Promise<ResultadoDemanda> {
  const { usuario } = await exigirModulo("demandas");
  if (!idValido(id)) return { ok: false, mensagem: "Demanda inválida." };

  const ok = await marcarEmAndamento(id, sim === true, usuario);
  if (!ok) return { ok: false, mensagem: "Só quem recebeu a demanda a move de coluna." };

  revalidatePath("/demandas");
  return { ok: true, mensagem: sim ? "Em andamento." : "Voltou para a fila." };
}

/** Editar não muda PARA QUEM: isso é outra demanda. */
export async function editarDemanda(ids: string[], dados: DadosDemanda): Promise<ResultadoDemanda> {
  const { usuario } = await exigirModulo("demandas");
  const validos = idsValidos(ids);
  if (!validos) return { ok: false, mensagem: "Demanda inválida." };

  const campos = camposDe(dados);
  if ("erro" in campos) return { ok: false, mensagem: campos.erro };

  let mudaram: number;
  try {
    mudaram = await atualizarDemandas(validos, campos, usuario);
  } catch (e) {
    return { ok: false, mensagem: mensagemDoErro(e) };
  }
  if (mudaram === 0) {
    return {
      ok: false,
      mensagem: "Só quem criou a demanda pode editá-la.",
    };
  }

  revalidatePath("/demandas");
  return { ok: true, mensagem: "Demanda salva." };
}

/**
 * Só o prazo, sem o resto do formulário: o arraste de um dia para outro no
 * calendário (ou para "Sem prazo", com `prazo` nulo). Só quem criou.
 */
export async function mudarPrazoDemanda(ids: string[], prazo: string | null): Promise<ResultadoDemanda> {
  const { usuario } = await exigirModulo("demandas");
  const validos = idsValidos(ids);
  if (!validos) return { ok: false, mensagem: "Demanda inválida." };
  if (prazo !== null && (typeof prazo !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(prazo))) {
    return { ok: false, mensagem: "Prazo inválido." };
  }

  let mudaram: number;
  try {
    mudaram = await mudarPrazo(validos, prazo, usuario);
  } catch (e) {
    return { ok: false, mensagem: mensagemDoErro(e) };
  }
  if (mudaram === 0) return { ok: false, mensagem: "Só quem criou a demanda pode mudar o prazo." };

  revalidatePath("/demandas");
  return {
    ok: true,
    mensagem: prazo ? `Prazo mudado para ${prazo.slice(8, 10)}/${prazo.slice(5, 7)}.` : "Prazo tirado.",
  };
}

export async function excluirDemandas(ids: string[]): Promise<ResultadoDemanda> {
  const { usuario } = await exigirModulo("demandas");
  const validos = idsValidos(ids);
  if (!validos) return { ok: false, mensagem: "Demanda inválida." };

  const apagadas = await apagarDemandas(validos, usuario);
  if (apagadas === 0) {
    return {
      ok: false,
      mensagem: "Só quem criou a demanda pode excluí-la.",
    };
  }

  revalidatePath("/demandas");
  return {
    ok: true,
    mensagem: apagadas === 1 ? "Demanda excluída." : `${apagadas} demandas excluídas.`,
  };
}

// ── Checklist ───────────────────────────────────────────────────────────────
// Quem pode o quê está em lib/demandas.ts: montar é de quem criou a demanda,
// marcar é de quem a recebeu.

const SO_QUEM_CRIOU = "Só quem criou a demanda monta o checklist.";

export async function adicionarItemDemanda(demandaId: string, textoDoItem: string): Promise<ResultadoDemanda> {
  const { usuario } = await exigirModulo("demandas");
  if (!idValido(demandaId)) return { ok: false, mensagem: "Demanda inválida." };
  const t = texto(textoDoItem, TETO_TEXTO_ITEM);
  if (!t) return { ok: false, mensagem: "Escreva o item." };
  if (!(await adicionarItem(demandaId, t, usuario))) return { ok: false, mensagem: SO_QUEM_CRIOU };
  revalidatePath("/demandas");
  return { ok: true, mensagem: "Item acrescentado." };
}

export async function renomearItemDemanda(itemId: string, textoDoItem: string): Promise<ResultadoDemanda> {
  const { usuario } = await exigirModulo("demandas");
  if (!idValido(itemId)) return { ok: false, mensagem: "Item inválido." };
  const t = texto(textoDoItem, TETO_TEXTO_ITEM);
  if (!t) return { ok: false, mensagem: "O item não pode ficar vazio." };
  if (!(await renomearItem(itemId, t, usuario))) return { ok: false, mensagem: SO_QUEM_CRIOU };
  revalidatePath("/demandas");
  return { ok: true, mensagem: "Item salvo." };
}

export async function removerItemDemanda(itemId: string): Promise<ResultadoDemanda> {
  const { usuario } = await exigirModulo("demandas");
  if (!idValido(itemId)) return { ok: false, mensagem: "Item inválido." };
  if (!(await removerItem(itemId, usuario))) return { ok: false, mensagem: SO_QUEM_CRIOU };
  revalidatePath("/demandas");
  return { ok: true, mensagem: "Item tirado." };
}

export async function marcarItemDemanda(itemId: string, feito: boolean): Promise<ResultadoDemanda> {
  const { usuario } = await exigirModulo("demandas");
  if (!idValido(itemId)) return { ok: false, mensagem: "Item inválido." };
  if (!(await marcarItem(itemId, feito === true, usuario))) {
    return { ok: false, mensagem: "Só quem recebeu a demanda marca os itens." };
  }
  revalidatePath("/demandas");
  return { ok: true, mensagem: feito ? "Item feito." : "Item voltou para pendente." };
}
