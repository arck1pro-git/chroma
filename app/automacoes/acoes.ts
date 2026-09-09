"use server";

// Mutações das Automações. Roda no servidor — trate a entrada como não confiável.
//
// ⚠ NÃO HÁ AUTENTICAÇÃO no app ainda (docs/automacoes-arquitetura.md §3.1).
// Toda server action é um endpoint POST público. `publicar` chega a criar
// workflow numa instância n8n COMPARTILHADA com produção. Isto precisa de
// sessão + permissão antes de ir para produção.

import { randomBytes, createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { compilar, ErroCompilacao, VERSAO_COMPILADOR } from "@/lib/automacoes/compilador";
import {
  atualizarWorkflow,
  ativarWorkflow,
  criarWorkflow,
  desativarWorkflow,
  paraWorkflow,
} from "@/lib/automacoes/motores/n8n/adaptador";
import { dispararInscritos } from "@/lib/automacoes/disparo";
import {
  concluirPublicacao,
  criarFluxo as criarNoBanco,
  dadosDeDisparo,
  definicaoDoFluxo,
  inscreverSegmento,
  marcarPublicado,
  registrarPublicacao,
  salvarRascunho as salvarNoBanco,
} from "@/lib/automacoes/repositorio";
import { sql } from "@/lib/db";
import type { DefinicaoFluxo } from "@/lib/automacoes/tipos";

const MOTOR = "n8n";

export type Resultado =
  | { ok: true; mensagem: string }
  | { ok: false; erro: string; noId?: string };

export async function criarFluxo(
  nome: string,
  entidade: "contato" | "oportunidade",
): Promise<string> {
  const limpo = nome.trim();
  if (!limpo) throw new Error("Nome é obrigatório");
  if (entidade !== "contato" && entidade !== "oportunidade") {
    throw new Error("Entidade inválida");
  }

  const id = await criarNoBanco(limpo, entidade);
  revalidatePath("/automacoes");
  return id;
}

export async function salvarRascunho(
  fluxoId: string,
  definicao: DefinicaoFluxo,
): Promise<number> {
  if (definicao?.schema !== "chroma.flow/v1") {
    throw new Error("Formato de definição desconhecido");
  }
  const numero = await salvarNoBanco(fluxoId, definicao, null);
  revalidatePath(`/automacoes/${fluxoId}`);
  return numero;
}

/**
 * Salva, compila e leva ao n8n.
 *
 * A ordem importa: grava a versão e a linha de publicação ANTES de falar com o
 * motor. Se o n8n não responder, sobra registro do que foi tentado em vez de
 * silêncio — é a versão síncrona do outbox descrito no §6.3.
 *
 * `ativar` decide se o workflow fica ligado no fim. Falso é como a cadência
 * publica: o workflow existe no motor, com os blocos e o webhook prontos, e
 * fica DESATIVADO até alguém virar o interruptor. Sem esse parâmetro, salvar
 * uma mensagem já poria a cadência para disparar — o oposto do que "pausada"
 * promete.
 */
export async function publicar(
  fluxoId: string,
  opcoes?: { ativar?: boolean },
): Promise<Resultado> {
  const ativar = opcoes?.ativar ?? true;
  const definicao = await definicaoDoFluxo(fluxoId);

  const [fluxo] = await sql`
    SELECT id, nome, motor_workflow_id, motor_webhook_caminho, motor_webhook_segredo,
           versao_rascunho_id, versao_publicada_id
    FROM fluxos WHERE id = ${fluxoId}`;
  if (!fluxo) return { ok: false, erro: "Fluxo não encontrado" };

  const versaoId = (fluxo.versao_rascunho_id ?? fluxo.versao_publicada_id) as
    | string
    | null;
  if (!versaoId) {
    return { ok: false, erro: "Salve o fluxo antes de publicar." };
  }

  // Caminho determinístico e segredo estável: republicar não muda a URL do
  // webhook, senão quem já chamava pararia de funcionar.
  const caminho =
    (fluxo.motor_webhook_caminho as string | null) ?? `chroma/fluxo/${fluxoId}`;
  const segredo =
    (fluxo.motor_webhook_segredo as string | null) ?? randomBytes(24).toString("hex");

  let plano;
  try {
    plano = compilar(definicao, {
      fluxoId,
      nome: fluxo.nome as string,
      webhookCaminho: caminho,
    });
  } catch (e) {
    if (e instanceof ErroCompilacao) {
      return { ok: false, erro: e.message, noId: e.noId };
    }
    throw e;
  }

  // Os nós autenticam com o CRM_SERVICE_TOKEN escrito direto no header — não há
  // credencial cadastrada no motor, por decisão explícita. O adaptador estoura
  // se a variável não existir; sem este try, isso viraria um 500 cru na tela.
  let workflow;
  try {
    workflow = paraWorkflow(plano);
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }

  const compiladoHash = createHash("sha256")
    .update(JSON.stringify(workflow))
    .digest("hex");

  const publicacaoId = await registrarPublicacao({
    fluxoId,
    versaoId,
    motor: MOTOR,
    compiladorVersao: VERSAO_COMPILADOR,
    compiladoHash,
  });

  try {
    const existente = fluxo.motor_workflow_id as string | null;
    let workflowId: string;

    if (existente) {
      // Atualiza SÓ o id que o CRM gravou. Nunca procura por nome — a instância
      // tem automação de produção da empresa ao lado (docs §5.1).
      await atualizarWorkflow(existente, workflow);
      workflowId = existente;
    } else {
      workflowId = await criarWorkflow(workflow);
    }

    // Ativar e desativar são chamadas próprias na API do motor (§6): criar não
    // aceita `active` no corpo, e atualizar não desliga o que já estava ligado.
    // Workflow recém-criado já nasce inativo — pedir desativação dele seria uma
    // chamada a mais para não mudar nada.
    if (ativar) await ativarWorkflow(workflowId);
    else if (existente) await desativarWorkflow(workflowId);

    await concluirPublicacao(publicacaoId, { ok: true, workflowId });
    await marcarPublicado(fluxoId, versaoId, workflowId, caminho, segredo, ativar);

    revalidatePath("/automacoes");
    revalidatePath(`/automacoes/${fluxoId}`);
    return {
      ok: true,
      mensagem: ativar
        ? "Publicado e ativo no motor."
        : "Publicado no motor, pausado.",
    };
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e);
    await concluirPublicacao(publicacaoId, { ok: false, erro });
    // O fluxo continua na versão publicada anterior — não fica num meio-termo.
    return { ok: false, erro };
  }
}

export async function pausar(fluxoId: string): Promise<Resultado> {
  const [fluxo] = await sql`
    SELECT motor_workflow_id FROM fluxos WHERE id = ${fluxoId}`;
  if (!fluxo?.motor_workflow_id) {
    return { ok: false, erro: "Este fluxo não está publicado." };
  }

  try {
    await desativarWorkflow(fluxo.motor_workflow_id as string);
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }

  await sql`UPDATE fluxos SET estado = 'pausado', data_atualizacao = now() WHERE id = ${fluxoId}`;
  revalidatePath("/automacoes");
  revalidatePath(`/automacoes/${fluxoId}`);
  return { ok: true, mensagem: "Fluxo pausado no motor." };
}

/**
 * O contrário de `pausar`: religa no motor o workflow que já está lá.
 *
 * Não republica. Quem volta a rodar é a versão que já estava publicada — se o
 * rascunho mudou desde então, ele continua sendo rascunho, e é o Salvar que o
 * leva ao motor. Misturar as duas coisas faria "retomar" mandar para o ar uma
 * edição que ninguém pediu para publicar.
 */
export async function retomar(fluxoId: string): Promise<Resultado> {
  const [fluxo] = await sql`
    SELECT motor_workflow_id, versao_publicada_id FROM fluxos WHERE id = ${fluxoId}`;
  if (!fluxo?.motor_workflow_id || !fluxo.versao_publicada_id) {
    return {
      ok: false,
      erro: "Este fluxo ainda não existe no motor — salve para publicá-lo.",
    };
  }

  try {
    await ativarWorkflow(fluxo.motor_workflow_id as string);
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }

  await sql`UPDATE fluxos SET estado = 'publicado', data_atualizacao = now() WHERE id = ${fluxoId}`;
  revalidatePath("/automacoes");
  revalidatePath(`/automacoes/${fluxoId}`);
  return { ok: true, mensagem: "Fluxo rodando no motor." };
}


/**
 * Dispara o fluxo para todos os contatos de um segmento.
 *
 * Irmã de `dispararCadencia` (app/inicio/acoes-cadencia.ts) — mesma mecânica,
 * outra origem: lá a lista é a etapa do funil, aqui é o segmento. Foi escrita
 * separada em vez de generalizada porque as VALIDAÇÕES diferem (cadência exige
 * etapa; isto exige fluxo de contato) e as mensagens de erro que o usuário lê
 * são o principal desta função.
 *
 * ENTIDADE: só fluxo de contato. Segmento é do contato, e um contato pode ter
 * zero ou várias oportunidades — escolher uma por ele seria o CRM inventando
 * qual negócio recebe a mensagem.
 */
export async function dispararParaSegmento(
  fluxoId: string,
  segmentoId: string,
): Promise<Resultado> {
  const fluxo = await dadosDeDisparo(fluxoId);
  if (!fluxo) return { ok: false, erro: "Automação não encontrada." };

  if (fluxo.entidade_alvo !== "contato") {
    return {
      ok: false,
      erro: "Esta automação é de oportunidade. Disparo por segmento inscreve contatos — use uma automação de contato, ou dispare pela etapa do funil.",
    };
  }
  if (!fluxo.versao_publicada_id || !fluxo.motor_webhook_caminho) {
    return {
      ok: false,
      erro: "Publique a automação antes de disparar — é a publicação que cria o workflow no motor.",
    };
  }
  if (fluxo.estado === "pausado") {
    return {
      ok: false,
      erro: "Automação pausada — ligue-a antes de disparar. Pausada, o motor nem reconhece o webhook.",
    };
  }

  const [segmento] = await sql`
    SELECT nome, (SELECT count(*)::int FROM contato_segmentos cs
                   WHERE cs.segmento_id = s.id) AS contatos
    FROM segmentos s WHERE s.id = ${segmentoId}`;
  if (!segmento) return { ok: false, erro: "Segmento não encontrado." };

  const inscritos = await inscreverSegmento(
    fluxoId,
    fluxo.versao_publicada_id,
    segmentoId,
  );

  if (inscritos.length === 0) {
    return {
      ok: false,
      erro:
        segmento.contatos === 0
          ? `O segmento "${segmento.nome}" não tem nenhum contato.`
          : `Ninguém novo para inscrever: os ${segmento.contatos} contatos deste segmento já estão nesta automação.`,
    };
  }

  const { entraram, perdidas } = await dispararInscritos(fluxo, "contato", inscritos);

  revalidatePath("/automacoes");
  revalidatePath(`/automacoes/${fluxoId}`);

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
    mensagem: `${entraram} ${entraram === 1 ? "contato entrou" : "contatos entraram"} na automação a partir de "${segmento.nome}". ${falhou}`,
  };
}
