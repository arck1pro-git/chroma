// O NÚMERO SECUNDÁRIO (lib/uazapi-reserva.ts, 2026-10-30) contra o banco DEV,
// com a uazapi falsa num servidor local (node:http):
//
//   node --env-file=.env scripts/jiti.mjs scripts/testar-instancia-secundaria.ts
//
// Confere:
//   1. quando a secundária assume: só com a principal vermelha e ela verde; com
//      a principal amarela, as duas vermelhas ou a uazapi sem resposta, fica;
//   2. o envio da conversa (lib/conversa-envio.ts): com a troca, a mensagem fica
//      na conversa da secundária com o lead, que herda o dono; sem a troca, na
//      própria conversa; e a principal verde de novo volta a enviar;
//   3. as conversas do par que a IA lê (conversasDoPar);
//   4. as travas do banco: uma secundária por principal, nunca de si mesma.
//
// TRAVA DE AMBIENTE: com WHATSAPP_SO_PARA ativa (o .env do dev), o envio é
// recusado antes da rede e o teste NÃO a contorna. A troca é conferida pela
// conversa onde a linha ficou (com o erro "bloqueado") e, sem a trava, também
// pelo token que chegou à uazapi falsa. Só o endereço e o token de admin da
// uazapi apontam para o servidor local, dentro deste processo.
//
// MARCA: instâncias e contato "seed-teste-reserva…", números 55009008810…,
// apagados no finally, só pela marca.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { sql } from "@/lib/db";
import { conversasDoPar, esquecerEstado, instanciaQueEnvia } from "@/lib/uazapi-reserva";
import { enviarTextoNaConversa } from "@/lib/conversa-envio";
import type { Instancia } from "@/lib/uazapi";

const MARCA = "seed-teste-reserva";
const NUM_P = "5500900881001";
const NUM_S = "5500900881002";
const NUM_LEAD = "5500900881999";

let falhas = 0;
function conferir(ok: boolean, texto: string, extra = "") {
  if (!ok) falhas++;
  console.log(`${ok ? "ok   " : "FALHA"} ${texto}${extra ? ` → ${extra}` : ""}`);
}

// ── A uazapi falsa ──────────────────────────────────────────────────────────
const estado = { p: "connected", s: "connected", fora: false };
const enviados: Array<{ token: string; numero: string }> = [];
const servidor = createServer((req, res) => {
  let corpo = "";
  req.on("data", (c) => (corpo += c));
  req.on("end", () => {
    if (req.url?.startsWith("/instance/all")) {
      if (estado.fora) return res.writeHead(500).end("{}");
      return res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify([
          { id: `${MARCA}-p`, status: estado.p, owner: NUM_P, token: "não sai daqui" },
          { id: `${MARCA}-s`, status: estado.s, owner: NUM_S, token: "não sai daqui" },
        ]),
      );
    }
    if (req.url?.startsWith("/send/")) {
      const dado = JSON.parse(corpo || "{}");
      enviados.push({ token: String(req.headers.token ?? ""), numero: String(dado.number ?? "") });
      return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ messageid: `falso-${enviados.length}`, id: "x", status: "sent", chatid: "x" }));
    }
    res.writeHead(404).end("{}");
  });
});

async function limpar() {
  const contatos = await sql`SELECT id FROM contatos WHERE nome LIKE ${MARCA + "%"}`;
  for (const c of contatos) {
    await sql`DELETE FROM mensagens WHERE atendimento_id IN (SELECT id FROM atendimentos WHERE contato_id = ${c.id})`;
    await sql`DELETE FROM atendimentos WHERE contato_id = ${c.id}`;
    await sql`DELETE FROM contatos WHERE id = ${c.id}`;
  }
  await sql`UPDATE instancias_uazapi SET secundaria_de = NULL WHERE nome LIKE ${MARCA + "%"}`;
  await sql`DELETE FROM instancias_uazapi WHERE nome LIKE ${MARCA + "%"}`;
}

const mudar = (p: string, s: string, fora = false) => {
  Object.assign(estado, { p, s, fora });
  esquecerEstado();
};

async function main() {
  await new Promise<void>((pronto) => servidor.listen(0, "127.0.0.1", pronto));
  const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  process.env.UAZAPI_BASE_URL = base;
  process.env.UAZAPI_ADMIN_TOKEN = "admin-falso-do-teste";
  const travaAtiva = Boolean(process.env.WHATSAPP_SO_PARA?.trim());
  await limpar();

  const [p] = await sql`
    INSERT INTO instancias_uazapi (nome, base_url, token, numero, instancia_uazapi_id)
    VALUES (${MARCA + "-principal"}, ${base}, ${MARCA + "-tok-p"}, ${NUM_P}, ${MARCA + "-p"}) RETURNING id`;
  const [s] = await sql`
    INSERT INTO instancias_uazapi (nome, base_url, token, numero, instancia_uazapi_id, secundaria_de)
    VALUES (${MARCA + "-secundaria"}, ${base}, ${MARCA + "-tok-s"}, ${NUM_S}, ${MARCA + "-s"}, ${p.id}) RETURNING id`;
  const [c] = await sql`INSERT INTO contatos (nome, whatsapp) VALUES (${MARCA + "-lead"}, ${NUM_LEAD}) RETURNING id`;
  const [dono] = await sql`SELECT id FROM usuarios ORDER BY nome LIMIT 1`;
  const [atP] = await sql`
    INSERT INTO atendimentos (contato_id, status, canal, numero_instancia, responsavel_id)
    VALUES (${c.id}, 'aberto', 'whatsapp', ${NUM_P}, ${dono?.id ?? null}) RETURNING id`;
  const principal: Instancia = { id: p.id, nome: `${MARCA}-principal`, baseUrl: base, token: `${MARCA}-tok-p`, numero: NUM_P };

  // ── 1. Quando a secundária assume ─────────────────────────────────────────
  mudar("connected", "connected");
  conferir((await instanciaQueEnvia(principal)).principal === null, "principal verde: sai por ela");
  mudar("disconnected", "connected");
  const troca = await instanciaQueEnvia(principal);
  conferir(troca.instancia.id === s.id && troca.principal?.id === p.id, "principal vermelha e secundária verde: sai pela secundária", troca.instancia.nome);
  mudar("connecting", "connected");
  conferir((await instanciaQueEnvia(principal)).principal === null, "principal amarela (conectando): continua por ela");
  mudar("hibernated", "connected");
  conferir((await instanciaQueEnvia(principal)).principal === null, "principal amarela (hibernada): continua por ela");
  mudar("disconnected", "disconnected");
  conferir((await instanciaQueEnvia(principal)).principal === null, "as duas vermelhas: tenta a principal (e falha com o motivo de sempre)");
  mudar("disconnected", "connected", true);
  conferir((await instanciaQueEnvia(principal)).principal === null, "uazapi sem resposta: não troca no escuro");
  mudar("disconnected", "connected");
  const semPar: Instancia = { ...principal, id: s.id, nome: `${MARCA}-secundaria`, numero: NUM_S };
  conferir((await instanciaQueEnvia(semPar)).principal === null, "instância sem secundária: sai por ela mesma");

  // ── 2. O envio da conversa ────────────────────────────────────────────────
  mudar("connected", "connected");
  enviados.length = 0;
  const r1 = await enviarTextoNaConversa({ atendimentoId: atP.id, texto: "teste: principal verde", autorId: null, enviadaPor: "crm" });
  const [m1] = await sql`SELECT atendimento_id, status, erro FROM mensagens WHERE id = ${r1.mensagemId ?? null}`;
  conferir(!r1.movida && m1?.atendimento_id === atP.id, "principal verde: a mensagem fica na própria conversa", m1?.status);
  if (!travaAtiva) conferir(enviados.at(-1)?.token === `${MARCA}-tok-p`, "e saiu com o token da principal");

  mudar("disconnected", "connected");
  enviados.length = 0;
  const r2 = await enviarTextoNaConversa({ atendimentoId: atP.id, texto: "teste: principal caiu", autorId: null, enviadaPor: "crm" });
  const atS = r2.movida?.atendimentoId ?? "";
  const [m2] = await sql`SELECT atendimento_id, status, erro FROM mensagens WHERE id = ${r2.mensagemId ?? null}`;
  const [conversaS] = atS ? await sql`SELECT numero_instancia, responsavel_id, contato_id FROM atendimentos WHERE id = ${atS}` : [];
  conferir(
    Boolean(atS) && atS !== atP.id && m2?.atendimento_id === atS && conversaS?.numero_instancia === NUM_S && conversaS?.contato_id === c.id,
    "principal vermelha: a mensagem fica na conversa da secundária com o lead",
    `${JSON.stringify(r2.movida)} · ${m2?.status}${travaAtiva ? " (trava do dev)" : ""}`,
  );
  conferir((conversaS?.responsavel_id ?? null) === (dono?.id ?? null), "a conversa da secundária herda o dono da conversa da principal");
  if (!travaAtiva) conferir(enviados.at(-1)?.token === `${MARCA}-tok-s`, "e saiu com o token da secundária");

  const r3 = await enviarTextoNaConversa({ atendimentoId: atP.id, texto: "teste: de novo, ainda caída", autorId: null, enviadaPor: "crm" });
  conferir(r3.movida?.atendimentoId === atS, "a próxima, com a principal ainda caída, vai para a mesma conversa da secundária (uma por par)");

  mudar("connected", "connected");
  const r4 = await enviarTextoNaConversa({ atendimentoId: atP.id, texto: "teste: principal voltou", autorId: null, enviadaPor: "crm" });
  const [m4] = await sql`SELECT atendimento_id FROM mensagens WHERE id = ${r4.mensagemId ?? null}`;
  conferir(!r4.movida && m4?.atendimento_id === atP.id, "a principal verde de novo volta a enviar pela conversa dela");
  const r5 = await enviarTextoNaConversa({ atendimentoId: atS, texto: "teste: resposta na conversa da secundária", autorId: null, enviadaPor: "crm" });
  const [m5] = await sql`SELECT atendimento_id FROM mensagens WHERE id = ${r5.mensagemId ?? null}`;
  conferir(!r5.movida && m5?.atendimento_id === atS, "a conversa em que o lead seguiu pela secundária continua nela");

  // ── 3. As conversas que a IA lê ───────────────────────────────────────────
  const doP = await conversasDoPar(atP.id);
  const doS = await conversasDoPar(atS);
  conferir(doP[0] === atP.id && doP.includes(atS) && doS[0] === atS && doS.includes(atP.id) && doP.length === 2, "a IA lê as duas conversas do lead no par, a pedida primeiro");

  // ── 4. As travas do banco ─────────────────────────────────────────────────
  const outra = await sql`
    INSERT INTO instancias_uazapi (nome, base_url, token, numero, secundaria_de)
    VALUES (${MARCA + "-outra"}, ${base}, ${MARCA + "-tok-o"}, ${"5500900881003"}, ${p.id})`.then(() => "entrou", (e) => String(e?.message ?? e));
  conferir(/ux_instancia_uma_secundaria|duplicate key/i.test(outra), "uma segunda secundária para a mesma principal é recusada", outra.slice(0, 80));
  const si = await sql`UPDATE instancias_uazapi SET secundaria_de = id WHERE id = ${p.id}`.then(() => "entrou", (e) => String(e?.message ?? e));
  conferir(/ck_instancia_secundaria_de_si/i.test(si), "uma instância não é secundária de si mesma", si.slice(0, 80));

  if (travaAtiva) console.log("(WHATSAPP_SO_PARA ativa: os envios foram recusados antes da rede; a troca foi conferida pela conversa onde cada linha ficou)");
}

main()
  .catch((e) => {
    falhas++;
    console.error("FALHOU:", e);
  })
  .finally(async () => {
    await limpar().catch((e) => console.error("limpeza falhou:", e));
    const [sobra] = await sql`SELECT count(*)::int AS n FROM instancias_uazapi WHERE nome LIKE ${MARCA + "%"}`;
    console.log(`cenário apagado (sobraram ${sobra?.n ?? "?"} instâncias marcadas)`);
    servidor.close();
    await sql.end();
    console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo ok");
    process.exit(falhas ? 1 : 0);
  });
