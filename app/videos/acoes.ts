"use server";

// Mutações da tela de vídeos.
//
// O UPLOAD É EM TRÊS TEMPOS, e nenhum byte de vídeo passa pelo CRM:
//   1. `prepararEnvio` confere tipo e tamanho e devolve duas URLs assinadas (o
//      vídeo e a capa) — a Vercel corta corpo acima de ~4,5 MB, e server action
//      acima de 1 MB;
//   2. o navegador sobe direto para o Supabase (app/videos/painel.tsx);
//   3. `registrarVideo` confere no Storage que o arquivo chegou e só então cria
//      a linha. Tamanho e tipo saem do Storage, não do que o navegador disse.
import { revalidatePath } from "next/cache";
import { exigirModulo } from "@/lib/auth/dal";
import { infoDoObjeto, limiteDoBucket, remover, urlDeEnvio } from "@/lib/armazenamento";
import {
  BUCKET_VIDEOS,
  CAMINHO_VALIDO,
  caminhoDaCapa,
  criarVideo,
  excluirVideo,
  novoCaminho,
  renomearVideo,
} from "@/lib/videos";

export type Resultado = { ok: boolean; mensagem: string };

const TETO_NOME = 120;
const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

function idValido(id: unknown): id is string {
  return typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id);
}

export async function prepararEnvio(dados: {
  nomeArquivo: unknown;
  mime: unknown;
  tamanho: unknown;
}): Promise<{ ok: true; caminho: string; url: string; urlCapa: string } | { ok: false; mensagem: string }> {
  await exigirModulo("videos");
  const mime = typeof dados.mime === "string" ? dados.mime : "";
  const tamanho = Number(dados.tamanho);
  const nomeArquivo = typeof dados.nomeArquivo === "string" ? dados.nomeArquivo : "";

  if (!mime.startsWith("video/")) return { ok: false, mensagem: "Escolha um arquivo de vídeo." };
  if (!Number.isFinite(tamanho) || tamanho <= 0) return { ok: false, mensagem: "Arquivo vazio." };

  const limite = await limiteDoBucket(BUCKET_VIDEOS);
  if (limite && tamanho > limite) {
    return {
      ok: false,
      mensagem: `O vídeo tem ${mb(tamanho)} e o limite por arquivo é ${mb(limite)}. Exporte em resolução menor (720p costuma bastar no celular) e suba de novo.`,
    };
  }

  const caminho = novoCaminho(nomeArquivo, mime);
  const [url, urlCapa] = await Promise.all([
    urlDeEnvio(BUCKET_VIDEOS, caminho),
    urlDeEnvio(BUCKET_VIDEOS, caminhoDaCapa(caminho)),
  ]);
  return { ok: true, caminho, url, urlCapa };
}

export async function registrarVideo(dados: {
  caminho: unknown;
  nome: unknown;
  mime: unknown;
  duracao: unknown;
  largura: unknown;
  altura: unknown;
  temCapa: unknown;
}): Promise<{ ok: true; id: string } | { ok: false; mensagem: string }> {
  const { usuario } = await exigirModulo("videos");
  const caminho = typeof dados.caminho === "string" ? dados.caminho : "";
  if (!CAMINHO_VALIDO.test(caminho)) return { ok: false, mensagem: "Envio inválido." };

  const info = await infoDoObjeto(BUCKET_VIDEOS, caminho);
  if (!info) return { ok: false, mensagem: "O arquivo não chegou ao Supabase. Tente subir de novo." };

  const capa = dados.temCapa === true ? caminhoDaCapa(caminho) : null;
  const capaChegou = capa ? Boolean(await infoDoObjeto(BUCKET_VIDEOS, capa)) : false;

  const numero = (v: unknown, max: number) =>
    typeof v === "number" && Number.isFinite(v) && v > 0 && v < max ? v : null;
  const nome = (typeof dados.nome === "string" ? dados.nome.trim() : "").slice(0, TETO_NOME) || "Vídeo sem nome";

  const id = await criarVideo({
    nome,
    caminho,
    capa: capaChegou ? capa : null,
    mime: info.mime || (typeof dados.mime === "string" ? dados.mime : "video/mp4"),
    tamanho: info.tamanho,
    duracao: numero(dados.duracao, 86400),
    largura: numero(dados.largura, 10000) && Math.round(dados.largura as number),
    altura: numero(dados.altura, 10000) && Math.round(dados.altura as number),
    autorId: usuario.id,
  });

  revalidatePath("/videos");
  return { ok: true, id };
}

export async function salvarNome(id: unknown, nome: unknown): Promise<Resultado> {
  await exigirModulo("videos");
  if (!idValido(id)) return { ok: false, mensagem: "Vídeo inválido." };
  const limpo = (typeof nome === "string" ? nome.trim() : "").slice(0, TETO_NOME);
  if (!limpo) return { ok: false, mensagem: "Dê um nome ao vídeo." };
  await renomearVideo(id, limpo);
  revalidatePath("/videos");
  return { ok: true, mensagem: "Nome salvo. O link continua o mesmo." };
}

/**
 * Exclui o vídeo, o que se mediu dele e os arquivos. O link que já foi mandado
 * passa a dar "não encontrado" — a tela avisa isso antes de confirmar.
 */
export async function apagarVideo(id: unknown): Promise<Resultado> {
  await exigirModulo("videos");
  if (!idValido(id)) return { ok: false, mensagem: "Vídeo inválido." };
  const apagado = await excluirVideo(id);
  if (!apagado) return { ok: false, mensagem: "Este vídeo já não existe." };
  await Promise.all([
    remover(BUCKET_VIDEOS, apagado.caminho),
    apagado.capa ? remover(BUCKET_VIDEOS, apagado.capa) : Promise.resolve(),
  ]);
  revalidatePath("/videos");
  return { ok: true, mensagem: "Vídeo excluído." };
}
