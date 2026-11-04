// A etapa que pede o dia de retomar o contato (a "interesse futuro",
// 2026-11-04) contra o banco DEV, sem rede.
//
//   node --env-file=.env scripts/jiti.mjs scripts/testar-interesse-futuro.ts
//
// Com as funções reais: a conferência do dia (conferirRetomarEm, somarMeses),
// a trava do UPDATE (sem dia não entra, venha de onde vier; com dia grava;
// saindo, apaga), o lote, o quadro (carregarFunil traz o dia e a marca da
// etapa), a remoção de etapa que não despeja leads nela e a etapa criada pela
// migration no ARCK1PRO do DEV. O cenário é um funil de teste com a marca
// "seed-interesse-futuro", apagado no fim.
import { sql } from "../lib/db";
import { removerEtapaNoBanco } from "../lib/etapas";
import { hojeEmBrasilia, somarMeses } from "../lib/formato";
import { carregarFunil } from "../lib/funil";
import { conferirRetomarEm, moverOportunidadeDeEtapa, moverOportunidadesDeEtapa } from "../lib/mover-etapa";

const MARCA = "seed-interesse-futuro";
const ORDEM = ["novo contato", "sem contato", "interesse futuro", "outra"];

let falhas = 0;
function conferir(ok: boolean, texto: string, extra = "") {
  if (!ok) falhas++;
  console.log(`${ok ? "ok   " : "FALHA"} ${texto}${extra ? ` → ${extra}` : ""}`);
}

async function main() {
  if ((process.env.DATABASE_URL ?? "").includes("ep-noisy-pond")) throw new Error("RECUSADO: DATABASE_URL aponta para PRODUÇÃO");
  await limpar();

  // ── O dia ─────────────────────────────────────────────────────────────────
  const hoje = hojeEmBrasilia();
  const tresMeses = somarMeses(hoje, 3);
  conferir(somarMeses("2026-01-31", 1) === "2026-02-28" && somarMeses("2027-11-30", 3) === "2028-02-29", "somarMeses fica no fim do mês (31 jan + 1 = 28 fev; ano bissexto)");
  conferir("erro" in conferirRetomarEm(hoje), "hoje não vale (tem que ser depois de hoje)");
  conferir("data" in conferirRetomarEm(tresMeses), "daqui a 3 meses vale", tresMeses);
  conferir("erro" in conferirRetomarEm("2027-02-30") && "erro" in conferirRetomarEm("12/03/2027") && "erro" in conferirRetomarEm(null), "data inexistente, outro formato e vazio são recusados");
  conferir("erro" in conferirRetomarEm(somarMeses(hoje, 61)), "mais de 5 anos é recusado");

  // ── O cenário ─────────────────────────────────────────────────────────────
  const [funil] = await sql`INSERT INTO funis (nome) VALUES (${`${MARCA} teste`}) RETURNING id`;
  const etapa: Record<string, string> = {};
  for (const [i, nome] of ORDEM.entries()) {
    const [e] = await sql`INSERT INTO etapas (nome, funil_id, ordem, pede_retorno) VALUES (${nome}, ${funil.id}, ${i}, ${nome === "interesse futuro"}) RETURNING id`;
    etapa[nome] = e.id;
  }
  const ops: string[] = [];
  for (const sufixo of ["31", "32"]) {
    const [c] = await sql`INSERT INTO contatos (nome, whatsapp) VALUES (${MARCA}, ${`55009000009${sufixo}`}) RETURNING id`;
    const [o] = await sql`
      INSERT INTO oportunidades (nome, contato_id, funil_id, etapa_id, status)
      VALUES (${MARCA}, ${c.id}, ${funil.id}, ${etapa["novo contato"]}, 'aberta') RETURNING id`;
    ops.push(o.id as string);
  }
  const [op1, op2] = ops;
  const estado = async (id: string) => {
    const [o] = await sql`SELECT etapa_id, to_char(retomar_em, 'YYYY-MM-DD') AS retomar_em FROM oportunidades WHERE id = ${id}`;
    return { etapa: ORDEM.find((n) => etapa[n] === o.etapa_id), retomarEm: o.retomar_em as string | null };
  };
  const linhas = async (id: string) =>
    (await sql`SELECT descricao FROM historico WHERE oportunidade_id = ${id} ORDER BY data_criacao`).map((l) => l.descricao as string);

  // ── A trava ───────────────────────────────────────────────────────────────
  const semDia = await moverOportunidadeDeEtapa(op1, etapa["interesse futuro"], funil.id, " pela IA teste");
  let e1 = await estado(op1);
  conferir(!semDia && e1.etapa === "novo contato" && (await linhas(op1)).length === 0, "sem o dia não entra (o caminho da IA, da cadência e da campanha): fica onde estava, sem histórico", JSON.stringify(e1));

  const comDia = await moverOportunidadeDeEtapa(op1, etapa["interesse futuro"], funil.id, ` · retomar o contato em teste`, tresMeses);
  e1 = await estado(op1);
  conferir(comDia && e1.etapa === "interesse futuro" && e1.retomarEm === tresMeses, "com o dia entra e grava o dia", JSON.stringify(e1));
  conferir((await linhas(op1)).some((l) => l === "Movida de novo contato para interesse futuro · retomar o contato em teste"), "o histórico diz de onde, para onde e o retorno");

  const quadro = await carregarFunil(null);
  const noQuadro = quadro.oportunidades.find((o) => o.id === op1);
  conferir(noQuadro?.retomar_em === tresMeses && quadro.etapaPorId.get(etapa["interesse futuro"])?.pede_retorno === true, "o quadro traz o dia da oportunidade e a marca da etapa");

  await moverOportunidadeDeEtapa(op1, etapa["outra"], funil.id);
  e1 = await estado(op1);
  conferir(e1.etapa === "outra" && e1.retomarEm === null, "saindo para uma etapa que não pede, o dia é apagado", JSON.stringify(e1));

  // ── O lote ────────────────────────────────────────────────────────────────
  const loteSem = await moverOportunidadesDeEtapa([op1, op2], etapa["interesse futuro"], funil.id);
  conferir(loteSem.length === 0 && (await estado(op2)).etapa === "novo contato", "lote sem o dia: ninguém entra");
  const umAno = somarMeses(hoje, 12);
  const loteCom = await moverOportunidadesDeEtapa([op1, op2], etapa["interesse futuro"], funil.id, "", umAno);
  const [s1, s2] = [await estado(op1), await estado(op2)];
  conferir(loteCom.length === 2 && s1.retomarEm === umAno && s2.retomarEm === umAno, "lote com o dia: os dois entram com o mesmo dia", JSON.stringify([s1, s2]));

  // ── Remover etapa ─────────────────────────────────────────────────────────
  await moverOportunidadeDeEtapa(op2, etapa["sem contato"], funil.id);
  const despejar = await removerEtapaNoBanco(etapa["sem contato"], etapa["interesse futuro"]);
  conferir(Boolean(despejar.erro?.includes("pede o dia")) && (await estado(op2)).etapa === "sem contato", "remover uma etapa não despeja os leads dela na que pede retorno", despejar.erro);
  const tirarIf = await removerEtapaNoBanco(etapa["interesse futuro"], etapa["novo contato"]);
  const depois = await estado(op1);
  conferir(!tirarIf.erro && depois.etapa === "novo contato" && depois.retomarEm === null, "remover a que pede retorno leva os leads sem o dia", JSON.stringify({ tirarIf, depois }));

  // ── A migration no DEV ────────────────────────────────────────────────────
  const arck = await sql`
    SELECT e.nome, e.pede_retorno FROM etapas e JOIN funis f ON f.id = e.funil_id
     WHERE upper(trim(f.nome)) = 'ARCK1PRO' ORDER BY e.ordem`;
  const i = arck.findIndex((e) => e.nome === "interesse futuro");
  conferir(i > 0 && arck[i].pede_retorno === true && String(arck[i - 1].nome).toLowerCase() === "sem contato", "a migration pôs “interesse futuro” logo depois de “sem contato” no ARCK1PRO do DEV, pedindo retorno");
}

async function limpar() {
  for (const c of await sql`SELECT id FROM contatos WHERE nome = ${MARCA}`) {
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
