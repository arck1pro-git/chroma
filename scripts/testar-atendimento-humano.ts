// O atendimento humano (2026-10-28) contra o banco DEV, sem rede.
//
//   node --env-file=.env scripts/jiti.mjs scripts/testar-atendimento-humano.ts
//
// Três partes, com as funções reais:
//   1. a cadência no fim (moverPelaCadencia): o destino é o do nó na versão
//      PUBLICADA agora, não o do retrato do n8n; chegar ao atendimento humano
//      grava a linha que acende a pill;
//   2. a pill (carregarFunil): acende pela cadência e pela IA, apaga quando a
//      equipe escreve;
//   3. a IA (avancarPelaIa): quem pede gente vai para o atendimento humano de
//      qualquer etapa antes da reunião agendada, com o nome antigo ou o novo,
//      nas duas ordens de coluna e em funil sem "reunião agendada".
// O DEV não tem os funis reformulados, então o cenário monta funis de teste no
// formato da AMAAN (marca "seed-atendimento-humano"), apagados no fim.
import { sql } from "../lib/db";
import { ENVIADO_PELA_CADENCIA, PASSOU_PELA_IA } from "../lib/atendimento-humano";
import { moverPelaCadencia } from "../lib/automacoes/mover-pela-cadencia";
import { carregarFunil } from "../lib/funil";
import { paraTesteAndamento } from "../lib/ia/atendente";

const MARCA = "seed-atendimento-humano";
// Duas ordens de coluna: a dos funis reformulados (19/10) e a com "solicitou
// contato" antes de "em atendimento", que o atendente cita.
const ORDEM_A = ["Atendimento IA", "em atendimento", "solicitou contato", "sem contato", "sem interesse - sem perfil - sem capital", "reunião agendada", "reunião realizada"];
const ORDEM_B = ["Atendimento IA", "solicitou contato", "em atendimento", "sem contato", "sem interesse - sem perfil - sem capital", "reunião agendada", "reunião realizada"];

let falhas = 0;
function conferir(ok: boolean, texto: string, extra = "") {
  if (!ok) falhas++;
  console.log(`${ok ? "ok   " : "FALHA"} ${texto}${extra ? ` → ${extra}` : ""}`);
}

/** Um funil de teste com um lead aberto na primeira etapa. */
async function cenario(sufixo: string, ordem: string[]) {
  const [funil] = await sql`INSERT INTO funis (nome) VALUES (${`${MARCA} ${sufixo}`}) RETURNING id`;
  const etapa: Record<string, string> = {};
  for (const [i, nome] of ordem.entries()) {
    const [e] = await sql`INSERT INTO etapas (nome, funil_id, ordem) VALUES (${nome}, ${funil.id}, ${i}) RETURNING id`;
    etapa[nome] = e.id;
  }
  const [contato] = await sql`INSERT INTO contatos (nome, whatsapp) VALUES (${MARCA}, ${`55009000${sufixo === "A" ? "00928" : sufixo === "B" ? "00929" : "00930"}`}) RETURNING id`;
  const [op] = await sql`
    INSERT INTO oportunidades (nome, contato_id, funil_id, etapa_id, status)
    VALUES (${MARCA}, ${contato.id}, ${funil.id}, ${etapa[ordem[0]]}, 'aberta') RETURNING id`;
  const etapaAgora = async () => {
    const [o] = await sql`SELECT etapa_id FROM oportunidades WHERE id = ${op.id}`;
    return ordem.find((n) => etapa[n] === o.etapa_id);
  };
  const porEtapa = async (nome: string) => {
    await sql`UPDATE oportunidades SET etapa_id = ${etapa[nome]} WHERE id = ${op.id}`;
  };
  return { funil: funil.id as string, etapa, contato: contato.id as string, op: op.id as string, etapaAgora, porEtapa };
}

async function main() {
  if ((process.env.DATABASE_URL ?? "").includes("ep-noisy-pond")) throw new Error("RECUSADO: DATABASE_URL aponta para PRODUÇÃO");
  await limpar();

  const a = await cenario("A", ORDEM_A);
  const outro = await cenario("C", ORDEM_A);
  const comPill = async () => (await carregarFunil(null)).pediramAtendimento.includes(a.contato);
  const linhas = async (prefixo: string) =>
    (await sql`SELECT count(*)::int AS n FROM historico WHERE contato_id = ${a.contato} AND descricao LIKE ${`${prefixo}%`}`)[0].n as number;

  // ── 1. A cadência no fim ──────────────────────────────────────────────────
  // Como a retomada da AMAAN: fluxo sem etapa, inscrição com origem na etapa da IA.
  const [fluxo] = await sql`INSERT INTO fluxos (nome, entidade_alvo, estado) VALUES (${MARCA}, 'oportunidade', 'publicado') RETURNING id`;
  let numero = 0;
  const publicar = async (nos: Record<string, unknown>) => {
    numero++;
    const [v] = await sql`
      INSERT INTO fluxo_versoes (fluxo_id, numero, definicao, hash)
      VALUES (${fluxo.id}, ${numero}, ${sql.json({ schema: "chroma.flow/v1", nos, arestas: [], layout: {} } as never)}, ${`${MARCA}-${numero}`})
      RETURNING id`;
    await sql`UPDATE fluxos SET versao_publicada_id = ${v.id} WHERE id = ${fluxo.id}`;
    return v.id as string;
  };
  const fim = (etapaId: string, tipo = "atualizar_oportunidade") => ({ fim: { tipo, config: { titulo: "Mover", etapa_id: etapaId } } });
  // v1 (o retrato que o n8n guardou): fim → sem contato. A publicada muda abaixo.
  const v1 = await publicar(fim(a.etapa["sem contato"]));
  await publicar(fim(a.etapa["solicitou contato"]));
  const novaExecucao = async () => {
    await sql`UPDATE fluxo_execucoes SET estado = 'sucesso' WHERE entidade_id = ${a.op} AND estado IN ('pendente','rodando','esperando')`;
    const [x] = await sql`
      INSERT INTO fluxo_execucoes (fluxo_id, versao_id, entidade_tipo, entidade_id, origem, origem_etapa_id, motor, estado)
      VALUES (${fluxo.id}, ${v1}, 'oportunidade', ${a.op}, 'etapa', ${a.etapa["Atendimento IA"]}, 'n8n', 'esperando') RETURNING id`;
    return x.id as string;
  };
  const doCorpo = a.etapa["sem contato"];

  conferir(!(await comPill()), "antes de tudo, sem pill");
  const r1 = await moverPelaCadencia(await novaExecucao(), doCorpo, "fim");
  conferir((await a.etapaAgora()) === "solicitou contato", "execução antiga (corpo: sem contato) vai para o destino da versão publicada", JSON.stringify(r1));
  conferir((await linhas(ENVIADO_PELA_CADENCIA)) === 1, "grava a linha do atendimento humano no histórico");
  conferir(await comPill(), "a pill acende pela cadência");

  // A equipe escreveu para o lead: a pill apaga.
  const [conversa] = await sql`
    INSERT INTO atendimentos (contato_id, status, canal) VALUES (${a.contato}, 'aberto', 'whatsapp') RETURNING id`;
  await sql`
    INSERT INTO mensagens (atendimento_id, origem, texto, status, enviada_por)
    VALUES (${conversa.id}, 'agente', ${MARCA}, 'enviado', 'crm')`;
  conferir(!(await comPill()), "a pill apaga quando a equipe escreve");

  const r1b = await moverPelaCadencia(await novaExecucao(), doCorpo, "fim");
  conferir("pulado" in r1b && (await linhas(ENVIADO_PELA_CADENCIA)) === 1, "chamada repetida não move nem grava de novo", JSON.stringify(r1b));

  await a.porEtapa("Atendimento IA");
  const r2 = await moverPelaCadencia(await novaExecucao(), doCorpo);
  conferir((await a.etapaAgora()) === "sem contato", "sem no_id (workflow antigo), vale a etapa do corpo", JSON.stringify(r2));
  conferir((await linhas(ENVIADO_PELA_CADENCIA)) === 1, "sem contato não é atendimento humano: nenhuma linha nova");

  await a.porEtapa("Atendimento IA");
  const r3 = await moverPelaCadencia(await novaExecucao(), doCorpo, "bloco_que_saiu");
  conferir((await a.etapaAgora()) === "sem contato", "nó que não está na versão publicada: vale a etapa do corpo", JSON.stringify(r3));

  await a.porEtapa("Atendimento IA");
  await publicar(fim(a.etapa["solicitou contato"], "enviar_whatsapp_web"));
  const r4 = await moverPelaCadencia(await novaExecucao(), doCorpo, "fim");
  conferir((await a.etapaAgora()) === "sem contato", "mesmo id, mas não é mais 'Atualizar oportunidade': vale a etapa do corpo", JSON.stringify(r4));

  await a.porEtapa("Atendimento IA");
  await publicar(fim(outro.etapa["solicitou contato"]));
  const r5 = await moverPelaCadencia(await novaExecucao(), doCorpo, "fim");
  conferir("erro" in r5 && r5.status === 400 && (await a.etapaAgora()) === "Atendimento IA", "destino publicado em outro funil é erro (o nó falha no motor)", JSON.stringify(r5));

  await sql`UPDATE etapas SET nome = 'Atendimento humano' WHERE id = ${a.etapa["solicitou contato"]}`;
  await publicar(fim(a.etapa["solicitou contato"]));
  const r6 = await moverPelaCadencia(await novaExecucao(), doCorpo, "fim");
  conferir((await a.etapaAgora()) === "solicitou contato" && (await linhas(ENVIADO_PELA_CADENCIA)) === 2, 'etapa com o nome "Atendimento humano": move e grava a pill', JSON.stringify(r6));
  conferir(await comPill(), "a pill acende de novo depois da última mensagem da equipe");
  await sql`UPDATE etapas SET nome = 'solicitou contato' WHERE id = ${a.etapa["solicitou contato"]}`;

  await a.porEtapa("reunião agendada");
  const r7 = await moverPelaCadencia(await novaExecucao(), doCorpo, "fim");
  conferir("pulado" in r7 && (await a.etapaAgora()) === "reunião agendada", "card que saiu da etapa da cadência fica onde está", JSON.stringify(r7));

  // ── 2 e 3. A IA ───────────────────────────────────────────────────────────
  const { avancarPelaIa, ETAPA_SOLICITOU } = paraTesteAndamento;
  const [ia] = await sql`SELECT id FROM ias ORDER BY data_criacao LIMIT 1`;
  if (!ia) throw new Error("o DEV não tem IA nenhuma para o teste");
  const pedirGente = async (c: Awaited<ReturnType<typeof cenario>>, de: string) => {
    await c.porEtapa(de);
    const s = { op_id: c.op, op_funil_id: c.funil, op_etapa_id: c.etapa[de], contato_id: c.contato };
    await avancarPelaIa(s as never, ia.id, ETAPA_SOLICITOU, "o lead pediu atendimento (teste)", false);
    return c.etapaAgora();
  };
  const b = await cenario("B", ORDEM_B);
  for (const [c, nome] of [[a, "A"], [b, "B"]] as const) {
    for (const de of ["Atendimento IA", "em atendimento", "sem contato", "sem interesse - sem perfil - sem capital"]) {
      conferir((await pedirGente(c, de)) === "solicitou contato", `IA (ordem ${nome}): pediu gente em "${de}" → solicitou contato`);
    }
    for (const de of ["reunião agendada", "reunião realizada"]) {
      conferir((await pedirGente(c, de)) === de, `IA (ordem ${nome}): pediu gente em "${de}" → fica (a equipe já está com o lead)`);
    }
  }
  await sql`UPDATE etapas SET nome = 'Atendimento humano' WHERE id = ${a.etapa["solicitou contato"]}`;
  conferir((await pedirGente(a, "sem contato")) === "solicitou contato", 'IA: a etapa com o nome "Atendimento humano" também vale');

  // Funil sem "reunião agendada": volta só de "em atendimento", como antes.
  await sql`UPDATE etapas SET nome = 'Reunião marcada' WHERE id = ${b.etapa["reunião agendada"]}`;
  conferir((await pedirGente(b, "em atendimento")) === "solicitou contato", "IA, funil sem 'reunião agendada': em atendimento → solicitou contato");
  conferir((await pedirGente(b, "sem contato")) === "sem contato", "IA, funil sem 'reunião agendada': sem contato fica (só para a frente)");

  // A linha da IA (passarParaHumano) acende a pill do mesmo jeito.
  await sql`INSERT INTO historico (contato_id, descricao) VALUES (${a.contato}, ${`${PASSOU_PELA_IA} teste (${MARCA})`})`;
  conferir(await comPill(), "a pill acende pela IA");
}

async function limpar() {
  const ops = await sql`SELECT id FROM oportunidades WHERE nome = ${MARCA}`;
  for (const o of ops) {
    await sql`DELETE FROM fluxo_execucao_passos WHERE execucao_id IN (SELECT id FROM fluxo_execucoes WHERE entidade_id = ${o.id})`;
    await sql`DELETE FROM fluxo_execucoes WHERE entidade_id = ${o.id}`;
  }
  await sql`DELETE FROM fluxos WHERE nome = ${MARCA}`;
  for (const c of await sql`SELECT id FROM contatos WHERE nome = ${MARCA}`) {
    await sql`DELETE FROM mensagens WHERE atendimento_id IN (SELECT id FROM atendimentos WHERE contato_id = ${c.id})`;
    await sql`DELETE FROM atendimentos WHERE contato_id = ${c.id}`;
    await sql`DELETE FROM historico WHERE contato_id = ${c.id}`;
    await sql`DELETE FROM oportunidades WHERE contato_id = ${c.id}`;
    await sql`DELETE FROM contatos WHERE id = ${c.id}`;
  }
  await sql`DELETE FROM funis WHERE nome LIKE ${`${MARCA} %`}`;
}

main()
  .catch((e) => {
    falhas++;
    console.error(e);
  })
  .finally(async () => {
    await limpar();
    const [sobra] = await sql`SELECT count(*)::int AS n FROM contatos WHERE nome = ${MARCA}`;
    const [funis] = await sql`SELECT count(*)::int AS n FROM funis WHERE nome LIKE ${`${MARCA}%`}`;
    console.log(`cenário apagado (sobraram ${sobra.n} contatos e ${funis.n} funis)`);
    await sql.end();
    console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo ok");
    process.exit(falhas ? 1 : 0);
  });
