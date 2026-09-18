// Onde os arquivos do CRM ficam de verdade: Supabase Storage.
//
// POR QUE ISTO EXISTE, e vale escrito porque custou um bug em produção: antes
// os bytes iam para disco local (`.documentos/`, `.midias/`). Funciona em
// `next dev`, e NÃO funciona no deploy — o CRM roda na Vercel, onde o sistema
// de arquivos é somente-leitura fora de /tmp e cada invocação pode cair numa
// instância diferente. O sintoma foi exatamente este, na primeira cadência com
// anexo:
//
//   ENOENT: no such file or directory, open '.documentos/2026/09/mu799h2f-….pdf'
//
// O arquivo tinha sido subido pelo localhost e estava no disco daquela máquina.
// O Neon é compartilhado, então a linha em `documentos` existia para todo mundo
// — só os bytes é que não. Disco local mente: o banco diz que o documento
// existe e o servidor que precisa dele não o enxerga.
//
// O PROJETO SUPABASE É COMPARTILHADO com outros usos da empresa (buckets
// `docs`, `scp`, `fotos-*`, `videos`). Por isso o CRM escreve num bucket
// PRÓPRIO, `crm-documentos`, criado à parte: listar, sobrescrever ou apagar
// aqui nunca pode alcançar arquivo de outro sistema. É a mesma regra que vale
// para a instância uazapi e para o n8n — entrar ao lado, não repontar.
//
// SÓ O STORAGE vem daqui. Os dados continuam no Neon (lib/db.ts); este projeto
// não tem tabela nenhuma do CRM.
import "server-only";

const URL_BASE = () => {
  const u = process.env.SUPABASE_URL;
  if (!u) throw new Error("SUPABASE_URL não definida no ambiente");
  return u.replace(/\/+$/, "");
};

// Chave de SERVIDOR: ignora RLS, e é por isso que nunca pode ser NEXT_PUBLIC_.
// Quem decide se a pessoa pode ver o arquivo é a rota que o entrega, depois de
// conferir a sessão (app/api/documentos/[id]).
const CHAVE = () => {
  const k = process.env.SUPABASE_SECRET_KEY;
  if (!k) throw new Error("SUPABASE_SECRET_KEY não definida no ambiente");
  return k;
};

export const BUCKET_DOCUMENTOS =
  process.env.SUPABASE_BUCKET_DOCUMENTOS ?? "crm-documentos";

function cabecalhos(): Record<string, string> {
  const k = CHAVE();
  return { apikey: k, Authorization: `Bearer ${k}` };
}

/**
 * Sobe os bytes e devolve o caminho dentro do bucket — que é o que vai para
 * `documentos.caminho`, no lugar do antigo caminho de disco.
 *
 * `upsert: false`: o nome já é sorteado por quem chama, então colisão aqui
 * significa bug, não arquivo repetido. Falhar é melhor que sobrescrever em
 * silêncio o documento de outra pessoa.
 */
export async function subir(
  bucket: string,
  caminho: string,
  bytes: Uint8Array,
  mime: string,
): Promise<string> {
  const res = await fetch(
    `${URL_BASE()}/storage/v1/object/${bucket}/${encodeURI(caminho)}`,
    {
      method: "POST",
      headers: {
        ...cabecalhos(),
        "Content-Type": mime || "application/octet-stream",
        "x-upsert": "false",
      },
      body: new Uint8Array(bytes) as unknown as BodyInit,
      cache: "no-store",
      // Generoso de propósito: é upload de arquivo, não uma consulta.
      signal: AbortSignal.timeout(120_000),
    },
  );

  if (!res.ok) {
    const corpo = await res.text().catch(() => "");
    throw new Error(
      `Supabase Storage recusou o upload (${res.status}): ${corpo.slice(0, 300)}`,
    );
  }
  return caminho;
}

/** Bytes de um arquivo. `caminho` vem do banco, nunca do usuário. */
export async function baixar(bucket: string, caminho: string): Promise<Buffer> {
  const res = await fetch(
    `${URL_BASE()}/storage/v1/object/${bucket}/${encodeURI(caminho)}`,
    {
      headers: cabecalhos(),
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    },
  );

  if (!res.ok) {
    // 404 aqui é o equivalente do ENOENT de antes: a linha existe e o objeto
    // não. Quem chama traduz isso em 410 para a tela.
    throw new Error(
      `Supabase Storage não devolveu o arquivo (${res.status}): ${caminho}`,
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Apaga o objeto. NÃO lança quando o arquivo já não está lá: quem chama está
 * removendo um documento, e a linha do banco é a fonte da verdade — falhar
 * aqui só deixaria a linha viva apontando para o vazio.
 */
export async function remover(bucket: string, caminho: string): Promise<void> {
  try {
    await fetch(
      `${URL_BASE()}/storage/v1/object/${bucket}/${encodeURI(caminho)}`,
      {
        method: "DELETE",
        headers: cabecalhos(),
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      },
    );
  } catch (e) {
    console.error(`[armazenamento] falhei ao apagar ${bucket}/${caminho}:`, e);
  }
}
