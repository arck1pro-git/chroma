import { NextRequest } from "next/server";
import { exigirModuloApi } from "@/lib/auth/dal";
import { conversar, historicoDe, texto } from "@/lib/ia/conversa";
import { ferramentasDeCampanhas, SISTEMA_CAMPANHAS } from "@/lib/ia/campanhas";

export const dynamic="force-dynamic";
export async function POST(req:NextRequest){
  const acesso=await exigirModuloApi("campanhas");if(acesso instanceof Response)return acesso;
  let corpo:Record<string,unknown>;try{corpo=await req.json()}catch{return Response.json({erro:"Corpo inválido."},{status:400})}
  const pergunta=texto(corpo.pergunta,4000).trim();if(!pergunta)return Response.json({erro:"Pergunta vazia."},{status:400});
  const {ferramentas,gravou}=ferramentasDeCampanhas(acesso.usuario.id);
  return conversar({sistema:SISTEMA_CAMPANHAS,ferramentas,pergunta,historico:historicoDe(corpo.historico),contexto:texto(corpo.contexto,500),eventosFinais:()=>gravou()?[{t:"mudou"}]:[]});
}
