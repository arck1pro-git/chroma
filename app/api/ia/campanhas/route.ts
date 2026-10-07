import { NextRequest } from "next/server";
import { exigirModuloApi } from "@/lib/auth/dal";
import { conversar, historicoDe, texto } from "@/lib/ia/conversa";
import { ferramentasDeCampanhas, SISTEMA_CAMPANHAS } from "@/lib/ia/campanhas";
import { conversaCompleta, temIaCompleta } from "@/lib/ia/completa";
import { ferramentasDeTagsESegmentos, REGRAS_DE_TAGS } from "@/lib/ia/tags-segmentos";

export const dynamic="force-dynamic";
export async function POST(req:NextRequest){
  const acesso=await exigirModuloApi("campanhas");if(acesso instanceof Response)return acesso;
  let corpo:Record<string,unknown>;try{corpo=await req.json()}catch{return Response.json({erro:"Corpo inválido."},{status:400})}
  // O TI conversa no modo completo em qualquer tela (lib/ia/completa.ts).
  if(temIaCompleta(acesso.usuario))return conversaCompleta({usuario:acesso.usuario,corpo});
  const pergunta=texto(corpo.pergunta,4000).trim();if(!pergunta)return Response.json({erro:"Pergunta vazia."},{status:400});
  const {ferramentas,gravou}=ferramentasDeCampanhas(acesso.usuario.id);
  // Criar tag e segmento é da tela de Configurações: só entra para quem tem o módulo (lib/ia/tags-segmentos.ts).
  const tags=acesso.usuario.modulos.has("configuracoes")?ferramentasDeTagsESegmentos():null;
  const sistema=tags?`${SISTEMA_CAMPANHAS}\n\nTAGS E SEGMENTOS\n${REGRAS_DE_TAGS}`:SISTEMA_CAMPANHAS;
  return conversar({sistema,ferramentas:[...ferramentas,...(tags?.ferramentas??[])],pergunta,historico:historicoDe(corpo.historico),contexto:texto(corpo.contexto,500),eventosFinais:()=>gravou()||tags?.gravou()?[{t:"mudou"}]:[]});
}
