import { NextRequest } from "next/server";
import { autorizado, naoAutorizado } from "@/lib/automacoes/servico";
import { enviarMidia, enviarTexto, instanciaExataPorNumero, type Instancia } from "@/lib/uazapi";
import { paraEnvio } from "@/lib/documentos";
import { sql } from "@/lib/db";
import { soDigitos } from "@/lib/telefone";
import { abrirConversaDaCadencia, registrarMensagemDaCadencia } from "@/lib/automacoes/conversa-da-cadencia";
import { confirmarEnvio, marcarErro } from "@/lib/conversa-envio";
import { USUARIO_RESPONSAVEL } from "@/lib/automacoes/saida";
import { dadosDoLeadDaExecucao, responsavelDaExecucao } from "@/lib/automacoes/aviso-equipe";
import { reuniaoDaExecucao } from "@/lib/agenda";
import { preencherReuniao, temVariavelDeReuniao, variaveisDaReuniao } from "@/lib/automacoes/reuniao-no-texto";
import { ehUuid } from "@/lib/validacao";

// O CRM NA FRENTE DO ENVIO. O motor não fala mais com a uazapi: ele diz "manda
// este texto, por este número", e quem tem a credencial é quem sempre teve — o
// CRM.
//
// POR QUE A VOLTA DO CALLBACK, se a arquitetura tinha saído dele. O motivo é
// concreto e custou dois dias de "não funciona": a credencial da uazapi vivia
// COPIADA no cofre do n8n, e cópia envelhece. Apagar a instância no CRM e criar
// outra — hoje um clique — troca o token, e o workflow publicado continuava
// mandando o token morto:
//
//   401 {"code":401,"message":"Invalid token."}
//
// Republicar resolvia, mas ninguém sabe que precisa republicar: o sintoma
// aparece dias depois, no primeiro lead que entra na cadência.
//
// O NÚMERO É O IDENTIFICADOR, e é isso que torna o desenho estável. Token muda,
// instância é recriada, a sessão do WhatsApp cai e volta — o número, não. O
// fluxo publicado guarda o número; a credencial é resolvida AQUI, no instante
// do envio, lendo `instancias_uazapi`. Nada a republicar.
//
// O que isso reintroduz: o motor precisa alcançar o CRM. É por isso que a
// publicação só monta este caminho quando o endereço do CRM é público (ver
// app/automacoes/acoes.ts); em localhost ela mantém o envio direto de antes.

export const dynamic = "force-dynamic";

/** Teto de texto. Mensagem de WhatsApp não chega perto disso. */
const MAX_TEXTO = 8000;

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return naoAutorizado();

  let corpo: Record<string, unknown>;
  try {
    corpo = await req.json();
  } catch {
    return Response.json({ erro: "corpo inválido" }, { status: 400 });
  }

  const para = soDigitos(String(corpo.para ?? ""));
  let texto = String(corpo.texto ?? "").slice(0, MAX_TEXTO).trim();

  // LEMBRETE DE REUNIÃO (2026-10-20). A mensagem que fala da reunião ([[reuniao_x]]
  // no texto) ou que foi marcada para um instante dela (instante_reuniao) só sai
  // se a reunião existe, está de pé e o lembrete não chegou atrasado. Pular não
  // é erro: o motor segue para o próximo passo, e a resposta diz por quê.
  const instanteReuniao = typeof corpo.instante_reuniao === "number" ? corpo.instante_reuniao : null;
  if (temVariavelDeReuniao(texto) || instanteReuniao !== null) {
    const reuniao = await reuniaoDaExecucao(String(corpo.execucao_id ?? "")).catch((e) => {
      console.error("[automacoes/enviar] não leu a reunião:", e);
      return undefined;
    });
    // Falha ao ler (banco ou Google fora): erro, para o motor registrar —
    // pular em silêncio esconderia um lembrete que deveria ter saído.
    if (reuniao === undefined) return Response.json({ erro: "não foi possível ler a reunião — nada foi enviado" }, { status: 502 });
    if (!reuniao) return Response.json({ ok: true, pulado: "sem reunião de pé para esta oportunidade" });
    // Atrasado: o "1 dia antes" de uma reunião marcada para daqui a 5 horas, ou
    // o lembrete que o motor só soltou bem depois da hora. 15 min de folga.
    if (instanteReuniao !== null && Date.now() > Date.parse(reuniao.inicio) + (instanteReuniao + 15) * 60_000) {
      return Response.json({ ok: true, pulado: "passou da hora deste lembrete" });
    }
    const valores = variaveisDaReuniao(reuniao, new Date());
    if (temVariavelDeReuniao(texto) && /\[\[reuniao_link\]\]/.test(texto) && !valores.reuniao_link) {
      return Response.json({ erro: "a reunião não tem link do Meet — nada foi enviado" }, { status: 400 });
    }
    texto = preencherReuniao(texto, valores);
  }
  const numeroOrigem = soDigitos(String(corpo.numero_origem ?? ""));
  const peloResponsavel = corpo.pelo_responsavel === true;
  // O anexo da mensagem, quando há. Só o id chega aqui — os bytes nunca saíram
  // do CRM, e é por isso que trocar o arquivo não exige republicar a cadência.
  const documentoId = String(corpo.documento_id ?? "").trim();
  // NOTIFICAÇÃO PARA O TIME. Quando vem, o destino não é o lead: é o número de
  // quem trabalha aqui (usuarios.whatsapp). O bloco "Enviar notificação" da
  // cadência manda este campo em vez de `para`.
  const usuarioId = String(corpo.usuario_id ?? "").trim();

  // O NÚMERO DO USUÁRIO É RESOLVIDO AQUI, não no workflow publicado — mesmo
  // motivo do número de origem: telefone de gente muda, e um número copiado
  // para dentro do n8n no dia da publicação vira aviso indo para o celular
  // errado semanas depois, sem nada no CRM dizendo isso.
  let destino = para;
  let avisado: string | null = null;
  // O texto que sai: para o lead, o da coluna; para o time, o da coluna MAIS os
  // dados do lead (nome, WhatsApp, valor, funil, etapa, link da conversa) — o
  // mesmo padrão do aviso de "lead quer contato" da IA. Ver aviso-equipe.ts.
  let textoFinal = texto;
  if (usuarioId === USUARIO_RESPONSAVEL) {
    // O responsável da oportunidade NESTE instante, resolvido pela execução.
    const r = await responsavelDaExecucao(String(corpo.execucao_id ?? ""));
    if ("erro" in r) return Response.json({ erro: `${r.erro} — nada foi enviado` }, { status: 400 });
    if (!r.whatsapp) {
      return Response.json(
        { erro: `${r.nome} (responsável) não tem WhatsApp cadastrado em Configurações → Usuários — nada foi enviado` },
        { status: 400 },
      );
    }
    destino = soDigitos(r.whatsapp);
    avisado = r.nome;
  } else if (usuarioId) {
    if (!ehUuid(usuarioId)) {
      return Response.json({ erro: "usuário inválido" }, { status: 400 });
    }
    const [u] = await sql`
      SELECT nome, whatsapp, ativo FROM usuarios WHERE id = ${usuarioId}`;
    if (!u) {
      return Response.json(
        { erro: "a pessoa a notificar não existe mais — nada foi enviado" },
        { status: 400 },
      );
    }
    if (!u.whatsapp) {
      return Response.json(
        {
          erro: `${u.nome} não tem WhatsApp cadastrado em Configurações → Usuários — nada foi enviado`,
        },
        { status: 400 },
      );
    }
    // Desativado ainda RECEBE: desligar o acesso ao CRM não é o mesmo que
    // desligar o telefone, e engolir o aviso em silêncio deixaria uma cadência
    // avisando o vazio. Quem não deve mais ser avisado sai do bloco.
    destino = soDigitos(u.whatsapp as string);
    avisado = u.nome as string;
  }
  if (usuarioId) {
    // Falhar aqui não segura o aviso: sai só o texto da coluna.
    const dados = await dadosDoLeadDaExecucao(String(corpo.execucao_id ?? "")).catch((e) => {
      console.error("[automacoes/enviar] aviso sem os dados do lead:", e);
      return [] as string[];
    });
    if (dados.length) textoFinal = [texto, "", ...dados].join("\n").trim();
  }

  if (!destino) return Response.json({ erro: "destinatário sem número" }, { status: 400 });
  // Com anexo, texto vazio é legítimo: manda só o arquivo. Sem anexo continua
  // sendo erro — uma mensagem sem texto e sem arquivo não é mensagem.
  if (!texto && !documentoId) {
    return Response.json({ erro: "texto vazio" }, { status: 400 });
  }

  // SEM NÚMERO DE ORIGEM, NÃO ENVIA. Não existe "manda pela padrão" aqui.
  //
  // A regra é do negócio, não do código: uma cadência sai pelo número que
  // alguém escolheu para ela. Cair numa instância qualquer faz o lead receber
  // mensagem de um remetente que ele não conhece — e ninguém vai descobrir
  // isso olhando o CRM, só o cliente do outro lado, semanas depois.
  if (!numeroOrigem && !peloResponsavel) {
    return Response.json(
      { erro: "mensagem sem número de origem: escolha o número nesta mensagem da cadência" },
      { status: 400 },
    );
  }

  // Busca EXATA, pelos últimos 8 dígitos (lib/telefone.ts): o que a uazapi
  // devolve e o que gravamos nem sempre concordam sobre o nono dígito e o DDI.
  // Não casou = o número saiu do CRM depois de a cadência ser publicada.
  let instancia: Instancia | null;
  if (peloResponsavel) {
    const execucaoId = String(corpo.execucao_id ?? "");
    if (!ehUuid(execucaoId)) {
      return Response.json({ erro: "execução inválida para envio pelo responsável" }, { status: 400 });
    }
    // A execução identifica UMA oportunidade. Não inferir pelo contato, que
    // pode ter várias oportunidades com responsáveis diferentes.
    const [linha] = await sql`
      SELECT o.id AS oportunidade_id, u.id AS usuario_id, u.nome AS responsavel,
             i.id, i.nome, i.base_url, i.token, i.numero
      FROM fluxo_execucoes e
      LEFT JOIN oportunidades o ON e.entidade_tipo = 'oportunidade' AND o.id = e.entidade_id
      LEFT JOIN usuarios u ON u.id = o.responsavel_id
      LEFT JOIN instancias_uazapi i ON i.id = u.instancia_id
      WHERE e.id = ${execucaoId}`;
    const erro = !linha?.oportunidade_id
      ? "a execução não tem uma oportunidade válida"
      : !linha.usuario_id
        ? "a oportunidade está sem responsável"
        : !linha.id
          ? `${linha.responsavel} está sem instância de WhatsApp vinculada em Configurações → Usuários`
          : !linha.numero
            ? `o WhatsApp vinculado a ${linha.responsavel} ainda não foi pareado`
            : null;
    if (erro) return Response.json({ erro: `${erro} — nada foi enviado` }, { status: 400 });
    instancia = {
      id: linha.id, nome: linha.nome, baseUrl: linha.base_url,
      token: linha.token, numero: linha.numero,
    };
  } else {
    instancia = await instanciaExataPorNumero(numeroOrigem);
  }
  if (!instancia) {
    return Response.json(
      {
        erro: `o número ${numeroOrigem} não está cadastrado em Configurações — nada foi enviado`,
      },
      { status: 400 },
    );
  }

  // A MENSAGEM É GRAVADA AQUI, pelo CRM, ANTES de sair (2026-10-15). Quem
  // gravava era um nó Postgres do workflow, que recebia o texto numa lista
  // separada por vírgula (queryReplacement do n8n): toda mensagem com vírgula
  // deslocava os parâmetros, o nó falhava — e desde 2026-09-18 nenhuma
  // mensagem de cadência ficou no CRM, e as cadências paravam depois da 1ª
  // (o nó quebrado encerrava o workflow). Gravando aqui, vale para os
  // workflows já publicados sem republicar nada.
  //
  // Antes do envio, como o chat faz (lib/conversa-envio.ts): a linha nasce
  // 'pendente' e o id dela vai como track_id; o eco do webhook casa com ela em
  // vez de virar mensagem "do celular" — que para a IA é gente da equipe
  // assumindo a conversa, e a calaria por uma hora.
  //
  // Notificação para o time (usuarioId) não é conversa com o lead: não grava.
  let atendimentoId: string | null = null;
  let mensagemId: string | null = null;
  if (!usuarioId) {
    try {
      atendimentoId = await abrirConversaDaCadencia({
        execucaoId: String(corpo.execucao_id ?? ""),
        numeroLead: destino,
        numeroInstancia: soDigitos(instancia.numero ?? "") || null,
      });
      if (atendimentoId) {
        mensagemId = await registrarMensagemDaCadencia({ atendimentoId, texto, documentoId });
      }
    } catch (e) {
      // Registro não derruba envio: a cadência manda do mesmo jeito.
      console.error("[automacoes/enviar] a mensagem vai sair sem ficar registrada:", e);
    }
  }

  try {
    let r;
    if (documentoId) {
      // O arquivo é lido AGORA, do disco, e vai em base64 na chamada à uazapi
      // (ver `paraEnvio` em lib/documentos.ts). Documento apagado da biblioteca
      // entre a publicação e o disparo cai aqui, e é 400: mandar só a legenda,
      // sem o arquivo que ela descreve, é pior que não mandar — o lead receberia
      // "segue em anexo a tabela" sem anexo nenhum.
      const doc = await paraEnvio(documentoId);
      if (!doc) {
        return Response.json(
          {
            erro: `o documento anexado a esta mensagem não existe mais na biblioteca — nada foi enviado`,
          },
          { status: 400 },
        );
      }
      r = await enviarMidia(
        destino,
        doc.base64,
        {
          tipo: doc.tipo,
          // O texto da coluna vira a LEGENDA do arquivo: um envio só, uma
          // notificação só no celular do lead.
          texto,
          arquivoNome: doc.arquivoNome,
          mime: doc.mime,
        },
        instancia,
        mensagemId ?? undefined,
      );
    } else {
      r = await enviarTexto(destino, textoFinal, instancia, mensagemId ?? undefined);
    }

    // Saiu: a linha recebe o id do WhatsApp e vira 'enviado'. Falhar aqui NÃO
    // derruba a resposta — um 502 agora faria o motor achar que não saiu e
    // tentar de novo, e o lead receberia em dobro por um problema de registro.
    if (mensagemId) {
      try {
        await confirmarEnvio(mensagemId, r?.messageid ?? null);
        await sql`UPDATE atendimentos SET data_atualizacao = now() WHERE id = ${atendimentoId}`;
      } catch (e) {
        console.error("[automacoes/enviar] saiu, mas não confirmou a linha:", mensagemId, e);
      }
    }

    // SEM `text` NO RETORNO, de propósito. O nó de registro dos workflows já
    // publicados lia o texto daqui e o passava ao Postgres numa lista separada
    // por vírgula — era a vírgula da mensagem que quebrava tudo. Sem o texto, o
    // nó antigo recebe '' (só ids, sem vírgula), grava o passo e a cadência
    // segue para a próxima mensagem; a linha dele em `mensagens` esbarra no
    // id_externo desta (ON CONFLICT DO NOTHING) e não duplica.
    return Response.json({
      ...r,
      atendimento_id: atendimentoId,
      mensagem_id: mensagemId,
      documento_id: documentoId || null,
      // Quem foi avisado, quando é notificação. O nó que registra lê daqui
      // para escrever no histórico do lead.
      avisado,
      numero_instancia: instancia.numero,
      instancia: instancia.nome,
    });
  } catch (e) {
    // A linha fica na conversa como 'erro', com o motivo: quem abre o chat vê
    // que a cadência tentou e não saiu.
    if (mensagemId) await marcarErro(mensagemId, e).catch(() => {});
    // 502 e não 200: o nó tem que FALHAR no motor para o ramo morrer ali e o
    // workflow de erros marcar a execução. Responder 200 com `{ erro }` faria a
    // cadência seguir para a próxima mensagem como se esta tivesse saído.
    return Response.json(
      { erro: e instanceof Error ? e.message : "falha ao enviar" },
      { status: 502 },
    );
  }
}
