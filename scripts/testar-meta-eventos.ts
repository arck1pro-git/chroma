// Evento da Meta por etapa (lib/meta-eventos.ts), sem mandar nada à Meta.
//
//   node --env-file=.env scripts/jiti.mjs scripts/testar-meta-eventos.ts
//
// Quatro partes: o evento montado (hash, precedência, fbc, UTMs), o pixel de
// cada lead (com dependências falsas, sem rede), a reserva que impede reenvio —
// rodada numa transação DESFEITA no fim, então o banco não guarda nada — e os
// caminhos que não enviam, que só leem.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { sql } from "../lib/db";
import {
  dispararEventoDaEtapa,
  montarEventoMeta,
  reservarEvento,
  resolverPixel,
  telefoneMeta,
  type DadosDoLead,
  type DependenciasMeta,
} from "../lib/meta-eventos";

const sha = (v: string) => createHash("sha256").update(v).digest("hex");

async function main() {
  if ((process.env.DATABASE_URL ?? "").includes("ep-noisy-pond")) throw new Error("RECUSADO: DATABASE_URL aponta para PRODUÇÃO");

  // ── 1. O evento montado ──────────────────────────────────────────────────
  const criadoEm = new Date("2026-09-20T12:00:00Z");
  const e = montarEventoMeta({
    evento: "Schedule", eventId: "id-fixo", funil: "Vendas", etapa: "reunião agendada",
    agora: new Date("2026-09-25T15:00:00Z"),
    lead: {
      contatoId: "c-1", nome: "  João da Silva ", email: " Joao@Exemplo.COM ", whatsapp: "(47) 99934-6074",
      cidade: "Porto Belo", estado: "SC", pais: "Brasil", valor: 250000, criadoEm,
      // a oportunidade vence o contato; o fbp só existe no contato
      camposOportunidade: { utm_campaign: "LP01", fbclid: "ABC" },
      camposContato: { utm_campaign: "antiga", utm_source: "facebook", _fbp: "fb.1.123.456" },
    },
  });
  assert.equal(e.event_name, "Schedule");
  assert.equal(e.event_id, "id-fixo");
  assert.equal(e.action_source, "system_generated");
  assert.equal(e.event_time, Math.floor(Date.parse("2026-09-25T15:00:00Z") / 1000));
  assert.equal(e.user_data.em, sha("joao@exemplo.com"), "email em minúsculas e sem espaço");
  assert.equal(e.user_data.ph, sha("5547999346074"), "telefone só dígitos, com 55");
  assert.equal(e.user_data.fn, sha("joão"));
  assert.equal(e.user_data.ln, sha("silva"));
  assert.equal(e.user_data.ct, sha("portobelo"), "cidade sem espaço e sem acento");
  assert.equal(e.user_data.st, sha("sc"));
  assert.equal(e.user_data.country, sha("br"), "Brasil vira br");
  assert.equal(e.user_data.external_id, sha("c-1"));
  assert.equal(e.user_data.fbp, "fb.1.123.456", "fbp vem cru, com ou sem o _ do cookie");
  assert.equal(e.user_data.fbc, `fb.1.${criadoEm.getTime()}.ABC`, "fbc montado do fbclid");
  assert.equal(e.custom_data.utm_campaign, "LP01", "UTM da oportunidade vence a do contato");
  assert.equal(e.custom_data.utm_source, "facebook", "UTM que só o contato tem também vai");
  assert.equal(e.custom_data.currency, "BRL");
  assert.equal(e.custom_data.value, 250000);
  assert.equal(e.custom_data.event_source, "crm");

  // fbc gravado vence o montado; lead sem nada sai só com o que tem
  const minimo = montarEventoMeta({ evento: "Lead", eventId: "x", funil: "F", etapa: "E", lead: {
    contatoId: "c-2", nome: "Maria", email: null, whatsapp: null, cidade: null, estado: "Santa Catarina", pais: null, valor: 0, criadoEm,
    camposOportunidade: { fbc: "fb.1.9.GRAVADO", fbclid: "IGNORADO" }, camposContato: null,
  } });
  assert.equal(minimo.user_data.fbc, "fb.1.9.GRAVADO");
  assert.equal(minimo.user_data.ln, undefined, "nome de uma palavra não inventa sobrenome");
  assert.equal(minimo.user_data.st, undefined, "estado por extenso não vai: a Meta pede a sigla");
  assert.equal(minimo.user_data.em, undefined);
  assert.equal(minimo.user_data.country, sha("br"), "país vazio é o do CRM: br");

  assert.equal(telefoneMeta("5547999346074"), "5547999346074", "já com 55 fica igual");
  assert.equal(telefoneMeta("047999346074"), "5547999346074", "zero na frente sai");
  assert.equal(telefoneMeta(""), null);

  // ── 2. O pixel de cada lead ─────────────────────────────────────────────
  const AMAAN = "1124238353883498", OUTRO = "1210348824229443", ALHEIO = "9999999999999999";
  const consultados: string[] = [];
  const deps: DependenciasMeta = {
    pixelsPermitidos: async () => new Set([AMAAN, OUTRO]),
    pixelDoConjunto: async (adset) => {
      consultados.push(adset);
      if (adset === "120200000000000001") return OUTRO;
      if (adset === "120200000000000002") return ALHEIO;
      if (adset === "120200000000000003") throw new Error("(#100) objeto inexistente");
      return null;
    },
  };
  const lead = (op: Record<string, unknown> | null, contato: Record<string, unknown> | null = null): DadosDoLead => ({
    contatoId: "c", nome: "X", email: null, whatsapp: null, cidade: null, estado: null, pais: null, valor: 0, criadoEm,
    camposOportunidade: op, camposContato: contato,
  });

  assert.deepEqual(await resolverPixel(lead({ pixel_id: AMAAN, adset_id: "120200000000000001" }), deps),
    { pixelId: AMAAN, origem: "lead" }, "pixel do formulário vence o do conjunto");
  assert.deepEqual(consultados, [], "com pixel no lead, nem pergunta à Meta pelo conjunto");
  assert.deepEqual(await resolverPixel(lead({ adset_id: "120200000000000001" }), deps),
    { pixelId: OUTRO, origem: "conjunto" }, "sem pixel no lead, sai do conjunto do anúncio");
  assert.deepEqual(await resolverPixel(lead(null, { pixel_id: Number(AMAAN) }), deps),
    { pixelId: AMAAN, origem: "lead" }, "pixel no contato, e como número no JSON, também vale");
  assert.deepEqual(await resolverPixel(lead({ pixel_id: ALHEIO, adset_id: "120200000000000001" }), deps),
    { pixelId: OUTRO, origem: "conjunto" }, "pixel forjado no formulário é ignorado; o conjunto ainda decide");

  const forjado = await resolverPixel(lead({ pixel_id: ALHEIO }), deps);
  assert.equal(forjado.pixelId, null, "pixel fora das contas da integração não recebe evento");
  assert.match(forjado.pixelId === null ? forjado.motivo : "", /não pertence/);
  const conjuntoAlheio = await resolverPixel(lead({ adset_id: "120200000000000002" }), deps);
  assert.equal(conjuntoAlheio.pixelId, null);
  const conjuntoSumido = await resolverPixel(lead({ adset_id: "120200000000000003" }), deps);
  assert.match(conjuntoSumido.pixelId === null ? conjuntoSumido.motivo : "", /objeto inexistente/, "erro da Meta vira motivo, não exceção");
  const nada = await resolverPixel(lead({ utm_campaign: "LP01" }), deps);
  assert.deepEqual(nada, { pixelId: null, motivo: "lead sem pixel_id e sem adset_id" }, "só UTM não identifica pixel");
  const lixo = await resolverPixel(lead({ adset_id: "LP2 - topo" }), deps);
  assert.match(lixo.pixelId === null ? lixo.motivo : "", /adset_id do lead inválido/, "nome no lugar de id não vai à Meta");

  // ── 3. Reserva: uma vez por oportunidade + evento ────────────────────────
  const [etapa] = await sql`SELECT id, funil_id FROM etapas ORDER BY ordem LIMIT 1`;
  assert.ok(etapa, "o dev precisa de ao menos uma etapa");
  const DESFAZER = new Error("desfazer");
  await sql.begin(async (tx: unknown) => {
    const db = tx as unknown as Parameters<typeof reservarEvento>[0];
    const [c] = await db`INSERT INTO contatos (nome) VALUES ('teste meta-eventos') RETURNING id`;
    const [o] = await db`INSERT INTO oportunidades (nome, contato_id, funil_id, etapa_id) VALUES ('teste', ${c.id}, ${etapa.funil_id}, ${etapa.id}) RETURNING id`;
    const op = o.id as string;

    const r1 = await reservarEvento(db, op, etapa.id, "Lead");
    assert.ok(r1, "primeira entrada reserva");
    assert.equal(await reservarEvento(db, op, etapa.id, "Lead"), null, "pendente recente não reserva de novo (envio em curso)");

    await db`UPDATE meta_eventos SET status = 'erro', erro = 'falhou' WHERE id = ${r1.id}`;
    const r2 = await reservarEvento(db, op, etapa.id, "Lead");
    assert.ok(r2, "erro pode ser retomado");
    assert.equal(r2.id, r1.id, "retoma o MESMO registro");
    assert.equal(r2.eventId, r1.eventId, "mesmo event_id: a Meta descarta se o primeiro tiver chegado");

    await db`UPDATE meta_eventos SET status = 'sem_pixel', erro = 'lead sem pixel_id e sem adset_id' WHERE id = ${r1.id}`;
    const r2b = await reservarEvento(db, op, etapa.id, "Lead");
    assert.equal(r2b?.id, r1.id, "sem_pixel é retomado: o pixel pode ter aparecido no lead desde então");

    await db`UPDATE meta_eventos SET status = 'enviado' WHERE id = ${r1.id}`;
    assert.equal(await reservarEvento(db, op, etapa.id, "Lead"), null, "enviado nunca volta — sair e voltar da etapa não reenvia");
    assert.ok(await reservarEvento(db, op, etapa.id, "Schedule"), "outro evento da mesma oportunidade vai normalmente");

    const [p] = await db`INSERT INTO meta_eventos (oportunidade_id, etapa_id, evento, data_criacao) VALUES (${op}, ${etapa.id}, 'Contact', now() - interval '11 minutes') RETURNING id`;
    const r3 = await reservarEvento(db, op, etapa.id, "Contact");
    assert.equal(r3?.id, p.id, "pendente esquecido há mais de 10 min é retomado");

    throw DESFAZER;
  }).catch((erro: unknown) => { if (erro !== DESFAZER) throw erro; });
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM contatos WHERE nome = 'teste meta-eventos'`;
  assert.equal(n, 0, "a transação foi desfeita: nada ficou no dev");

  // ── 4. O que não envia: etapa sem evento, e a chave desligada (o dev) ──
  const [semEvento] = await sql`SELECT id FROM etapas WHERE meta_evento IS NULL LIMIT 1`;
  if (semEvento) assert.deepEqual(await dispararEventoDaEtapa("00000000-0000-0000-0000-000000000000", semEvento.id, deps), { estado: "sem_evento" });
  assert.notEqual(process.env.META_EVENTOS_ATIVOS, "1", "no dev a chave tem de estar desligada");
  // Etapa COM evento e chave desligada: não reserva, não consulta, não envia.
  // dispararEventoDaEtapa usa a conexão global, então aqui o evento é gravado
  // de verdade na etapa — e devolvido ao valor original no finally.
  const antes = (await sql`SELECT count(*)::int AS n FROM meta_eventos`)[0].n;
  const [{ meta_evento: original }] = await sql`SELECT meta_evento FROM etapas WHERE id = ${etapa.id}`;
  try {
    await sql`UPDATE etapas SET meta_evento = 'Lead' WHERE id = ${etapa.id}`;
    const r = await dispararEventoDaEtapa("00000000-0000-0000-0000-000000000000", etapa.id, {
      pixelsPermitidos: async () => { throw new Error("não devia consultar a Meta com a chave desligada"); },
      pixelDoConjunto: async () => { throw new Error("não devia consultar a Meta com a chave desligada"); },
    });
    assert.deepEqual(r, { estado: "desligado" });
  } finally {
    await sql`UPDATE etapas SET meta_evento = ${original} WHERE id = ${etapa.id}`;
  }
  assert.equal((await sql`SELECT count(*)::int AS n FROM meta_eventos`)[0].n, antes, "nada gravado em meta_eventos");

  console.log("Meta eventos: hash e normalização, precedência de campos, fbc, UTMs, pixel por lead e por conjunto (com trava de contas), reserva única e retomada validados — nada enviado, nada gravado.");
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
