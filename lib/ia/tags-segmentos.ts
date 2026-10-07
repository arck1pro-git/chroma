import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { sql } from "@/lib/db";
import { criarSegmento, criarTag } from "@/app/configuracoes/actions";

// A IA CRIA TAG E SEGMENTO (pedido dele, 2026-10-06: "a ia pode criar tags e
// segmentos").
//
// Para quê: as IAs que montam captação e campanha já MARCAM tag e PÕEM em
// segmento, mas só escolhiam entre os que existiam — pedir "marque esses leads
// com a tag Black Friday" esbarrava numa tag que ninguém tinha criado, e a
// conversa parava para a pessoa ir em Configurações. Agora a IA cria e segue.
//
// As mesmas três escolhas das outras ferramentas que escrevem:
//   · ESCREVE PELAS AÇÕES DA TELA (app/configuracoes/actions.ts), não por SQL:
//     a mesma validação, o mesmo revalidatePath. Por isso vale a mesma porta —
//     só entra para quem tem o módulo Configurações (quem chama confere).
//   · NÃO DUPLICA: o nome é UNIQUE no banco, mas "Site" e "site" passariam. Já
//     existindo, devolve o que existe — pedir duas vezes não cria duas.
//   · NÃO APAGA, NÃO RENOMEIA e NÃO PÕE NINGUÉM DENTRO: criar é só o nome. O
//     contato entra pela ação da captação ou da campanha, ou à mão.

const TIPOS = {
  tag: {
    artigo: "a tag",
    vazio: "Ela nasce vazia",
    criar: criarTag,
    achar: (nome: string) => sql`SELECT id, nome FROM tags WHERE lower(nome) = lower(${nome})`,
  },
  segmento: {
    artigo: "o segmento",
    vazio: "Ele nasce vazio",
    criar: criarSegmento,
    achar: (nome: string) => sql`SELECT id, nome FROM segmentos WHERE lower(nome) = lower(${nome})`,
  },
} as const;

async function criarOuAchar(tipo: keyof typeof TIPOS, bruto: string): Promise<string> {
  const t = TIPOS[tipo];
  const nome = bruto.trim().replace(/\s+/g, " ");
  if (!nome) return `RECUSADO: ${t.artigo} precisa de um nome.`;
  if (nome.length > 60) return `RECUSADO: nome com mais de 60 caracteres. Use um nome curto, como aparece na tela.`;
  const [existente] = await t.achar(nome);
  if (existente) return `Já existia ${t.artigo} "${existente.nome}", id ${existente.id}. Use esse id; nada foi criado.`;
  try {
    const id = await t.criar(nome);
    return `Criei ${t.artigo} "${nome}", id ${id}. ${t.vazio}: ninguém entra até uma ação (da captação ou da campanha) ou alguém da equipe pôr.`;
  } catch (e) {
    return `RECUSADO: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export function ferramentasDeTagsESegmentos() {
  let gravou = false;
  const marcar = (r: string) => {
    if (r.startsWith("Criei")) gravou = true;
    return r;
  };

  const criarTagIa = betaZodTool({
    name: "criar_tag",
    description:
      "Cria uma tag de contato e devolve o id. Use quando a tag que o pedido precisa não está na lista de tags (listar_alvos ou listar_alvos_campanha). Se já existir uma com o mesmo nome, devolve a existente.",
    inputSchema: z.object({
      nome: z.string().describe('curto, como aparece na tela, ex. "Black Friday" ou "Lead quente"'),
    }),
    run: async ({ nome }) => marcar(await criarOuAchar("tag", nome)),
  });

  const criarSegmentoIa = betaZodTool({
    name: "criar_segmento",
    description:
      "Cria um segmento de contatos e devolve o id. Use quando o segmento que o pedido precisa não está na lista de segmentos. Se já existir um com o mesmo nome, devolve o existente. O segmento nasce VAZIO.",
    inputSchema: z.object({
      nome: z.string().describe('curto, como aparece na tela, ex. "Respondeu campanha de outubro"'),
    }),
    run: async ({ nome }) => marcar(await criarOuAchar("segmento", nome)),
  });

  return { ferramentas: [criarTagIa, criarSegmentoIa], gravou: () => gravou };
}

// Sem título: cada system põe o seu (o modo completo usa "## …").
export const REGRAS_DE_TAGS = `- Precisa marcar com uma tag ou pôr num segmento que não está na lista? Crie com criar_tag ou criar_segmento e use o id que voltar. Antes, olhe a lista: se já houver um com nome parecido ("Site" e "Site oficial", "BF" e "Black Friday"), use o existente em vez de criar outro.
- Nome curto, do jeito que a equipe vai ler na tela.
- Criar não põe ninguém dentro. Segmento novo nasce vazio: serve de destino de uma ação (adicionar_segmento), não de público de campanha — campanha para um segmento vazio não manda para ninguém.
- Você não apaga nem renomeia tag ou segmento. Se pedirem, diga que é em Configurações.`;
