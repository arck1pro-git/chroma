// Webhook da uazapi: é por aqui que as mensagens da não-oficial entram e
// centralizam no Chroma. Quem chama esta URL é o n8n, não a uazapi direto — a
// instância arckwpp aceita UM webhook só e ele é do SprintHub (confirmado por
// teste: POST /webhook com URL nova devolve o mesmo id, ou seja, sobrescreve).
// Então o n8n recebe o evento e reenvia pros dois. O corpo que chega aqui é o
// mesmo que a uazapi mandou, cru.
//
// SEGURANÇA: a rota é pública. O segredo vai na querystring da URL cadastrada no
// n8n (…/api/uazapi/webhook?secret=XXX) e é conferido aqui. Sem bater, 401.
//
// MULTI-INSTÂNCIA: pode existir mais de um número nosso mandando evento pra essa
// mesma rota (hoje só a instância de teste; a arckwpp compartilhada com o
// SprintHub pode entrar depois). Pra saber qual instância recebeu SEM depender
// de campo nenhum do payload da uazapi (formato ainda não confirmado — ver nota
// abaixo), o número vai também na querystring: …&numero=5547999999999. É a gente
// quem carimba isso ao cadastrar o webhook de cada instância, não a uazapi.
//
// ⚠ FORMATO DO PAYLOAD: o parsing abaixo cobre os nomes de campo prováveis do
// uazapiGO (deduzidos da resposta do /send/text), mas o envelope exato só
// confirmamos capturando um evento real. Por isso todo evento é logado cru e a
// rota SEMPRE responde 200 — se o formato divergir, a gente vê no log e ajusta
// sem a uazapi ficar reenviando em loop.
import { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { soDigitos, chaveTelefone } from "@/lib/telefone";
import { midiaDoEvento, baixarPendentesEmSegundoPlano } from "@/lib/midia";

// ── Extração tolerante ──────────────────────────────────────────────────────
// Aceita o evento solto ou dentro de { message } / { data }.
function corpoDoEvento(payload: any): any {
  return payload?.message ?? payload?.data ?? payload;
}
function tipoDoEvento(payload: any): string {
  return payload?.EventType ?? payload?.event ?? payload?.type ?? "";
}
function ehRecibo(ev: any, tipo: string): boolean {
  // messages_update = mudança de status (entregue/lido) de mensagem já existente.
  return /update|ack|status|receipt/i.test(tipo) && !ev?.text;
}
// Mapeia o status da uazapi pro nosso enum de mensagens.status.
function statusRecibo(ev: any): "entregue" | "lido" | null {
  const s = String(ev?.status ?? ev?.ack ?? "").toLowerCase();
  if (/read|lido|3|4/.test(s)) return "lido";
  if (/deliver|entreg|receiv|2/.test(s)) return "entregue";
  return null;
}

export async function POST(req: NextRequest) {
  // 1. Segredo.
  const secret = req.nextUrl.searchParams.get("secret");
  if (!process.env.UAZAPI_WEBHOOK_SECRET || secret !== process.env.UAZAPI_WEBHOOK_SECRET) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  // Qual dos nossos números recebeu. null = URL antiga sem o parâmetro (ou
  // atendimento fora do fluxo de webhook) — o atendimento cai sem instância em
  // vez de estourar.
  const numeroInstancia = soDigitos(req.nextUrl.searchParams.get("numero") ?? "") || null;

  const payload = await req.json().catch(() => null);
  if (!payload) return Response.json({ ok: true });

  // Log cru pra confirmar/ajustar o formato. Removível depois do primeiro
  // evento real capturado.
  console.log("[uazapi webhook]", JSON.stringify(payload));

  try {
    const tipo = tipoDoEvento(payload);
    const ev = corpoDoEvento(payload);

    // ── history: NÃO é mensagem nova ────────────────────────────────────────
    // Toda vez que a instância reconecta, a uazapi despeja o histórico do
    // aparelho nesse evento. Sem este corte, uma reconexão vira enxurrada de
    // "mensagem nova" com data de hoje. Backfill, se um dia quisermos, é rotina
    // própria e controlada — não o caminho do tempo real.
    if (/history/i.test(tipo)) return Response.json({ ok: true });

    // ── Recibo de entrega/leitura ───────────────────────────────────────────
    if (ehRecibo(ev, tipo)) {
      const idExterno: string | undefined = ev?.messageid ?? ev?.id;
      const novo = statusRecibo(ev);
      if (idExterno && novo) {
        // Só "avança" o status — nunca regride de 'lido' pra 'entregue'.
        const anteriores =
          novo === "lido" ? ["enviado", "entregue"] : ["enviado"];
        await sql`
          UPDATE mensagens SET status = ${novo}
          WHERE id_externo = ${idExterno}
            AND status = ANY(${anteriores})`;
      }
      return Response.json({ ok: true });
    }

    // ── Mensagem (recebida OU enviada pelo aparelho) ─────────────────────────
    // fromMe = saiu do NOSSO número. Antes isso era descartado, e era justamente
    // metade da conversa sumindo: o que você responde pelo celular não aparecia
    // no Chroma. Agora vira mensagem 'agente' sem autor (ninguém digitou no CRM).
    //
    // O que continua não chegando aqui é o que sai via API, porque o webhook da
    // instância tem excludeMessages: ["wasSentByApi"] — e ele é compartilhado com
    // o SprintHub, que depende desse filtro pra não entrar em loop. Envio feito
    // pelo próprio Chroma já é gravado na hora do envio (app/chat/actions.ts),
    // então o buraco real é só o que o SprintHub dispara por API.
    const fromMe: boolean = ev?.fromMe === true;

    const texto: string | undefined =
      ev?.text ?? ev?.message ?? ev?.body ?? ev?.content?.text;

    // Mídia. Antes daqui havia um `if (!texto) return` — áudio, foto e
    // documento de cliente chegavam e eram DESCARTADOS. Agora a mensagem entra
    // com o tipo certo e o arquivo é enfileirado (lib/midia.ts).
    const midia = midiaDoEvento(ev ?? {});

    // Sem texto E sem mídia não é mensagem que a gente saiba registrar —
    // continua saindo em silêncio, como antes.
    if (!texto && !midia) return Response.json({ ok: true });

    // A legenda da foto ocupa o lugar do texto: é o que a pessoa escreveu.
    const corpo = texto ?? midia?.legenda ?? "";

    // A conversa é sempre o chatid: na recebida ele é o contato, na enviada é o
    // destinatário. Usar `sender` no fromMe daria o NOSSO próprio número.
    const chatid: string = ev?.chatid ?? ev?.sender ?? "";
    // Grupo (@g.us) não vira atendimento: o "contato" seria o grupo inteiro.
    if (/@g\.us$/i.test(chatid)) return Response.json({ ok: true });

    const idExterno: string | undefined = ev?.messageid ?? ev?.id;
    const numero = soDigitos(chatid);
    if (!numero) return Response.json({ ok: true });
    // No fromMe, senderName é o NOSSO nome — não serve pra nomear o contato.
    const nomePush: string = fromMe
      ? (ev?.chatName ?? numero)
      : (ev?.senderName ?? ev?.pushName ?? numero);

    // Casa pelo fim do número (últimos 8 dígitos) pra tolerar o nono dígito.
    const fim8 = chaveTelefone(numero).slice(-8);

    const [contatoExistente] = await sql`
      SELECT id FROM contatos
      WHERE regexp_replace(whatsapp, '\D', '', 'g') LIKE ${"%" + fim8}
      LIMIT 1`;

    let contatoId: string;
    if (contatoExistente) {
      contatoId = contatoExistente.id;
    } else {
      // Contato novo, nascido do WhatsApp. Nome = pushName; número cru.
      const [novoContato] = await sql`
        INSERT INTO contatos (nome, whatsapp)
        VALUES (${nomePush}, ${numero})
        RETURNING id`;
      contatoId = novoContato.id;
    }

    // Atendimento aberto/na fila do MESMO PAR (contato, instância), ou cria um
    // novo na fila. Não basta casar por contato: se esse contato também falar
    // com outro número nosso, é outra conversa. `IS NOT DISTINCT FROM` em vez de
    // `=` porque numero_instancia pode ser NULL dos dois lados (evento sem o
    // parâmetro), e NULL = NULL nunca é true em SQL — perderia o casamento.
    //
    // Vale também pro fromMe: conversa iniciada pelo celular tem que aparecer
    // no Chroma, e 'na_fila' é o único status sem dono que a tela lista (um
    // 'aberto' com responsavel_id NULL não cai em nenhuma das três abas).
    const [aberto] = await sql`
      SELECT id FROM atendimentos
      WHERE contato_id = ${contatoId}
        AND numero_instancia IS NOT DISTINCT FROM ${numeroInstancia}
        AND status <> 'encerrado'
      ORDER BY data_criacao DESC
      LIMIT 1`;

    let atendimentoId: string;
    if (aberto) {
      atendimentoId = aberto.id;
    } else {
      const [novoAt] = await sql`
        INSERT INTO atendimentos (contato_id, status, canal, numero_instancia)
        VALUES (${contatoId}, 'na_fila', 'whatsapp', ${numeroInstancia})
        RETURNING id`;
      atendimentoId = novoAt.id;
    }

    // ON CONFLICT: o mesmo evento pode chegar duas vezes (retentativa da uazapi,
    // reenvio do n8n) e a linha já pode existir se foi o Chroma que enviou. O
    // índice é PARCIAL (id_externo IS NOT NULL), então o predicado tem que
    // aparecer aqui pro Postgres inferir qual índice usar.
    // midia_estado: 'pendente' só quando há arquivo para buscar. Localização e
    // contato têm tipo próprio mas nada para baixar, e ficariam presos numa
    // fila que nunca sai — daí o teste ser pela URL, não pelo tipo.
    const estadoMidia = midia?.url ? "pendente" : "ausente";

    const inseridas = await sql`
      INSERT INTO mensagens (
        atendimento_id, origem, texto, status, id_externo,
        tipo, midia_url_origem, midia_mime, midia_nome,
        midia_tamanho, midia_duracao, midia_estado)
      VALUES (
        ${atendimentoId},
        ${fromMe ? "agente" : "contato"},
        ${corpo},
        ${fromMe ? "enviado" : "recebido"},
        ${idExterno ?? null},
        ${midia?.tipo ?? "texto"},
        ${midia?.url ?? null},
        ${midia?.mime ?? null},
        ${midia?.nome ?? null},
        ${midia?.tamanho ?? null},
        ${midia?.duracao ?? null},
        ${estadoMidia})
      ON CONFLICT (id_externo) WHERE id_externo IS NOT NULL DO NOTHING
      RETURNING id`;

    // Duplicata: não mexe no data_atualizacao, senão a conversa pula pro topo
    // da lista sem nada ter acontecido.
    if (inseridas.length > 0) {
      await sql`
        UPDATE atendimentos SET data_atualizacao = now() WHERE id = ${atendimentoId}`;

      // Solta a baixa do arquivo sem segurar a resposta: a uazapi reenvia se
      // demorarmos, e a URL dela expira se esperarmos um cron. Ver
      // baixarPendentesEmSegundoPlano em lib/midia.ts.
      if (estadoMidia === "pendente") baixarPendentesEmSegundoPlano();
    }

    return Response.json({ ok: true });
  } catch (e) {
    // Nunca estoura pra uazapi (evita reenvio em loop). Loga e segue.
    console.error("[uazapi webhook] erro ao processar:", e);
    return Response.json({ ok: true });
  }
}
