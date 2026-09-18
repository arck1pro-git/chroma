import { NextRequest } from "next/server";
import { autorizado, naoAutorizado } from "@/lib/automacoes/servico";
import { enviarMidia, enviarTexto, instanciaExataPorNumero } from "@/lib/uazapi";
import { paraEnvio } from "@/lib/documentos";
import { soDigitos } from "@/lib/telefone";

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
  const texto = String(corpo.texto ?? "").slice(0, MAX_TEXTO).trim();
  const numeroOrigem = soDigitos(String(corpo.numero_origem ?? ""));
  // O anexo da mensagem, quando há. Só o id chega aqui — os bytes nunca saíram
  // do CRM, e é por isso que trocar o arquivo não exige republicar a cadência.
  const documentoId = String(corpo.documento_id ?? "").trim();

  if (!para) return Response.json({ erro: "destinatário sem número" }, { status: 400 });
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
  if (!numeroOrigem) {
    return Response.json(
      { erro: "mensagem sem número de origem: escolha o número nesta mensagem da cadência" },
      { status: 400 },
    );
  }

  // Busca EXATA, pelos últimos 8 dígitos (lib/telefone.ts): o que a uazapi
  // devolve e o que gravamos nem sempre concordam sobre o nono dígito e o DDI.
  // Não casou = o número saiu do CRM depois de a cadência ser publicada.
  const instancia = await instanciaExataPorNumero(numeroOrigem);
  if (!instancia) {
    return Response.json(
      {
        erro: `o número ${numeroOrigem} não está cadastrado em Configurações — nada foi enviado`,
      },
      { status: 400 },
    );
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
        para,
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
      );
    } else {
      r = await enviarTexto(para, texto, instancia);
    }

    // `text` vai no retorno porque o nó que registra a mensagem no motor lê o
    // texto DAQUI, não do que ele mesmo mandou — é o que garante que o
    // histórico guarde exatamente o que saiu.
    return Response.json({
      ...r,
      text: texto,
      documento_id: documentoId || null,
      numero_instancia: instancia.numero,
      instancia: instancia.nome,
    });
  } catch (e) {
    // 502 e não 200: o nó tem que FALHAR no motor para o ramo morrer ali e o
    // workflow de erros marcar a execução. Responder 200 com `{ erro }` faria a
    // cadência seguir para a próxima mensagem como se esta tivesse saído.
    return Response.json(
      { erro: e instanceof Error ? e.message : "falha ao enviar" },
      { status: 502 },
    );
  }
}
