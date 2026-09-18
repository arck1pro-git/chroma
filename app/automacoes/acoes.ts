"use server";

// Toda ação daqui é ponto de entrada de rede: o cliente posta direto nela.
// O proxy já barra quem não tem cookie; esta linha acrescenta o que ele não
// pode conferir sem ir ao banco — se a pessoa ainda existe e ainda está ativa.
import { exigirModulo } from "@/lib/auth/dal";

// Mutações das Automações. Roda no servidor — trate a entrada como não confiável.
//
// ⚠ NÃO HÁ AUTENTICAÇÃO no app ainda (docs/automacoes-arquitetura.md §3.1).
// Toda server action é um endpoint POST público. `publicar` chega a criar
// workflow numa instância n8n COMPARTILHADA com produção. Isto precisa de
// sessão + permissão antes de ir para produção.

import { randomBytes, createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { enderecoDoCrm } from "@/lib/endereco";
import { compilar, ErroCompilacao, VERSAO_COMPILADOR } from "@/lib/automacoes/compilador";
import {
  apagarWorkflow,
  acharWorkflowPorNome,
  workflowDeErros,
  NOME_WORKFLOW_ERROS,
  atualizarWorkflow,
  ativarWorkflow,
  criarCredencial,
  criarWorkflow,
  desativarWorkflow,
  paraWorkflow,
} from "@/lib/automacoes/motores/n8n/adaptador";
import { dispararInscritos } from "@/lib/automacoes/disparo";
import {
  concluirPublicacao,
  criarFluxo as criarNoBanco,
  dadosDeDisparo,
  contatosParaInscrever,
  definicaoDoFluxo,
  desinscrever,
  inscreverContatos,
  inscreverSegmento,
  marcarPublicado,
  registrarPublicacao,
  salvarRascunho as salvarNoBanco,
} from "@/lib/automacoes/repositorio";
import { sql } from "@/lib/db";
import { credencialDoMotor } from "@/lib/automacoes/repositorio";
import { instanciasPorId } from "@/lib/uazapi";

/**
 * As credenciais que os nós publicados usam DENTRO do n8n.
 *
 * O CRM guarda só o id (motor_credenciais é um mapa, não um cofre — o segredo
 * mora no motor). Falhar aqui, e com o nome do que falta, é melhor que publicar
 * um workflow cujos nós não autenticam: ele ficaria ativo e erraria calado no
 * primeiro disparo.
 */
async function credenciaisDoMotor() {
  const banco = await credencialDoMotor("n8n", "banco");
  if (!banco) {
    throw new Error(
      "Credencial de banco do n8n não cadastrada. Os nós publicados precisam dela para ler a guarda e gravar o que saiu.",
    );
  }
  // SEM INSTÂNCIA PADRÃO. Cada mensagem carrega o número dela, e é só o mapa
  // por instância que importa — a credencial de cada número vivo, criada e
  // reusada por `credenciaisDaUazapi`.
  //
  // A linha `motor_credenciais` com chave 'uazapi' era a herança da época em
  // que a instância vinha do .env: uma credencial só, com o token daquele
  // momento. Ela deixou de ser lida. Instância apagada e recadastrada trocava o
  // token e aquela linha continuava apontando para o morto — o `401 Invalid
  // token` que derrubou a cadência.
  const porInstancia = await credenciaisDaUazapi();
  const crm = await credencialDoCrm();

  const base = {
    banco: banco.id,
    crmBaseUrl: crm?.baseUrl,
    crmCredencialId: crm?.credencialId,
    porInstancia,
  };

  return { ...base, erroWorkflowId: await garantirWorkflowDeErros(base) };
}

/**
 * A credencial com que o MOTOR chama o CRM de volta, mais o endereço a chamar.
 *
 * Devolve `null` quando o CRM não é alcançável de fora (localhost, sem túnel)
 * ou quando falta CRM_SERVICE_TOKEN — e aí a publicação usa o caminho antigo,
 * com o token da uazapi dentro do n8n.
 *
 * A CHAVE CARREGA A IMPRESSÃO DIGITAL DO TOKEN (`crm:<12 hex>`). É de
 * propósito: a API pública do n8n cria e apaga credencial, mas não atualiza.
 * Com a chave fixa, trocar o CRM_SERVICE_TOKEN deixaria uma credencial velha
 * no cofre e todo envio responderia 401 — exatamente o problema que este
 * caminho veio consertar do lado da uazapi. Com a impressão digital na chave,
 * token novo é credencial nova, e a antiga simplesmente deixa de ser usada.
 */
async function credencialDoCrm(): Promise<
  { baseUrl: string; credencialId: string } | null
> {
  const token = process.env.CRM_SERVICE_TOKEN;
  if (!token) return null;

  const endereco = enderecoDoCrm(await headers());
  if (!endereco.publico) return null;

  const digital = createHash("sha256").update(token).digest("hex").slice(0, 12);
  const chave = `crm:${digital}`;

  const existente = await credencialDoMotor("n8n", chave);
  if (existente) return { baseUrl: endereco.url, credencialId: existente.id };

  const id = await criarCredencial("Chroma · CRM", "httpHeaderAuth", {
    name: "Authorization",
    value: `Bearer ${token}`,
  });
  await sql`
    INSERT INTO motor_credenciais (chave, motor, motor_cred_id, motor_cred_tipo, descricao)
    VALUES (${chave}, 'n8n', ${id}, 'httpHeaderAuth',
            'Token de serviço do CRM: é com ele que o motor pede o envio em /api/automacoes/enviar')
    ON CONFLICT (motor, chave) DO NOTHING`;

  return { baseUrl: endereco.url, credencialId: id };
}

/**
 * Acha (ou cria) o workflow que recolhe os erros de todos os fluxos.
 *
 * Procurar POR NOME é exceção à regra deste arquivo — publicar um fluxo nunca
 * procura por nome, usa o id gravado. Aqui não há id a gravar: o workflow de
 * erros não pertence a nenhum fluxo, e guardar o id exigiria uma tabela para
 * uma linha. O nome tem o prefixo [Chroma], que só este adaptador escreve.
 *
 * FALHA EM SILÊNCIO: se o n8n não responder, a publicação continua sem o
 * `errorWorkflow`. Perder o relatório de erro é ruim; não conseguir publicar
 * por causa dele seria pior.
 */
async function garantirWorkflowDeErros(
  cred: Parameters<typeof workflowDeErros>[0],
): Promise<string | undefined> {
  try {
    const existente = await acharWorkflowPorNome(NOME_WORKFLOW_ERROS);
    if (existente) {
      // Reescreve a cada publicação: assim uma correção na consulta de erro
      // chega ao motor sem ninguém precisar apagar nada à mão.
      await atualizarWorkflow(existente.id, workflowDeErros(cred));
      return existente.id;
    }
    return await criarWorkflow(workflowDeErros(cred));
  } catch {
    return undefined;
  }
}

/**
 * Uma credencial do n8n POR INSTÂNCIA de WhatsApp.
 *
 * É o que faz o número escolhido em cada mensagem valer de verdade. Antes o
 * workflow inteiro saía por uma URL e uma credencial só — a da instância
 * padrão —, e escolher outro número na 5ª mensagem não mudava nada: o campo
 * existia na tela e morria na compilação.
 *
 * O TOKEN NÃO ENTRA NO WORKFLOW. Ele vai para o cofre do n8n via
 * `criarCredencial`, e o que sobra no JSON é o id — a instância do motor é
 * compartilhada com a produção do SprintHub, e workflow é legível por quem tem
 * acesso lá.
 *
 * O id da credencial fica em `motor_credenciais` com a chave
 * `uazapi:<instancia_id>`, porque a API pública do n8n NÃO LISTA credenciais:
 * quem não guardar o id cria uma nova a cada publicação. Criada uma vez, é
 * reusada em toda publicação seguinte.
 */
async function credenciaisDaUazapi() {
  const instancias = await instanciasPorId();
  const mapa = new Map<
    string,
    { credencialId: string; baseUrl: string; numero?: string | null }
  >();

  for (const [id, i] of instancias) {
    const chave = `uazapi:${id}`;
    let cred = await credencialDoMotor("n8n", chave);

    if (!cred) {
      // O header é `token: <TOKEN>`, não Bearer — ver o topo de lib/uazapi.ts.
      const novoId = await criarCredencial(`Chroma · uazapi · ${i.nome}`, "httpHeaderAuth", {
        name: "token",
        value: i.token,
      });
      await sql`
        INSERT INTO motor_credenciais (chave, motor, motor_cred_id, motor_cred_tipo, descricao)
        VALUES (${chave}, 'n8n', ${novoId}, 'httpHeaderAuth',
                ${`Token da instância "${i.nome}" para os nós de envio`})
        ON CONFLICT (motor, chave) DO NOTHING`;
      cred = { id: novoId, nome: chave };
    }

    mapa.set(id, {
      credencialId: cred.id,
      baseUrl: i.baseUrl.replace(/\/+$/, ""),
      // O número vai junto porque é ELE que o nó de envio carrega quando o CRM
      // está na frente: o id desta linha morre se alguém recadastrar o número,
      // o número não.
      numero: i.numero,
    });
  }

  return mapa;
}
import type { DefinicaoFluxo } from "@/lib/automacoes/tipos";
import { registrarSaidaDeFluxo } from "@/lib/historico";

const MOTOR = "n8n";

export type Resultado =
  | { ok: true; mensagem: string }
  | { ok: false; erro: string; noId?: string };

export async function criarFluxo(
  nome: string,
  entidade: "contato" | "oportunidade",
): Promise<string> {
  await exigirModulo("automacoes");
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
  await exigirModulo("automacoes");
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
  await exigirModulo("automacoes");
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

  // Os nós autenticam com CREDENCIAIS do próprio n8n (motor_credenciais guarda
  // só os ids). Antes o CRM_SERVICE_TOKEN ia escrito no header de cada nó, e
  // ficava legível para quem abrisse o workflow na instância compartilhada.
  let workflow;
  try {
    workflow = paraWorkflow(plano, await credenciaisDoMotor());
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
  await exigirModulo("automacoes");
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
  await exigirModulo("automacoes");
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
  await exigirModulo("automacoes");
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


// ── A lista de inscritos ────────────────────────────────────────────────────
//
// Não há tabela de lista: inscrever É criar a execução, e a lista é a leitura
// das execuções vivas (ver inscritosDoFluxo, em lib/automacoes/repositorio.ts).
// Estas duas ações são as duas pontas dela.

/**
 * Busca contatos para o seletor do "inscrever à mão".
 *
 * É leitura, mas mora aqui pelo mesmo motivo de `camposDoContato` em
 * app/funil/actions.ts: precisa ser chamável do cliente enquanto se digita, e a
 * lista de contatos é grande demais para viajar inteira com a página.
 */
export async function buscarContatosParaInscrever(
  fluxoId: string,
  termo: string,
): Promise<{ id: string; nome: string; whatsapp: string | null }[]> {
  await exigirModulo("automacoes");
  const t = termo.trim();
  // Dois caracteres é o piso: com um, a busca devolve um recorte arbitrário de
  // 18 mil linhas e não ajuda ninguém a achar ninguém.
  if (t.length < 2) return [];
  return contatosParaInscrever(fluxoId, t);
}

/**
 * Tira alguém da automação.
 *
 * Cancela a inscrição viva e a espera pendurada nela. A mensagem para de sair
 * porque o workflow publicado consulta o CRM antes de cada envio — a guarda que
 * o adaptador gera (GUARDA_INSCRITO).
 *
 * ⚠ Fluxo publicado ANTES da guarda existir não tem esse nó, e nele a mensagem
 * sai mesmo depois de desinscrever. A tela avisa; republicar resolve.
 */
export async function desinscreverDaAutomacao(
  fluxoId: string,
  entidadeTipo: "contato" | "oportunidade",
  entidadeId: string,
): Promise<Resultado> {
  await exigirModulo("automacoes");
  if (entidadeTipo !== "contato" && entidadeTipo !== "oportunidade") {
    return { ok: false, erro: "Tipo de entidade inválido." };
  }

  const n = await desinscrever(
    fluxoId,
    entidadeTipo,
    entidadeId,
    "Desinscrito na lista da automação",
  );

  revalidatePath("/automacoes");
  revalidatePath(`/automacoes/${fluxoId}`);

  // Zero é o caso de quem já tinha saído — clique repetido, ou duas abas
  // abertas. Não é erro, e tratar como erro faria a tela acusar quem acertou.
  return n > 0
    ? { ok: true, mensagem: "Fora da automação. A próxima mensagem não sai." }
    : { ok: true, mensagem: "Já não estava mais na automação." };
}

/**
 * Põe contatos na automação à mão — a outra ponta da lista.
 *
 * As validações são as mesmas do disparo por segmento, e pelos mesmos motivos:
 * fluxo de contato (inscrever contato em fluxo de oportunidade só falharia lá
 * dentro, no primeiro bloco que pede o negócio), publicado (sem workflow no
 * motor não há o que disparar) e não pausado (pausado, o motor nem reconhece o
 * webhook).
 */
export async function inscreverNaAutomacao(
  fluxoId: string,
  contatoIds: string[],
): Promise<Resultado> {
  await exigirModulo("automacoes");
  const ids = contatoIds.filter(Boolean);
  if (ids.length === 0) return { ok: false, erro: "Escolha ao menos um contato." };

  const fluxo = await dadosDeDisparo(fluxoId);
  if (!fluxo) return { ok: false, erro: "Automação não encontrada." };

  if (fluxo.entidade_alvo !== "contato") {
    return {
      ok: false,
      erro: "Esta automação é de oportunidade — inscreva pelo funil, escolhendo os cards.",
    };
  }
  if (!fluxo.versao_publicada_id || !fluxo.motor_webhook_caminho) {
    return {
      ok: false,
      erro: "Publique a automação antes de inscrever alguém — é a publicação que cria o workflow no motor.",
    };
  }
  if (fluxo.estado === "pausado") {
    return {
      ok: false,
      erro: "Automação pausada — ligue-a antes de inscrever. Pausada, o motor nem reconhece o webhook.",
    };
  }

  const inscritos = await inscreverContatos(
    fluxoId,
    fluxo.versao_publicada_id,
    ids,
  );

  if (inscritos.length === 0) {
    return {
      ok: false,
      erro:
        ids.length === 1
          ? "Esse contato já está nesta automação."
          : "Todos esses contatos já estão nesta automação.",
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
    mensagem: `${entraram} ${entraram === 1 ? "contato entrou" : "contatos entraram"} na automação.${falhou}`,
  };
}

/**
 * Exclui uma automação (ou a cadência de uma etapa).
 *
 * ARQUIVA, não apaga a linha. A diferença importa: `fluxo_execucoes` guarda que
 * mensagens foram para gente real, e `fluxo_versoes` guarda o texto exato que
 * saiu. Um DELETE cascatearia nos dois e apagaria a prova do que foi enviado —
 * exatamente o registro que alguém procura quando um cliente reclama.
 *
 * Como as duas listagens já filtram `arquivado_em IS NULL`, arquivar É sumir da
 * tela. E o índice ux_fluxos_etapa também ignora arquivado, então a etapa fica
 * livre para receber uma cadência nova.
 *
 * O QUE É apagado de verdade é o workflow no n8n: deixá-lo lá significaria um
 * webhook vivo que o CRM não gerencia mais.
 */
export async function excluirFluxo(fluxoId: string): Promise<Resultado> {
  await exigirModulo("automacoes");
  const [fluxo] = await sql`
    SELECT id, nome, motor_workflow_id FROM fluxos WHERE id = ${fluxoId}`;
  if (!fluxo) return { ok: false, erro: "Automação não encontrada." };

  // 1. Ninguém pode continuar andando num fluxo que deixou de existir. Cancela
  //    as inscrições vivas e as esperas penduradas nelas — na ordem, porque é o
  //    predicado da execução viva que seleciona quais esperas congelar.
  await sql`
    UPDATE fluxo_esperas es SET estado = 'cancelada'
    FROM fluxo_execucoes e
    WHERE es.execucao_id = e.id
      AND es.estado IN ('ativa','pausada')
      AND e.fluxo_id = ${fluxoId}
      AND e.estado IN ('pendente','rodando','esperando','pausada')`;

  const canceladas = (await sql`
    UPDATE fluxo_execucoes SET
      estado = 'cancelada',
      erro_msg = 'Automação excluída',
      finalizado_em = now()
    WHERE fluxo_id = ${fluxoId}
      AND estado IN ('pendente','rodando','esperando','pausada')
    RETURNING entidade_tipo, entidade_id`) as unknown as {
    entidade_tipo: "contato" | "oportunidade";
    entidade_id: string;
  }[];

  // A saída entra no histórico de cada lead que estava dentro. AQUI e não
  // depois do UPDATE de baixo: a frase leva o nome do fluxo, e é só uma questão
  // de tempo até "excluir" passar a apagar a linha em vez de arquivá-la.
  //
  // Um fluxo tem um `entidade_alvo` só, então na prática uma das duas listas
  // vem vazia — separá-las é o que mantém a função de registro sem adivinhar
  // em qual tabela procurar cada id.
  for (const tipo of ["contato", "oportunidade"] as const) {
    await registrarSaidaDeFluxo(
      fluxoId,
      tipo,
      canceladas.filter((c) => c.entidade_tipo === tipo).map((c) => c.entidade_id),
      "Automação excluída",
    );
  }

  // 2. O workflow no motor. Falhar aqui NÃO impede o arquivamento: um workflow
  //    que sobrou é ruído visível no n8n; um fluxo que não arquiva porque o
  //    motor está fora do ar é uma tela que não obedece.
  let avisoMotor = "";
  if (fluxo.motor_workflow_id) {
    try {
      await apagarWorkflow(fluxo.motor_workflow_id as string);
    } catch (e) {
      avisoMotor = ` O workflow no n8n não foi apagado (${
        e instanceof Error ? e.message : String(e)
      }) — apague à mão.`;
    }
  }

  await sql`
    UPDATE fluxos SET
      arquivado_em = now(),
      estado = 'arquivado',
      motor_workflow_id = NULL,
      data_atualizacao = now()
    WHERE id = ${fluxoId}`;

  revalidatePath("/automacoes");
  revalidatePath("/");

  const n = canceladas.length;
  return {
    ok: true,
    mensagem: `"${fluxo.nome}" excluída.${
      n ? ` ${n} ${n === 1 ? "inscrição foi cancelada" : "inscrições foram canceladas"}.` : ""
    }${avisoMotor}`,
  };
}
