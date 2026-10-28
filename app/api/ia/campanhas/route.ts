// A IA da tela de Campanhas. Dois modos, pelo corpo:
//   · o de sempre: monta RASCUNHO no banco pelo formato simples
//     (lib/ia/campanhas.ts), ou o modo completo, para o TI (lib/ia/completa.ts);
//   · o do CONSTRUTOR (`construtor: "1"`, 2026-10-28): desenha o fluxo no canvas
//     aberto e não grava nada (lib/ia/campanhas-construtor.ts). O desvio vem
//     ANTES do modo completo e não herda as ferramentas dele: o conjunto é
//     fechado. A guarda pede as operações do clique que vem depois: editar
//     (campanha salva) ou criar (campanha nova).
import { NextRequest } from "next/server";
import { exigirModuloApi } from "@/lib/auth/dal";
import { EVENTO_DESENHO } from "@/lib/campanhas-fluxo";
import { respostaErroMeta, wabasMeta } from "@/lib/meta";
import { conversar, historicoDe, texto } from "@/lib/ia/conversa";
import { ferramentasDeCampanhas, SISTEMA_CAMPANHAS } from "@/lib/ia/campanhas";
import {
  contextoDoConstrutor,
  falasDaPessoa,
  ferramentasDoConstrutor,
  ITERACOES_DO_CONSTRUTOR,
  lerPedidoDoConstrutor,
  SISTEMA_CONSTRUTOR,
} from "@/lib/ia/campanhas-construtor";
import { conversaCompleta, temIaCompleta } from "@/lib/ia/completa";
import { ferramentasDeTagsESegmentos, REGRAS_DE_TAGS } from "@/lib/ia/tags-segmentos";

export const dynamic="force-dynamic";
export async function POST(req:NextRequest){
  const acesso=await exigirModuloApi("campanhas");if(acesso instanceof Response)return acesso;
  let cru:string;let corpo:Record<string,unknown>;
  try{cru=await req.text();corpo=JSON.parse(cru)}catch{return Response.json({erro:"Corpo inválido."},{status:400})}
  if(!corpo||typeof corpo!=="object")return Response.json({erro:"Corpo inválido."},{status:400});
  if(corpo.construtor==="1")return conversaDoConstrutor(corpo,cru.length);
  // O TI conversa no modo completo em qualquer tela (lib/ia/completa.ts).
  if(temIaCompleta(acesso.usuario))return conversaCompleta({usuario:acesso.usuario,corpo});
  const pergunta=texto(corpo.pergunta,4000).trim();if(!pergunta)return Response.json({erro:"Pergunta vazia."},{status:400});
  const {ferramentas,gravou}=ferramentasDeCampanhas(acesso.usuario.id);
  // Criar tag e segmento é da tela de Configurações: só entra para quem tem o módulo (lib/ia/tags-segmentos.ts).
  const tags=acesso.usuario.modulos.has("configuracoes")?ferramentasDeTagsESegmentos():null;
  const sistema=tags?`${SISTEMA_CAMPANHAS}\n\nTAGS E SEGMENTOS\n${REGRAS_DE_TAGS}`:SISTEMA_CAMPANHAS;
  return conversar({sistema,ferramentas:[...ferramentas,...(tags?.ferramentas??[])],pergunta,historico:historicoDe(corpo.historico),contexto:texto(corpo.contexto,500),eventosFinais:()=>gravou()||tags?.gravou()?[{t:"mudou"}]:[]});
}

/**
 * O modo construtor. Tudo o que depende de quem pede (a guarda, a conta do
 * WhatsApp) é conferido aqui, antes do stream: as ferramentas rodam depois que
 * esta função já respondeu e recebem o usuário pronto, sem sessão nem cookie.
 */
async function conversaDoConstrutor(corpo: Record<string, unknown>, tamanho: number): Promise<Response> {
  const lido = lerPedidoDoConstrutor(corpo, tamanho);
  if (!lido.ok) return Response.json({ erro: lido.erro }, { status: lido.status });
  const { waba, campanhaId, fluxoAberto } = lido.pedido;

  const acesso = await exigirModuloApi("campanhas", campanhaId ? "editar" : "criar");
  if (acesso instanceof Response) return acesso;
  const pergunta = texto(corpo.pergunta, 4000).trim();
  if (!pergunta) return Response.json({ erro: "Pergunta vazia." }, { status: 400 });

  // O id da conta entra no caminho da Graph: só uma que o token do CRM enxerga.
  try {
    if (!(await wabasMeta()).some((w) => w.id === waba)) {
      return Response.json({ erro: "Essa conta do WhatsApp não está entre as do CRM." }, { status: 400 });
    }
  } catch (e) {
    return respostaErroMeta(e);
  }

  const historico = historicoDe(corpo.historico);
  const { ferramentas, desenho } = ferramentasDoConstrutor({
    usuario: acesso.usuario,
    waba,
    campanhaId,
    fluxoAberto,
    falasDaPessoa: falasDaPessoa(pergunta, historico),
  });
  return conversar({
    sistema: SISTEMA_CONSTRUTOR,
    ferramentas,
    pergunta,
    historico,
    // Montado aqui, e o `contexto` do corpo não entra (revisão de segurança M2):
    // só se a campanha é nova ou salva. O fluxo entra por ver_fluxo_aberto.
    contexto: contextoDoConstrutor(campanhaId),
    maxIteracoes: ITERACOES_DO_CONSTRUTOR,
    // Só o último desenho válido, e nunca "mudou": nada foi gravado.
    eventosFinais: () => {
      const d = desenho();
      return d ? [{ t: EVENTO_DESENHO, v: d }] : [];
    },
  });
}
