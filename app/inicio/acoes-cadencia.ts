"use server";

// Mutações da cadência de uma etapa: criar, salvar as colunas, publicar no
// motor e disparar. É o ciclo inteiro do painel de subetapas da raiz.
//
// ⚠ SEM AUTENTICAÇÃO ainda (docs/automacoes-arquitetura.md §3.1). Toda server
// action é um POST público, e `disparar` é a que manda WhatsApp de verdade
// pela instância COMPARTILHADA com o SprintHub. As duas travas que existem hoje
// são o modo simulação e o rate limit (lib/automacoes/servico.ts) — nenhuma
// delas substitui sessão + permissão, que continuam bloqueantes para produção.

import { revalidatePath } from "next/cache";
import { escreverCadencia, type Subetapa } from "@/lib/automacoes/cadencia";
import { compilar, ErroCompilacao } from "@/lib/automacoes/compilador";
import { dispor } from "@/lib/automacoes/layout";
import { dispararInscritos } from "@/lib/automacoes/disparo";
import {
  cancelarNaCadencia,
  criarFluxoDaEtapa,
  dadosDeDisparo,
  execucoesPresas,
  inscreverEtapa,
  salvarRascunho,
} from "@/lib/automacoes/repositorio";
import type { DefinicaoFluxo } from "@/lib/automacoes/tipos";
import { pausar, publicar, retomar } from "../automacoes/acoes";

export type Resultado =
  | { ok: true; mensagem: string }
  | { ok: false; erro: string };

export async function criarCadencia(
  etapaId: string,
  nomeEtapa: string,
): Promise<string> {
  if (!etapaId) throw new Error("Etapa não informada");
  const nome = `Cadência · ${nomeEtapa.trim() || "etapa"}`.slice(0, 120);

  let id: string;
  try {
    id = await criarFluxoDaEtapa(nome, etapaId);
  } catch (e) {
    // 42703 = undefined_column: `fluxos.etapa_id` ainda não existe. É o
    // primeiro lugar em que a migration que falta aparece para quem está
    // usando a tela — dizer O QUE rodar vale mais que repassar o erro do
    // Postgres, ainda mais porque em produção o Next redige a mensagem e
    // sobraria um "erro no servidor" sem pista nenhuma.
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "42703") {
      throw new Error(
        "Falta rodar migration-cadencia-etapa.sql no banco — é ela que cria fluxos.etapa_id, a coluna que amarra a cadência à etapa.",
      );
    }
    throw e;
  }

  revalidatePath("/");
  return id;
}

// Teto de colunas. Uma cadência de 18 mensagens é normal aqui; 200 não é, e
// sem teto um POST forjado gravaria uma versão de megabytes.
const MAX_COLUNAS = 200;

function texto(v: unknown, max: number) {
  return typeof v === "string" ? v.slice(0, max).trim() : "";
}

// Id de nó aceitável. Largo de propósito: o id vem do fluxo, e a IA escreve
// "msg1" tanto quanto "boas_vindas" — apertar isso renomearia os blocos no
// primeiro salvamento manual e quebraria a contagem por bloco das métricas.
// O que ele não pode ser é a raiz, um id de espera (que escreverCadencia gera)
// ou algo que não caiba numa chave de JSON.
function idAceitavel(id: string) {
  return (
    /^[A-Za-z0-9_-]{1,64}$/.test(id) &&
    id !== "__entrada__" &&
    !id.startsWith("espera_")
  );
}

// A entrada vem do navegador e server action é POST público: nada do que chega
// aqui entra no JSON do fluxo sem passar por esta peneira.
function limpar(bruto: Subetapa[]): Subetapa[] {
  const vistos = new Set<string>();

  return bruto.slice(0, MAX_COLUNAS).map((s, i) => {
    const dia = Number((s as { dia?: unknown }).dia);
    const id = texto(s.id, 64);
    // Id repetido viraria uma chave só no mapa de nós — duas colunas, um bloco.
    // Zerar manda escreverCadencia escolher um livre.
    const idOk = idAceitavel(id) && !vistos.has(id);
    if (idOk) vistos.add(id);

    return {
      id: idOk ? id : "",
      ordem: i + 1,
      nome: texto(s.nome, 120) || `Mensagem ${i + 1}`,
      canal: ["whatsapp", "email", "ligacao"].includes(s.canal)
        ? s.canal
        : "whatsapp",
      mensagem: texto(s.mensagem, 4000),
      assunto: texto(s.assunto, 200) || undefined,
      // 730 dias = 2 anos. Acima disso é engano de digitação, e cada dia vira
      // um Wait node de verdade segurando execução no motor.
      dia: Number.isFinite(dia) ? Math.min(Math.max(Math.round(dia), 0), 730) : 0,
      // Só o id: quem resolve base_url e token é o executor, no servidor, e é
      // ele também que recusa instância apagada em vez de cair no .env — que,
      // aqui, é o número compartilhado com o SprintHub.
      instanciaId: texto(s.instanciaId, 64) || null,
    };
  });
}

/**
 * Grava as colunas E leva ao motor. Um clique, não dois.
 *
 * A cadência é uma automação do n8n — não uma lista que vira automação depois.
 * Então salvar publica: cria (ou atualiza) o workflow lá, com o webhook e os
 * blocos prontos. O que salvar NÃO faz é ligar: cadência nova nasce PAUSADA, e
 * quem estava rodando continua rodando. Sem essa regra, escrever uma mensagem
 * nova poria a etapa inteira para disparar sem ninguém mandar.
 *
 * Compila ANTES de gravar, pelo mesmo motivo da ferramenta da IA: o compilador
 * é o revisor, e recusar aqui é mais barato que descobrir na publicação que a
 * cadência tinha um bloco solto.
 */
export async function salvarCadencia(
  fluxoId: string,
  subetapas: Subetapa[],
): Promise<Resultado> {
  if (!fluxoId) return { ok: false, erro: "Cadência não informada." };
  if (!Array.isArray(subetapas) || subetapas.length === 0) {
    return { ok: false, erro: "Uma cadência precisa de pelo menos uma mensagem." };
  }

  const parcial = escreverCadencia(limpar(subetapas));
  const definicao: DefinicaoFluxo = { ...parcial, layout: {} };
  definicao.layout = dispor(definicao);

  try {
    // nome e webhook não participam da validação — placeholders bastam, igual
    // em lib/ia/automacoes.ts.
    compilar(definicao, { fluxoId, nome: "", webhookCaminho: "" });
  } catch (e) {
    if (e instanceof ErroCompilacao) return { ok: false, erro: e.message };
    throw e;
  }

  const versao = await salvarRascunho(fluxoId, definicao, null);

  // ativar: true, SEMPRE. Antes era `antes?.estado === "publicado"` — quem
  // estava pausada continuava pausada, e uma cadência nova nascia pausada. O
  // resultado é que publicar exigia três passos (Salvar → interruptor →
  // Disparar) e nada saía enquanto faltasse um.
  //
  // Decisão de 2026-09-09: publicar É colocar para rodar. O interruptor
  // continua existindo para PARAR — o que ele não faz mais é sobreviver a um
  // Publicar seguinte.
  const r = await publicar(fluxoId, { ativar: true });
  revalidatePath("/");

  if (!r.ok) {
    // A versão está gravada — o que falhou foi a ida ao motor. Dizer as duas
    // coisas evita a leitura de que o texto se perdeu.
    return {
      ok: false,
      erro: `Rascunho v${versao} salvo, mas não chegou ao n8n: ${r.erro}`,
    };
  }

  // Publicou; agora inscreve. Reusa `dispararCadencia` inteiro em vez de
  // repetir a inscrição aqui: as validações e, principalmente, as mensagens de
  // erro dela (execução presa, ninguém novo, motor inalcançável) são o que
  // explica ao usuário por que nada saiu.
  const disparo = await dispararCadencia(fluxoId);

  // "Ninguém novo" NÃO é falha do Publicar: a versão subiu, o workflow está no
  // ar e quem já estava dentro continua andando. Some as duas mensagens em vez
  // de deixar a de disparo mascarar o que deu certo.
  return {
    ok: true,
    mensagem: `Publicado (v${versao}) e rodando no n8n. ${
      disparo.ok ? disparo.mensagem : disparo.erro
    }`,
  };
}

/**
 * O interruptor: rodando ou pausada. É ativar/desativar o workflow no motor —
 * pausada, o webhook simplesmente não existe mais lá, e nada entra nem anda.
 *
 * Quem já está no meio da cadência não é cancelado ao pausar: as execuções
 * ficam onde estão. Retomar volta a andar de onde parou.
 */
export async function alternarCadencia(
  fluxoId: string,
  rodar: boolean,
): Promise<Resultado> {
  if (!fluxoId) return { ok: false, erro: "Cadência não informada." };
  const r = rodar ? await retomar(fluxoId) : await pausar(fluxoId);
  revalidatePath("/");
  return r.ok
    ? { ok: true, mensagem: rodar ? "Cadência rodando." : "Cadência pausada." }
    : { ok: false, erro: r.erro };
}

/**
 * DISPARA: inscreve as oportunidades abertas da etapa e manda o motor começar.
 *
 * Quem já está dentro do fluxo não entra de novo (regra de reentrada, no
 * índice — ver inscreverEtapa). Então clicar duas vezes não duplica mensagem;
 * o segundo clique pega só quem entrou na etapa desde o primeiro.
 */
export async function dispararCadencia(fluxoId: string): Promise<Resultado> {
  const fluxo = await dadosDeDisparo(fluxoId);
  if (!fluxo) return { ok: false, erro: "Cadência não encontrada." };
  if (!fluxo.etapa_id) return { ok: false, erro: "Cadência sem etapa." };

  if (!fluxo.versao_publicada_id || !fluxo.motor_webhook_caminho) {
    return {
      ok: false,
      erro: "Publique a cadência antes de disparar — é a publicação que cria o workflow no motor.",
    };
  }
  if (fluxo.estado === "pausado") {
    return {
      ok: false,
      erro: "Cadência pausada — ligue o interruptor antes de disparar. Pausada, o motor nem reconhece o webhook.",
    };
  }

  const inscritos = await inscreverEtapa(
    fluxoId,
    fluxo.versao_publicada_id,
    fluxo.etapa_id,
  );

  if (inscritos.length === 0) {
    // "Ninguém novo" tem duas causas MUITO diferentes, e não distingui-las é um
    // beco sem saída: ou já está todo mundo rodando, ou há execução travada
    // segurando a oportunidade pelo índice de reentrada.
    const presas = await execucoesPresas(fluxoId);
    if (presas.n > 0) {
      return {
        ok: false,
        erro: `Ninguém novo para inscrever, mas ${presas.n} ${presas.n === 1 ? "execução está presa" : "execuções estão presas"} em 'pendente' sem nenhum passo (a mais antiga desde ${presas.maisAntiga}). Isso é o motor não conseguindo voltar ao CRM — confira o CRM_BASE_URL e se o endereço é alcançável de fora. Enquanto a linha existir, a oportunidade não entra de novo.`,
      };
    }
    return {
      ok: false,
      erro: "Ninguém novo para inscrever: as oportunidades abertas desta etapa já estão na cadência.",
    };
  }

  const { entraram, perdidas } = await dispararInscritos(
    fluxo,
    "oportunidade",
    inscritos,
  );

  revalidatePath("/");

  if (entraram === 0) {
    return {
      ok: false,
      erro: "Nenhuma execução chegou ao motor. Confira se o workflow está ativo e se o CRM alcança o motor.",
    };
  }

  const falhou = perdidas
    ? ` ${perdidas} não chegaram ao motor e voltam no próximo disparo.`
    : "";

  return {
    ok: true,
    mensagem: `${entraram} ${entraram === 1 ? "oportunidade entrou" : "oportunidades entraram"} na cadência. ${falhou}`,
  };
}


/**
 * TIRA a oportunidade da cadência: cancela a inscrição dela e a espera
 * pendurada nela. Nada mais é enviado para aquele contato por este fluxo.
 *
 * É o que substituiu o arraste entre mensagens. Mover prometia uma precisão
 * que a cadência não tem — "está na 4ª" é onde o motor chegou, não um lugar
 * onde se põe alguém —, e para sair do caminho de uma sequência que já está
 * rodando, sair inteiro é o que resolve.
 *
 * A execução antiga continua parada num Wait do lado do motor e um dia acorda.
 * Quem a barra é o executor, que recusa bloco de execução que não está mais
 * viva (lib/automacoes/executor.ts) — sem essa outra ponta, "removi" duraria
 * até o próximo despertar do motor.
 *
 * Sair NÃO é "nunca mais": o próximo Disparar inscreve de novo as
 * oportunidades abertas da etapa, esta inclusive. Uma exclusão permanente
 * pediria uma coluna para guardar quem não deve voltar — e isso é modelagem,
 * não um efeito colateral desta ação.
 */
export async function removerDaCadencia(
  fluxoId: string,
  oportunidadeId: string,
): Promise<Resultado> {
  if (!fluxoId || !oportunidadeId) {
    return { ok: false, erro: "Faltou a cadência ou a oportunidade." };
  }

  const canceladas = await cancelarNaCadencia(
    fluxoId,
    oportunidadeId,
    "Removida da cadência pelo quadro",
  );

  revalidatePath("/");

  if (canceladas === 0) {
    // Não é erro: quem nunca entrou no fluxo aparece no quadro pela régua de
    // dias, e a tela precisa dizer isso em vez de fingir que tirou alguém.
    return {
      ok: true,
      mensagem: "Esta oportunidade não estava na cadência — nada a remover.",
    };
  }

  return {
    ok: true,
    mensagem: "Fora da cadência. Nada mais sai por este fluxo até o próximo disparo.",
  };
}
