// As ferramentas de POSTAR do conector MCP (app/api/mcp/[segredo], o mesmo link
// das de leitura): publicar e agendar no Instagram e no Facebook dos perfis da
// empresa, no lugar do Metricool (pedido dele, 2026-10-15). O trabalho de
// verdade mora em lib/social/.
//
// A MÍDIA VEM DO DRIVE (ou de link público) e vai direto para a Meta — o CRM
// não guarda o arquivo (2026-10-16). O modelo acha o arquivo com o conector do
// Google Drive dele e passa o link ou o id; quem baixa é o CRM, pela conta de
// serviço (lib/google-drive.ts).
import "server-only";
import { headers } from "next/headers";
import { z } from "zod";
import { enderecoDoCrm } from "@/lib/endereco";
import { idDoDrive } from "@/lib/google-drive";
import type { Ferramenta } from "@/lib/mcp/protocolo";
import { garantirAgendadorDePosts } from "@/lib/social/agendador";
import { cotaDoInstagram } from "@/lib/social/meta-publicar";
import { CHAVES_PERFIS, PERFIS } from "@/lib/social/perfis";
import { cancelarPost, criarPost, editarPost, listarPosts, repetirPost, verPost } from "@/lib/social/posts";

const PERFIL = z.enum(CHAVES_PERFIS).describe("Chave do perfil (veja perfis_sociais).");
const ID = z.uuid().describe("Id do post (vem de criar_post ou listar_posts).");
const DATA = z
  .string()
  .describe('Quando publicar, em horário de Brasília: "AAAA-MM-DD HH:MM" (ou ISO 8601 com fuso). Vazio = agora.');

async function perfisSociais() {
  return Promise.all(
    PERFIS.map(async (p) => ({
      perfil: p.chave,
      nome: p.nome,
      instagram: `@${p.instagram}`,
      facebook: `página ${p.nome}`,
      instagram_posts_nas_ultimas_24h: await cotaDoInstagram(p),
    })),
  );
}

const entradaCriar = z.object({
  perfil: PERFIL,
  redes: z.array(z.enum(["instagram", "facebook"])).min(1).default(["instagram", "facebook"]).describe("Onde publicar. Padrão: as duas."),
  tipo: z.enum(["reels", "story", "feed", "carrossel"]).describe("reels: 1 vídeo · story: 1 imagem ou vídeo · feed: 1 imagem (ou nenhuma, só no Facebook) · carrossel: 2 a 10 mídias."),
  legenda: z.string().max(5000).default("").describe("Texto do post. Instagram: até 2.200 caracteres e 30 hashtags. Story não tem legenda."),
  midias: z
    .array(
      z
        .string()
        .refine((m) => /^https:\/\//i.test(m) || idDoDrive(m) !== null, 'use o link do arquivo no Google Drive, "drive:<id do arquivo>" ou um link https público'),
    )
    .max(10)
    .default([])
    .describe(
      'As mídias, na ordem: o link do arquivo no Google Drive (ou "drive:<id>", o id que o conector do Drive mostra) OU um link https público (ex.: imagem ou vídeo gerado no Kairogen ou no Magnific). O arquivo fica onde está: o CRM busca na hora de publicar.',
    ),
  // O formato que o ChatGPT exige para mandar o arquivo da conversa
  // (`openai/fileParams` no _meta da ferramenta): os quatro campos declarados,
  // só download_url e file_id obrigatórios. Outros clientes não preenchem.
  arquivos: z
    .array(
      z
        .object({
          download_url: z.string(),
          file_id: z.string(),
          mime_type: z.string().optional(),
          file_name: z.string().optional(),
        })
        .meta({ id: "OpenAIFile" }),
    )
    .max(10)
    .optional()
    .describe("Arquivos anexados na conversa (ChatGPT). Entram depois de `midias`, na ordem. Só para post na hora: o link deles vence."),
  colab: z
    .array(z.string().min(1).max(31))
    .max(3)
    .optional()
    .describe(
      "Colab do Instagram: até 3 @ convidados (ex.: [\"fabhricioari\"]). Quando é um dos nossos perfis (perfis_sociais), o CRM aceita o convite sozinho e o post sai nos dois perfis; conta de fora aceita no app. Reels, feed e carrossel — story não aceita.",
    ),
  capa_url: z.url().optional().describe("Capa do Reels no Instagram (link https de uma imagem). Opcional."),
  primeiro_comentario: z.string().max(2200).optional().describe("Comentário publicado logo depois do post. Opcional; não vale para story."),
  publicar_em: DATA.optional(),
});

async function criar(a: z.infer<typeof entradaCriar>) {
  const r = await criarPost({
    perfil: a.perfil,
    redes: a.redes,
    tipo: a.tipo,
    legenda: a.legenda,
    midias: a.midias,
    arquivos: a.arquivos,
    colaboradores: a.colab,
    capaUrl: a.capa_url,
    primeiroComentario: a.primeiro_comentario,
    publicarEm: a.publicar_em,
  });
  // O agendador do n8n só existe com o CRM num endereço público (no
  // localhost não cria). Falhar aqui não desfaz o post: o "para agora" já está
  // publicando, e o agendado avisa para conferir.
  const endereco = enderecoDoCrm(await headers());
  if (endereco.publico) {
    await garantirAgendadorDePosts(endereco.url).catch((e) => {
      console.error("[mcp] agendador dos posts:", e);
      r.avisos.push("Não consegui conferir o agendador no n8n; se o post agendado não sair na hora, avise o TI.");
    });
  }
  return {
    ...r,
    proximo_passo:
      r.publicar_em === "assim que possível"
        ? "Publicando agora. Vídeo pode levar alguns minutos no Instagram: confira com ver_post."
        : `Agendado para ${r.publicar_em} (Brasília). Dá para mudar com editar_post ou cancelar com cancelar_post.`,
  };
}

const entradaListar = z.object({
  perfil: PERFIL.optional(),
  estado: z.enum(["agendado", "publicando", "publicado", "erro", "cancelado"]).optional(),
  limite: z.number().int().min(1).max(100).default(20),
});

const entradaEditar = z.object({
  id: ID,
  legenda: z.string().max(5000).optional(),
  publicar_em: DATA.optional(),
  primeiro_comentario: z.string().max(2200).optional().describe('Texto novo; "" tira o comentário.'),
});

const ESCREVE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

export const FERRAMENTAS_POSTAR: Ferramenta[] = [
  {
    nome: "perfis_sociais",
    titulo: "Perfis das redes",
    descricao:
      "Os perfis em que este conector publica (Facebook e Instagram de cada um), com quantos posts o Instagram já recebeu nas últimas 24 h (teto de 100). Comece por aqui para saber as chaves de perfil.",
    entrada: z.object({}),
    executar: perfisSociais,
  },
  {
    nome: "criar_post",
    titulo: "Criar post",
    descricao:
      "Publica agora ou agenda um post no Instagram e/ou no Facebook de um perfil. Tipos: reels (1 vídeo; no Facebook vai como vídeo da página), story (1 imagem ou vídeo), feed (1 imagem) e carrossel (2 a 10; no Facebook só imagens). " +
      "Colab no Instagram: ponha o @ da outra conta em colab (ex.: post no arck1pro com colab [\"fabhricioari\"]) — entre os nossos perfis o convite é aceito sozinho. " +
      "A mídia vem do Google Drive da empresa: ache o arquivo com o conector do Drive e passe o link ou drive:<id> em midias (o CRM lê o Drive pela conta de serviço dele). Link https público também serve. No ChatGPT, o arquivo anexado pode ir em arquivos (só para post na hora). " +
      "O CRM não guarda cópia: na hora de publicar, busca o arquivo na fonte e manda direto para a Meta (vídeo até 1 GB). Arquivo que não está no Drive nem tem link público: peça à pessoa para salvar no Drive. " +
      "Sem publicar_em, publica em seguida; com data, o CRM publica no horário (Brasília) — o arquivo precisa continuar no Drive até lá. Devolve o id para acompanhar com ver_post. " +
      "Confirme com a pessoa o texto, as mídias, o perfil e o horário antes de chamar: publicar é público.",
    entrada: entradaCriar,
    executar: criar,
    anotacoes: ESCREVE,
    meta: { "openai/fileParams": ["arquivos"] },
  },
  {
    nome: "listar_posts",
    titulo: "Listar posts",
    descricao: "Posts criados por este conector, do mais novo para o mais velho, com estado (agendado, publicando, publicado, erro, cancelado), horário e, por rede, o link publicado ou o erro.",
    entrada: entradaListar,
    executar: (a: z.infer<typeof entradaListar>) => listarPosts(a),
  },
  {
    nome: "ver_post",
    titulo: "Ver post",
    descricao: "Um post inteiro: legenda completa, mídias, horário, estado e o resultado em cada rede (link ou motivo do erro).",
    entrada: z.object({ id: ID }),
    executar: (a: { id: string }) => verPost(a.id),
  },
  {
    nome: "editar_post",
    titulo: "Editar post agendado",
    descricao: "Muda a legenda, o horário ou o primeiro comentário de um post que ainda está agendado. publicar_em vazio (\"\") publica agora. Para trocar mídia, cancele e crie de novo.",
    entrada: entradaEditar,
    executar: (a: z.infer<typeof entradaEditar>) =>
      editarPost(a.id, { legenda: a.legenda, publicarEm: a.publicar_em, primeiroComentario: a.primeiro_comentario }),
    anotacoes: ESCREVE,
  },
  {
    nome: "cancelar_post",
    titulo: "Cancelar post agendado",
    descricao: "Cancela um post que ainda está agendado (o que já foi publicado não é apagado das redes).",
    entrada: z.object({ id: ID }),
    executar: (a: { id: string }) => cancelarPost(a.id),
    anotacoes: { ...ESCREVE, destructiveHint: true, idempotentHint: true },
  },
  {
    nome: "repetir_post",
    titulo: "Repetir post com erro",
    descricao:
      "Tenta publicar de novo um post que terminou em erro, só nas redes que falharam (onde já saiu não repete). Publica em seguida. " +
      "Se o erro do Facebook diz que a publicação foi interrompida no meio, confira a página antes: o post pode ter saído.",
    entrada: z.object({ id: ID }),
    executar: (a: { id: string }) => repetirPost(a.id),
    anotacoes: ESCREVE,
  },
];
