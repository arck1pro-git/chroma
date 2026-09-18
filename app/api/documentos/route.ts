// Subir arquivo para a biblioteca.
//
// POR QUE UMA ROTA E NÃO UMA SERVER ACTION, que é o padrão de mutação deste app:
// o corpo de uma server action topa 1 MB por padrão
// (node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md),
// e documento é justamente o que passa disso. Dá para levantar o
// `bodySizeLimit`, mas ele vale para TODA server action do app — um teto de
// 32 MB em cada botão de salvar do CRM para atender um upload. Route Handler
// não tem esse teto, então o limite fica onde deve ficar: só aqui.
//
// Quem confere o tamanho de verdade é lib/documentos.ts; aqui a checagem é
// antecipada, para recusar antes de puxar o arquivo inteiro para a memória.
import { NextRequest } from "next/server";
import { exigirModuloApi } from "@/lib/auth/dal";
import { criarDocumento, TETO_MB } from "@/lib/documentos";

export const dynamic = "force-dynamic";

const TETO_NOME = 120;
const TETO_DESCRICAO = 500;

function texto(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export async function POST(req: NextRequest) {
  const acesso = await exigirModuloApi("documentos");
  if (acesso instanceof Response) return acesso;

  // O `content-length` é dica, não garantia — um cliente pode mentir. Serve
  // para o caso honesto: recusar 400 MB sem antes lê-los.
  const declarado = Number(req.headers.get("content-length") ?? 0);
  if (declarado > (TETO_MB + 2) * 1024 * 1024) {
    return Response.json(
      { erro: `Arquivo acima do limite de ${TETO_MB} MB.` },
      { status: 413 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ erro: "envio inválido" }, { status: 400 });
  }

  const arquivo = form.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return Response.json({ erro: "Escolha um arquivo." }, { status: 400 });
  }

  // Sem nome digitado, o nome do arquivo vira o título. É o atalho que faz
  // subir cinco PDFs de uma vez não virar cinco formulários — dá para renomear
  // depois, na lista.
  const nome =
    texto(form.get("nome"), TETO_NOME) ||
    arquivo.name.replace(/\.[^.]+$/, "").slice(0, TETO_NOME) ||
    "Documento";

  try {
    const doc = await criarDocumento({
      nome,
      descricao: texto(form.get("descricao"), TETO_DESCRICAO) || null,
      arquivoNome: arquivo.name,
      mime: arquivo.type,
      bytes: new Uint8Array(await arquivo.arrayBuffer()),
      criadoPor: acesso.usuario.id,
    });
    return Response.json({ ok: true, documento: doc });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // ux_documentos_nome é UNIQUE em lower(nome) entre os não arquivados: dois
    // "Tabela de preços" tornariam a escolha na hora de anexar um chute. Mesma
    // tradução que os Contextos fazem, e pelo mesmo motivo — o erro do Postgres
    // não serve para ler.
    if (/ux_documentos_nome|duplicate key/i.test(msg)) {
      return Response.json(
        { erro: `Já existe um documento chamado "${nome}".` },
        { status: 409 },
      );
    }
    // 42P01 = undefined_table: a migração ainda não rodou. Dizer O QUE rodar
    // vale mais que repassar o erro do Postgres — em produção o Next redige a
    // mensagem e sobraria um "erro no servidor" sem pista nenhuma.
    if (/relation "documentos" does not exist|42P01/i.test(msg)) {
      return Response.json(
        { erro: "Falta rodar migration-documentos.sql no banco." },
        { status: 500 },
      );
    }
    return Response.json({ erro: msg }, { status: 400 });
  }
}
