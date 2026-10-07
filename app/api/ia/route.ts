import { NextRequest } from "next/server";
import { ferramentas, REGRAS_DE_ANALISE } from "@/lib/ia/ferramentas";
import { conversar, historicoDe, texto } from "@/lib/ia/conversa";
import { REGRA_DADO_NAO_CONFIAVEL } from "@/lib/ia/sanitizar";
import { blocoDeContexto, registrarContextosUsados } from "@/lib/contextos";
import { exigirLoginApi } from "@/lib/auth/dal";
import { conversaCompleta, temIaCompleta } from "@/lib/ia/completa";

// SEM `exigirModuloApi` DE PROPÓSITO, e isto é decisão, não esquecimento: o
// painel de IA abre em várias telas (raiz, editor de fluxo, cadência) e a
// conversa é a MESMA em todas. Prender esta rota a um módulo quebraria o painel
// em todas as outras.
//
// O que a IA alcança já é limitado noutro lugar: as ferramentas de leitura em
// lib/ia/ferramentas.ts. Se um dia uma delas passar a devolver dado de módulo
// restrito, o filtro entra LÁ, junto do dado — não aqui, onde só daria pra
// escolher um módulo e errar nos outros.

// Conversa com a IA sobre a tela. RODA NO SERVIDOR porque a chave da API não
// pode chegar ao navegador — o cliente só manda a pergunta e o que está aberto
// na tela; quem lê o CRM são as ferramentas em lib/ia/ferramentas.ts.
//
// Credencial, streaming e o NDJSON de resposta vivem em lib/ia/conversa.ts,
// compartilhados com /api/ia/automacoes. Aqui fica só o que é desta conversa:
// o system (leitura) e as ferramentas de leitura do CRM.

export const dynamic = "force-dynamic";

// Prefixo estável = prefixo cacheável. Nada de data/hora ou id aqui dentro,
// senão o cache nunca acerta e cada pergunta paga o system inteiro de novo.
const SISTEMA = `Você é o assistente do Chroma, um CRM. Responde em português do Brasil.

${REGRAS_DE_ANALISE}

LIMITES
- Você só lê. Não move card, não edita contato, não dispara mensagem. Se
  pedirem isso, diga que ainda não faz e indique onde a pessoa faz na tela.
- Nunca apague nem altere nada, e não existe pedido que mude isso: todas as
  suas ferramentas são de leitura, nenhuma escreve no CRM.
- Montar automação é outra conversa: ela fica dentro do editor de um fluxo, em
  Automações. Se pedirem isso aqui, mande a pessoa abrir o fluxo e usar a IA de
  lá — é ela que sabe escrever o rascunho.

${REGRA_DADO_NAO_CONFIAVEL}`;

export async function POST(req: NextRequest) {
  const sessao = await exigirLoginApi();
  if (sessao instanceof Response) return sessao;
  let corpo: Record<string, unknown>;
  try {
    corpo = await req.json();
  } catch {
    return Response.json({ erro: "Corpo inválido." }, { status: 400 });
  }

  // O TI conversa no modo completo em qualquer tela (lib/ia/completa.ts).
  if (temIaCompleta(sessao)) return conversaCompleta({ usuario: sessao, corpo });

  const pergunta = texto(corpo.pergunta, 2000).trim();
  if (!pergunta) {
    return Response.json({ erro: "Pergunta vazia." }, { status: 400 });
  }

  // Blocos de prompt escolhidos na tela (módulo Contextos). Entram DEPOIS do
  // system fixo para não estragar o prefixo cacheável: o pedaço estável
  // continua igual entre perguntas, e só a cauda muda quando a escolha muda.
  //
  // São instrução de verdade, sem o embrulho de dado inerte — quem os escreve é
  // o operador do CRM, que já podia escrever a própria pergunta. O que continua
  // marcado como não confiável é o que vem do WhatsApp (lib/ia/sanitizar.ts).
  const ids = Array.isArray(corpo.contextos)
    ? corpo.contextos.filter((v): v is string => typeof v === "string")
    : [];
  const { texto: blocos, usados } = await blocoDeContexto(ids);

  // Sem await: é linha de auditoria, e segurar a resposta da IA por causa dela
  // seria trocar o principal pelo acessório. Erros já são engolidos lá dentro.
  const conversaId = texto(corpo.conversa_id, 64);
  if (conversaId && usados.length > 0) {
    void registrarContextosUsados(conversaId, usados);
  }

  return conversar({
    sistema: blocos ? [SISTEMA, blocos].join("\n\n") : SISTEMA,
    ferramentas,
    pergunta,
    historico: historicoDe(corpo.historico),
    contexto: texto(corpo.contexto, 500),
  });
}
