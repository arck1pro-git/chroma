// O envio de documentos direto para o Storage (2026-10-28) contra o banco DEV
// e o Supabase Storage do .env.
//
//   node --env-file=.env scripts/jiti.mjs scripts/testar-documentos-envio.ts
//
// Faz o que a tela faz (app/documentos/painel.tsx): sorteia o caminho, sobe
// por PUT multipart na URL assinada e registra com as funções reais de
// lib/documentos.ts. Confere também as recusas: caminho que o servidor não
// sorteou, arquivo que não chegou, caminho já registrado, nome repetido e
// arquivo acima do teto (o teto vai a 1 MB só neste processo). Tudo leva a
// marca "seed-documentos-envio" e sai do banco e do bucket no fim.
import { BUCKET_DOCUMENTOS, infoDoObjeto, remover, urlDeEnvio } from "@/lib/armazenamento";
import { sql } from "@/lib/db";

const MARCA = "seed-documentos-envio";
const enviados: string[] = [];

let falhas = 0;
function conferir(ok: boolean, texto: string, extra = "") {
  if (!ok) falhas++;
  console.log(`${ok ? "ok   " : "FALHA"} ${texto}${extra ? ` → ${extra}` : ""}`);
}

/** O mesmo PUT da tela: multipart, campo sem nome, o token na própria URL. */
async function subirComoATela(caminho: string, bytes: Uint8Array, nome: string, mime: string) {
  enviados.push(caminho);
  const corpo = new FormData();
  corpo.append("cacheControl", "3600");
  corpo.append("", new Blob([new Uint8Array(bytes)], { type: mime }), nome);
  const res = await fetch(await urlDeEnvio(BUCKET_DOCUMENTOS, caminho), {
    method: "PUT",
    headers: { "x-upsert": "false" },
    body: corpo,
  });
  if (!res.ok) throw new Error(`o PUT na URL assinada falhou (${res.status}): ${await res.text()}`);
}

/** A recusa (ou o erro) de uma chamada que deveria falhar. */
async function erroDe(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return null;
  } catch (e) {
    return e;
  }
}

/** getRandomValues enche no máximo 64 KB por vez. */
function bytesAleatorios(n: number) {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i += 65536) crypto.getRandomValues(b.subarray(i, Math.min(n, i + 65536)));
  return b;
}

async function limpar() {
  const linhas = await sql`DELETE FROM documentos WHERE nome LIKE ${`${MARCA}%`} RETURNING caminho`;
  await Promise.all([...linhas.map((l) => l.caminho as string), ...enviados].map((c) => remover(BUCKET_DOCUMENTOS, c)));
}

async function main() {
  if ((process.env.DATABASE_URL ?? "").includes("ep-noisy-pond")) throw new Error("RECUSADO: DATABASE_URL aponta para PRODUÇÃO");
  // Lido quando lib/documentos.ts carrega: por isso o import é depois daqui.
  // Tudo por "@/lib/…", como a própria lib importa: por "../lib/…" o runner
  // carrega outra cópia do módulo e o `instanceof Recusa` dá falso.
  process.env.DOCUMENTOS_TETO_MB = "1";
  const doc = await import("@/lib/documentos");
  const { Recusa, ehDuplicado } = await import("@/lib/resultado-acao");
  await limpar();

  // ── O caminho é do servidor ────────────────────────────────────────────────
  const caminho = doc.novoCaminho(`${MARCA}.MP4`);
  conferir(doc.CAMINHO_VALIDO.test(caminho) && caminho.endsWith(".mp4"), "novoCaminho sorteia AAAA/MM/<sorteio>.mp4", caminho);
  const semExt = doc.novoCaminho("../../etc/arquivo.p df");
  conferir(doc.CAMINHO_VALIDO.test(semExt) && !semExt.includes(".."), "extensão estranha e barra no nome não entram no caminho", semExt);
  for (const ruim of ["../2026/10/abc-1234abcd.pdf", "2026/10/abc.pdf", "2026/10/abc-1234567g.pdf", "2026/10/a/b-1234abcd.pdf"]) {
    conferir(!doc.CAMINHO_VALIDO.test(ruim), `caminho que o servidor não sorteia é recusado: ${ruim}`);
  }
  const forjado = await erroDe(doc.registrarDocumento({ nome: `${MARCA} forjado`, descricao: null, arquivoNome: "x.pdf", caminho: "../segredo.pdf", criadoPor: null }));
  conferir(forjado instanceof Recusa && forjado.message === "Envio inválido.", "registrar caminho forjado é recusado", String((forjado as Error)?.message));

  // ── Arquivo que não chegou ─────────────────────────────────────────────────
  const naoSubiu = await erroDe(doc.registrarDocumento({ nome: `${MARCA} sem arquivo`, descricao: null, arquivoNome: "x.pdf", caminho: doc.novoCaminho("x.pdf"), criadoPor: null }));
  conferir(naoSubiu instanceof Recusa && /não chegou/.test(naoSubiu.message), "registrar sem o arquivo no Storage é recusado", String((naoSubiu as Error)?.message));

  // ── O caminho feliz ────────────────────────────────────────────────────────
  const bytes = bytesAleatorios(300_000);
  await subirComoATela(caminho, bytes, `${MARCA}.MP4`, "video/mp4");
  const nome = `${MARCA} vídeo`;
  const novo = await doc.registrarDocumento({ nome, descricao: null, arquivoNome: `${MARCA}.MP4`, caminho, criadoPor: null });
  conferir(novo.tamanho === bytes.byteLength, "o tamanho vem do Storage", `${novo.tamanho}`);
  conferir(novo.tipo === "video" && novo.mime === "video/mp4", "tipo e mime vêm do Storage", `${novo.tipo} ${novo.mime}`);
  const salvo = await doc.comCaminho(novo.id);
  const devolta = salvo ? await doc.lerArquivo(salvo.caminho) : Buffer.alloc(0);
  conferir(salvo?.caminho === caminho && Buffer.compare(devolta, Buffer.from(bytes)) === 0, "o arquivo lido de volta é o mesmo, byte a byte");
  conferir(await doc.nomeEmUso(`  ${nome.toUpperCase()} `), "nomeEmUso segue o índice (sem caixa e sem espaço nas pontas)");

  // ── Caminho já registrado: recusa e NÃO apaga o arquivo do outro ───────────
  const repetido = await erroDe(doc.registrarDocumento({ nome: `${MARCA} cópia`, descricao: null, arquivoNome: "x.mp4", caminho, criadoPor: null }));
  conferir(repetido instanceof Recusa, "registrar de novo o mesmo caminho é recusado", String((repetido as Error)?.message));
  conferir(Boolean(await infoDoObjeto(BUCKET_DOCUMENTOS, caminho)), "e o arquivo do documento que já existia continua no bucket");

  // ── Nome repetido: o banco recusa e o arquivo novo sai do bucket ───────────
  const outro = doc.novoCaminho("outro.pdf");
  await subirComoATela(outro, bytesAleatorios(1000), "outro.pdf", "application/pdf");
  const duplicado = await erroDe(doc.registrarDocumento({ nome, descricao: null, arquivoNome: "outro.pdf", caminho: outro, criadoPor: null }));
  conferir(ehDuplicado(duplicado), "nome repetido cai no índice único (a ação traduz)", String((duplicado as Error)?.message).slice(0, 80));
  conferir(!(await infoDoObjeto(BUCKET_DOCUMENTOS, outro)), "e o arquivo que não virou documento sai do bucket");

  // ── Acima do teto (1 MB neste processo) ────────────────────────────────────
  const grande = doc.novoCaminho("grande.pdf");
  await subirComoATela(grande, bytesAleatorios(1_200_000), "grande.pdf", "application/pdf");
  const acima = await erroDe(doc.registrarDocumento({ nome: `${MARCA} grande`, descricao: null, arquivoNome: "grande.pdf", caminho: grande, criadoPor: null }));
  conferir(acima instanceof Recusa && /acima do limite de 1 MB/.test(acima.message), "arquivo acima do teto é recusado", String((acima as Error)?.message));
  conferir(!(await infoDoObjeto(BUCKET_DOCUMENTOS, grande)), "e sai do bucket");

  // ── Sem tipo: a extensão decide ────────────────────────────────────────────
  const foto = doc.novoCaminho("foto.jpg");
  await subirComoATela(foto, bytesAleatorios(2000), "foto.jpg", "");
  const semTipo = await doc.registrarDocumento({ nome: `${MARCA} foto`, descricao: null, arquivoNome: "foto.jpg", caminho: foto, criadoPor: null });
  conferir(semTipo.tipo === "imagem", "arquivo sem tipo vira imagem pela extensão", `${semTipo.tipo} ${semTipo.mime}`);
}

main()
  .catch((e) => {
    falhas++;
    console.error("ERRO:", e);
  })
  .finally(async () => {
    await limpar().catch((e) => console.error("limpeza falhou:", e));
    await sql.end();
    console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo certo");
    process.exit(falhas ? 1 : 0);
  });
