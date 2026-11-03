// O RETORNO COMBINADO da IA (lib/ia/retorno.ts, 2026-11-03) contra o banco
// DEV, com a Anthropic falsa num servidor local (node:http):
//
//   node --env-file=.env scripts/jiti.mjs scripts/testar-ia-retorno.ts
//
// Confere:
//   1. a ferramenta: o que o modelo manda (formato, data que não existe, hora
//      passada, longe demais) e a linha do histórico, que volta a ser lida;
//   2. a IA que atende (responderComIa): com a ação marcada, o modelo recebe
//      agendar_retorno, o resultado "Anotado" volta para ele escrever a
//      confirmação, e o combinado só é gravado se a confirmação saiu;
//   3. a rodada (retomarConversas): o retorno vencido é escrito pela IA com a
//      instrução do retorno; o futuro fica; o cliente que voltou a falar e o
//      contato fora da IA fecham sem modelo; e quem tem retorno marcado não
//      recebe a retomada por silêncio, que o vizinho sem retorno recebe.
//
// TRAVA DE AMBIENTE: com WHATSAPP_SO_PARA ativa (o .env do dev), todo envio é
// recusado antes da rede, e o teste NÃO a contorna; sem ela, o teste nem
// começa. O envio é conferido pela tentativa (mensagem com o erro "bloqueado")
// e pela linha que fecha o combinado. Só o endereço da Anthropic aponta para o
// servidor local, dentro deste processo.
//
// MARCA: IA e contatos "seed-teste-retorno…", números 55009008820…, apagados
// no finally, só pela marca.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { sql } from "@/lib/db";
import { diaEmBrasilia } from "@/lib/agenda";
import { responderComIa } from "@/lib/ia/atendente";
import { retomarConversas } from "@/lib/ia/retomada";
import {
  conferirRetorno,
  fecharRetorno,
  MARCA_FIM,
  quandoDoRetorno,
  registrarRetorno,
  retornoMarcado,
} from "@/lib/ia/retorno";

const MARCA = "seed-teste-retorno";
const NUM_INSTANCIA = "5500900882000";
const AMANHA_15 = `${diaEmBrasilia(new Date(Date.now() + 86_400_000))} 15:00`;
/** A mensagem do cliente que faz a Anthropic falsa pedir o agendar_retorno. */
const GATILHO = "agora não posso, me chama amanhã às 15h";

let falhas = 0;
function conferir(ok: boolean, texto: string, extra = "") {
  if (!ok) falhas++;
  console.log(`${ok ? "ok   " : "FALHA"} ${texto}${extra ? ` → ${extra}` : ""}`);
}

// ── A Anthropic falsa ───────────────────────────────────────────────────────
type Chamada = { usuario: string; ferramentas: string[]; resultado: string | null };
const chamadas: Chamada[] = [];
const servidor = createServer((req, res) => {
  let corpo = "";
  req.on("data", (c) => (corpo += c));
  req.on("end", () => {
    const b = JSON.parse(corpo || "{}");
    const primeira = b.messages?.[0]?.content;
    const usuario = typeof primeira === "string" ? primeira : "";
    const ferramentas = ((b.tools ?? []) as Array<{ name: string }>).map((t) => t.name);
    const ultima = b.messages?.at(-1)?.content;
    const resultado = Array.isArray(ultima)
      ? ((ultima as Array<{ type: string; content?: string }>).find((c) => c.type === "tool_result")?.content ?? null)
      : null;
    chamadas.push({ usuario, ferramentas, resultado });
    let content: unknown[] = [{ type: "text", text: "Oi! Como combinamos, voltando a falar com você. Podemos seguir?" }];
    let stop = "end_turn";
    if (b.messages.length === 1 && ferramentas.includes("agendar_retorno") && usuario.includes(GATILHO)) {
      content = [{ type: "tool_use", id: "toolu_teste", name: "agendar_retorno", input: { quando: AMANHA_15, pedido: "me chama amanhã às 15h" } }];
      stop = "tool_use";
    } else if (resultado) {
      content = [{ type: "text", text: "Combinado! Te chamo amanhã às 15h." }];
    }
    res.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({ id: "msg_teste", type: "message", role: "assistant", model: b.model, content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }),
    );
  });
});

// ── O cenário ───────────────────────────────────────────────────────────────
let iaId = "";
let seq = 0;

async function contato(sufixo: string, comIa = true) {
  seq += 1;
  const [c] = await sql`
    INSERT INTO contatos (nome, whatsapp, ia, ia_id)
    VALUES (${`${MARCA} ${sufixo}`}, ${`55009008820${String(seq).padStart(2, "0")}`}, ${comIa}, ${comIa ? iaId : null})
    RETURNING id`;
  const [a] = await sql`
    INSERT INTO atendimentos (contato_id, status, canal, numero_instancia, data_atualizacao)
    VALUES (${c.id}, 'aberto', 'whatsapp', ${NUM_INSTANCIA}, now()) RETURNING id`;
  return { contatoId: c.id as string, atendimentoId: a.id as string };
}

async function mensagem(atendimentoId: string, deQuem: "cliente" | "ia", texto: string, minutosAtras: number) {
  const [m] = await sql`
    INSERT INTO mensagens (atendimento_id, origem, enviada_por, texto, status, data_criacao)
    VALUES (${atendimentoId}, ${deQuem === "cliente" ? "contato" : "agente"}, ${deQuem === "ia" ? "ia" : null}, ${texto},
            ${deQuem === "cliente" ? "recebido" : "enviado"}, now() - ${`${minutosAtras} minutes`}::interval)
    RETURNING id`;
  return m.id as string;
}

/** Um combinado gravado há `minutosAtras`, vencendo `venceEmMin` a partir de agora (negativo = já venceu). */
async function combinado(contatoId: string, venceEmMin: number, minutosAtras: number) {
  await registrarRetorno(contatoId, null, { quando: new Date(Date.now() + venceEmMin * 60_000), pedido: "teste" });
  await sql`
    UPDATE historico SET data_criacao = now() - ${`${minutosAtras} minutes`}::interval
     WHERE id = (SELECT id FROM historico WHERE contato_id = ${contatoId} ORDER BY data_criacao DESC LIMIT 1)`;
}

const linhas = async (contatoId: string) =>
  (await sql`SELECT descricao FROM historico WHERE contato_id = ${contatoId} ORDER BY data_criacao`).map((l) => l.descricao as string);

async function limpar() {
  const contatos = await sql`SELECT id FROM contatos WHERE nome LIKE ${MARCA + "%"}`;
  for (const c of contatos) {
    await sql`DELETE FROM historico WHERE contato_id = ${c.id}`;
    await sql`DELETE FROM mensagens WHERE atendimento_id IN (SELECT id FROM atendimentos WHERE contato_id = ${c.id})`;
    await sql`DELETE FROM atendimentos WHERE contato_id = ${c.id}`;
    await sql`DELETE FROM contatos WHERE id = ${c.id}`;
  }
  await sql`DELETE FROM ias WHERE nome LIKE ${MARCA + "%"}`;
}

async function main() {
  if (!process.env.WHATSAPP_SO_PARA?.trim()) {
    console.error("Sem WHATSAPP_SO_PARA o envio sairia de verdade: este teste só roda com a trava do dev.");
    process.exit(1);
  }
  await new Promise<void>((pronto) => servidor.listen(0, "127.0.0.1", pronto));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  process.env.ANTHROPIC_API_KEY = "chave-falsa-do-teste";
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  await limpar();

  const [ia] = await sql`
    INSERT INTO ias (nome, prompt, acoes, retomar_apos, retomar_das, retomar_ate)
    VALUES (${`${MARCA} IA`}, 'Você atende os clientes do teste.', string_to_array('agendar_retorno', ','),
            string_to_array('15', ',')::int[], 0, 24)
    RETURNING id`;
  iaId = ia.id as string;

  // ── 1. A ferramenta e a linha do histórico ────────────────────────────────
  const ok = conferirRetorno({ quando: AMANHA_15, pedido: "  me chama\namanhã  " });
  conferir(!("erro" in ok) && ok.pedido === "me chama amanhã", "conferirRetorno aceita AAAA-MM-DD HH:MM e limpa o pedido");
  conferir("erro" in conferirRetorno({ quando: "amanhã 15h", pedido: "" }), "recusa outro formato");
  conferir("erro" in conferirRetorno({ quando: "2027-02-31 10:00", pedido: "" }), "recusa data que não existe (31/02)");
  conferir("erro" in conferirRetorno({ quando: "2020-01-01 10:00", pedido: "" }), "recusa hora passada");
  conferir("erro" in conferirRetorno({ quando: `${diaEmBrasilia(new Date(Date.now() + 90 * 86_400_000))} 10:00`, pedido: "" }), "recusa mais de 60 dias à frente");

  const f = await contato("ferramenta");
  if (!("erro" in ok)) {
    await registrarRetorno(f.contatoId, null, ok);
    const [linha] = await linhas(f.contatoId);
    const lido = quandoDoRetorno(linha);
    conferir(lido?.getTime() === ok.quando.getTime(), "a linha gravada volta ao mesmo instante", linha);
    conferir((await retornoMarcado(f.contatoId))?.getTime() === ok.quando.getTime(), "retornoMarcado acha o combinado aberto");
    await fecharRetorno(f.contatoId, null, "feito (teste).");
    conferir((await retornoMarcado(f.contatoId)) === null, "fechado, não há mais retorno aberto");
  }

  // ── 2. A IA que atende ────────────────────────────────────────────────────
  const r = await contato("responde");
  await mensagem(r.atendimentoId, "ia", "Oi! Tudo bem? Podemos conversar sobre o investimento?", 30);
  const pedidoDoCliente = await mensagem(r.atendimentoId, "cliente", GATILHO, 0);
  chamadas.length = 0;
  await responderComIa(r.atendimentoId, pedidoDoCliente);
  conferir(chamadas[0]?.ferramentas.includes("agendar_retorno") ?? false, "com a ação marcada, o modelo recebe agendar_retorno", chamadas[0]?.ferramentas.join(","));
  conferir(chamadas[1]?.resultado?.startsWith("Anotado:") ?? false, "o resultado volta ao modelo para escrever a confirmação", chamadas[1]?.resultado ?? "sem segunda chamada");
  const [confirmacao] = await sql`
    SELECT texto, status, erro FROM mensagens
     WHERE atendimento_id = ${r.atendimentoId} AND enviada_por = 'ia' AND data_criacao > now() - interval '1 minute'`;
  conferir(confirmacao?.texto === "Combinado! Te chamo amanhã às 15h.", "a confirmação foi a que o modelo escreveu depois do resultado", `${confirmacao?.status} ${confirmacao?.erro ?? ""}`);
  // Com a trava, a confirmação não sai: o combinado não pode ficar gravado.
  const saiu = confirmacao?.status !== "erro";
  conferir((await retornoMarcado(r.contatoId)) !== null === saiu, saiu ? "confirmação saiu: combinado gravado" : "confirmação barrada: combinado NÃO gravado");

  // ── 3. A rodada ───────────────────────────────────────────────────────────
  const vencido = await contato("vencido");
  await mensagem(vencido.atendimentoId, "cliente", "agora não dá, me chama daqui a pouco", 125);
  await mensagem(vencido.atendimentoId, "ia", "Combinado! Te chamo mais tarde.", 124);
  await combinado(vencido.contatoId, -2, 124);

  const futuro = await contato("futuro");
  await mensagem(futuro.atendimentoId, "cliente", "fala comigo semana que vem", 60);
  await mensagem(futuro.atendimentoId, "ia", "Combinado, falamos semana que vem?", 59);
  await combinado(futuro.contatoId, 3 * 24 * 60, 59);

  const voltou = await contato("voltou");
  await mensagem(voltou.atendimentoId, "cliente", "me chama amanhã", 24 * 60);
  await mensagem(voltou.atendimentoId, "ia", "Combinado!", 24 * 60 - 1);
  await combinado(voltou.contatoId, -1, 24 * 60 - 1);
  await mensagem(voltou.atendimentoId, "cliente", "oi, consegui um tempo agora", 30);

  const semIa = await contato("sem-ia", false);
  await mensagem(semIa.atendimentoId, "cliente", "me chama amanhã", 24 * 60);
  await combinado(semIa.contatoId, -1, 24 * 60 - 1);

  // A retomada por silêncio (IA com 15 min) não pode cutucar o "futuro", que
  // tem pergunta da IA sem resposta há 59 min; o vizinho sem retorno, sim.
  const vizinho = await contato("vizinho");
  await mensagem(vizinho.atendimentoId, "cliente", "quanto rende?", 60);
  await mensagem(vizinho.atendimentoId, "ia", "Depende do valor. Quanto você pretende investir?", 59);

  chamadas.length = 0;
  const resumo = await retomarConversas();
  console.log("      resumo da rodada:", JSON.stringify(resumo));

  const escritaDoRetorno = chamadas.filter((c) => c.usuario.includes("RETORNO COMBINADO"));
  conferir(escritaDoRetorno.length === 1, "o retorno vencido é escrito pela IA, com a instrução do retorno", `${escritaDoRetorno.length} chamada(s)`);
  const [tentativa] = await sql`
    SELECT texto, status, erro FROM mensagens
     WHERE atendimento_id = ${vencido.atendimentoId} AND enviada_por = 'ia' AND data_criacao > now() - interval '1 minute'`;
  conferir(Boolean(tentativa), "e mandado na conversa do contato", `${tentativa?.status} ${tentativa?.erro ?? ""}`);
  const fimVencido = (await linhas(vencido.contatoId)).at(-1) ?? "";
  conferir(
    fimVencido.startsWith(`${MARCA_FIM} ${tentativa?.status === "erro" ? "não feito" : "feito"}`),
    "o combinado fecha conforme o envio (com a trava: não feito, envio falhou)",
    fimVencido,
  );
  conferir((await retornoMarcado(vencido.contatoId)) === null, "fechado, não volta na rodada seguinte");

  conferir((await retornoMarcado(futuro.contatoId)) !== null, "o retorno futuro fica aberto");
  const fimVoltou = (await linhas(voltou.contatoId)).at(-1) ?? "";
  conferir(fimVoltou.includes("o cliente voltou a falar"), "cliente que voltou a falar: fecha sem mandar", fimVoltou);
  const fimSemIa = (await linhas(semIa.contatoId)).at(-1) ?? "";
  conferir(fimSemIa.includes("não está mais com a IA"), "contato fora da IA: fecha e tenta avisar o responsável", fimSemIa);

  const cutucados = chamadas.filter((c) => c.usuario.includes("RETOMADA 1 DE 1"));
  conferir(cutucados.length === 1 && cutucados[0].usuario.includes("Quanto você pretende investir"), "a retomada por silêncio vai só para o vizinho sem retorno", `${cutucados.length} chamada(s)`);
  const [futuroCutucado] = await sql`
    SELECT 1 FROM mensagens WHERE atendimento_id = ${futuro.atendimentoId} AND retomada IS NOT NULL`;
  conferir(!futuroCutucado, "quem tem retorno marcado não recebe a retomada por silêncio");
}

main()
  .catch((e) => {
    falhas++;
    console.error(e);
  })
  .finally(async () => {
    await limpar().catch((e) => console.error("limpeza falhou:", e));
    servidor.close();
    await sql.end();
    console.log(falhas ? `\n${falhas} FALHA(S)` : "\ntudo certo");
    process.exit(falhas ? 1 : 0);
  });
