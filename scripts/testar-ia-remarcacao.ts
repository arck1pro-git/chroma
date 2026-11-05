// A REMARCAÇÃO pela IA (lib/ia/remarcacao.ts, 2026-11-05) contra o banco DEV,
// com a Anthropic falsa num servidor local (node:http):
//
//   node --env-file=.env scripts/jiti.mjs scripts/testar-ia-remarcacao.ts
//
// Confere:
//   1. o estado: a linha pendente abre, a remarcada fecha, vale a última;
//   2. o imprevisto (avisar_imprevisto, depois da resposta entregue): abre a
//      remarcação no histórico e tenta avisar a Fernanda;
//   3. a rodada (retomarConversas): sem resposta do cliente, a IA volta a
//      oferecer 2 horas depois da mensagem dela e, depois, a cada dia
//      (TEMPOS_REMARCACAO), com a instrução da remarcação; antes da hora não
//      manda; remarcação fechada não manda; e a retomada por silêncio comum não
//      cutuca quem está remarcando.
// A mudança no Google (remarcarReuniao) é conferida em
// scripts/testar-agenda-ocupados.mjs, com o Google simulado.
//
// TRAVA DE AMBIENTE: com WHATSAPP_SO_PARA ativa (o .env do dev), todo envio é
// recusado antes da rede, e o teste NÃO a contorna; sem ela, o teste nem
// começa. O envio é conferido pela tentativa (mensagem numerada como retomada).
// A janela de horário da remarcação é aberta para o dia inteiro só aqui, no
// processo do teste, para ele rodar a qualquer hora.
//
// MARCA: IA e contatos "seed-teste-remarcacao…", números 55009008830…,
// apagados no finally, só pela marca.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { sql } from "@/lib/db";
import { paraTesteRemarcacao } from "@/lib/ia/atendente";
import { JANELA_REMARCACAO, MARCA_PENDENTE, registrarImprevisto, registrarRemarcada, remarcacaoAberta } from "@/lib/ia/remarcacao";
import { retomarConversas } from "@/lib/ia/retomada";
import { situacao } from "@/lib/ia/atendente";

const MARCA = "seed-teste-remarcacao";
const NUM_INSTANCIA = "5500900883000";

let falhas = 0;
function conferir(ok: boolean, texto: string, extra = "") {
  if (!ok) falhas++;
  console.log(`${ok ? "ok   " : "FALHA"} ${texto}${extra ? ` → ${extra}` : ""}`);
}

// ── A Anthropic falsa: guarda o pedido e devolve uma retomada qualquer ──────
const pedidos: string[] = [];
const servidor = createServer((req, res) => {
  let corpo = "";
  req.on("data", (c) => (corpo += c));
  req.on("end", () => {
    const b = JSON.parse(corpo);
    const primeira = b.messages?.[0]?.content;
    pedidos.push(typeof primeira === "string" ? primeira : JSON.stringify(primeira));
    res.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({
        id: "msg_teste",
        type: "message",
        role: "assistant",
        model: b.model,
        content: [{ type: "text", text: "Tudo bem! Que tal remarcarmos para quinta às 15h?" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
  });
});

// ── O cenário ───────────────────────────────────────────────────────────────
let iaId = "";
let seq = 0;

async function contato(sufixo: string) {
  seq += 1;
  const [c] = await sql`
    INSERT INTO contatos (nome, whatsapp, ia, ia_id)
    VALUES (${`${MARCA} ${sufixo}`}, ${`55009008830${String(seq).padStart(2, "0")}`}, true, ${iaId})
    RETURNING id`;
  const [a] = await sql`
    INSERT INTO atendimentos (contato_id, status, canal, numero_instancia, data_atualizacao)
    VALUES (${c.id}, 'aberto', 'whatsapp', ${NUM_INSTANCIA}, now()) RETURNING id`;
  return { contatoId: c.id as string, atendimentoId: a.id as string };
}

async function mensagem(atendimentoId: string, deQuem: "cliente" | "ia", texto: string, minutosAtras: number, retomada: number | null = null) {
  await sql`
    INSERT INTO mensagens (atendimento_id, origem, enviada_por, texto, status, data_criacao, retomada)
    VALUES (${atendimentoId}, ${deQuem === "cliente" ? "contato" : "agente"}, ${deQuem === "ia" ? "ia" : null}, ${texto},
            ${deQuem === "cliente" ? "recebido" : "enviado"}, now() - ${`${minutosAtras} minutes`}::interval, ${retomada})`;
}

/** Uma linha de remarcação gravada há `minutosAtras`. */
async function linhaHa(gravar: () => Promise<void>, contatoId: string, minutosAtras: number) {
  await gravar();
  await sql`
    UPDATE historico SET data_criacao = now() - ${`${minutosAtras} minutes`}::interval
     WHERE id = (SELECT id FROM historico WHERE contato_id = ${contatoId} ORDER BY data_criacao DESC LIMIT 1)`;
}

const retomadas = async (atendimentoId: string) =>
  (await sql`SELECT retomada FROM mensagens WHERE atendimento_id = ${atendimentoId} AND retomada IS NOT NULL AND data_criacao > now() - interval '1 minute'`).map(
    (m) => m.retomada as number,
  );

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
  JANELA_REMARCACAO.das = 0;
  JANELA_REMARCACAO.ate = 24;
  await limpar();

  // IA com retomada por silêncio de 15 min: é ela que NÃO pode cutucar quem está remarcando.
  const [ia] = await sql`
    INSERT INTO ias (nome, prompt, acoes, retomar_apos, retomar_das, retomar_ate)
    VALUES (${`${MARCA} IA`}, 'Você atende os clientes do teste.', string_to_array('agendar_reuniao', ','),
            string_to_array('15', ',')::int[], 0, 24)
    RETURNING id`;
  iaId = ia.id as string;

  // ── 1. O estado ───────────────────────────────────────────────────────────
  const e = await contato("estado");
  conferir(!(await remarcacaoAberta(e.contatoId)), "sem linha, sem remarcação");
  await registrarImprevisto(e.contatoId, null, "não vou conseguir ir");
  conferir(await remarcacaoAberta(e.contatoId), "a linha pendente abre a remarcação");
  await registrarRemarcada(e.contatoId, null, "de A para B.");
  conferir(!(await remarcacaoAberta(e.contatoId)), "a remarcada fecha (vale a última)");
  await linhaHa(() => registrarImprevisto(e.contatoId, null, "velha"), e.contatoId, 11 * 24 * 60);
  conferir(!(await remarcacaoAberta(e.contatoId)), "pendente com mais de 10 dias não vale");

  // ── 2. O imprevisto ───────────────────────────────────────────────────────
  const imp = await contato("imprevisto");
  await mensagem(imp.atendimentoId, "cliente", "não vou conseguir ir amanhã", 1);
  const s = await situacao(imp.atendimentoId);
  if (!s) throw new Error("sem situação");
  await paraTesteRemarcacao.avisarImprevisto(imp.atendimentoId, s, "Teve um imprevisto no trabalho.");
  const linhasImp = (await sql`SELECT descricao FROM historico WHERE contato_id = ${imp.contatoId} ORDER BY data_criacao`).map((l) => l.descricao as string);
  conferir(
    linhasImp.some((l) => l.startsWith(`${MARCA_PENDENTE}: Teve um imprevisto no trabalho.`)),
    "o imprevisto abre a remarcação com o que o cliente disse",
    linhasImp[0],
  );
  conferir(linhasImp.some((l) => l.startsWith("Aviso da remarcação à equipe:")), "e tenta avisar a Fernanda (fica no histórico para quem foi)", linhasImp.at(-1));
  await paraTesteRemarcacao.avisarImprevisto(imp.atendimentoId, s, "Repetiu que não vai.");
  const depoisDeRepetir = (await sql`SELECT count(*)::int AS n FROM historico WHERE contato_id = ${imp.contatoId}`)[0].n as number;
  conferir(depoisDeRepetir === linhasImp.length, "imprevisto repetido com a remarcação aberta: nem linha nova nem aviso de novo", `${depoisDeRepetir} linhas`);

  // ── 3. A rodada ───────────────────────────────────────────────────────────
  // a) 2h depois da oferta, sem resposta: a primeira mensagem da remarcação.
  const duasHoras = await contato("duas-horas");
  await mensagem(duasHoras.atendimentoId, "cliente", "não vou conseguir ir", 126);
  await mensagem(duasHoras.atendimentoId, "ia", "Tudo bem! Prefere quinta às 10h ou sexta às 15h?", 125);
  await linhaHa(() => registrarImprevisto(duasHoras.contatoId, null, "imprevisto"), duasHoras.contatoId, 125);

  // b) Só 1h depois: ainda não.
  const cedo = await contato("cedo");
  await mensagem(cedo.atendimentoId, "cliente", "não vou conseguir ir", 61);
  await mensagem(cedo.atendimentoId, "ia", "Tudo bem! Prefere quinta às 10h ou sexta às 15h?", 60);
  await linhaHa(() => registrarImprevisto(cedo.contatoId, null, "imprevisto"), cedo.contatoId, 60);

  // c) Já teve a primeira, há 25h: a segunda (uma por dia).
  const umDia = await contato("um-dia");
  await mensagem(umDia.atendimentoId, "cliente", "não vou conseguir ir", 27 * 60);
  await mensagem(umDia.atendimentoId, "ia", "Tudo bem! Prefere quinta às 10h ou sexta às 15h?", 27 * 60 - 1);
  await mensagem(umDia.atendimentoId, "ia", "Oi! Conseguiu ver um horário?", 25 * 60, 1);
  await linhaHa(() => registrarImprevisto(umDia.contatoId, null, "imprevisto"), umDia.contatoId, 27 * 60 - 1);

  // d) Já remarcada: nada.
  const feita = await contato("feita");
  await mensagem(feita.atendimentoId, "cliente", "pode ser quinta às 10h", 130);
  await mensagem(feita.atendimentoId, "ia", "Remarcado para quinta às 10h! Até lá.", 129);
  await linhaHa(() => registrarImprevisto(feita.contatoId, null, "imprevisto"), feita.contatoId, 135);
  await linhaHa(() => registrarRemarcada(feita.contatoId, null, "de A para B."), feita.contatoId, 129);

  pedidos.length = 0;
  const resumo = await retomarConversas();
  console.log("      resumo da rodada:", JSON.stringify(resumo));

  const daRemarcacao = pedidos.filter((p) => p.includes("REMARCAÇÃO"));
  conferir(daRemarcacao.some((p) => p.includes("REMARCAÇÃO 1 DE 5")), "2h sem resposta: a IA escreve a 1ª mensagem com a instrução da remarcação");
  conferir(daRemarcacao.some((p) => p.includes("REMARCAÇÃO 2 DE 5")), "um dia depois da 1ª: a 2ª");
  conferir(daRemarcacao.length === 2, "nem a de 1h nem a já remarcada recebem", `${daRemarcacao.length} pedido(s) de remarcação`);
  conferir((await retomadas(duasHoras.atendimentoId)).includes(1), "a tentativa da 1ª fica numerada na conversa (com a trava, não sai)");
  conferir((await retomadas(umDia.atendimentoId)).includes(2), "a da 2ª também");
  conferir((await retomadas(cedo.atendimentoId)).length === 0 && (await retomadas(feita.atendimentoId)).length === 0, "cedo e feita: nenhuma tentativa");
  const comuns = pedidos.filter((p) => p.includes("RETOMADA 1 DE 1"));
  conferir(
    !comuns.some((p) => p.includes("Prefere quinta às 10h ou sexta às 15h")),
    "a retomada por silêncio comum (15 min) não cutuca quem está remarcando",
    `${comuns.length} retomada(s) comum(ns)`,
  );
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
