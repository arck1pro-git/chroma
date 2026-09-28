// "Mudou alguma coisa no chat?" — a pergunta que a tela faz a cada poucos
// segundos enquanto está aberta e visível.
//
// POR QUE EXISTE: o chat era avisado pelo Realtime do Supabase, e o projeto
// Supabase de dados foi apagado — desde então mensagem nova só aparecia dando
// F5. Isto é o substituto mais barato que funciona na Vercel: a tela pergunta,
// a resposta é uma string curta, e só quando ela MUDA a tela recarrega os
// dados de verdade (router.refresh). Uma consulta pequena por pergunta.
//
// O que entra na assinatura:
//   · atendimentos: data_atualizacao mais recente (toca a cada mensagem nova,
//     nos dois webhooks e nos envios), e as contagens por status (assumir,
//     encerrar e reabrir não tocam data_atualizacao);
//   · a conversa aberta: status e mídia das últimas mensagens — é assim que o
//     "entregue/lido" e o anexo que terminou de baixar aparecem sem F5.
import { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { exigirModuloApi } from "@/lib/auth/dal";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sessao = await exigirModuloApi("chat");
  if (sessao instanceof Response) return sessao;

  const [geral] = await sql`
    SELECT coalesce(to_char(max(coalesce(data_atualizacao, data_criacao)), 'YYYYMMDDHH24MISSUS'), '')
             || ':' || count(*)
             || ':' || count(*) FILTER (WHERE status = 'na_fila')
             || ':' || count(*) FILTER (WHERE status = 'encerrado')
             || ':' || coalesce(to_char(max(lido_em), 'YYYYMMDDHH24MISSUS'), '') AS v
    FROM atendimentos`;

  let conversa = "";
  const id = req.nextUrl.searchParams.get("atendimento") ?? "";
  if (/^[0-9a-f-]{36}$/i.test(id)) {
    const [c] = await sql`
      SELECT coalesce(md5(string_agg(status || midia_estado, ',')), '') AS v
      FROM (
        SELECT status, midia_estado FROM mensagens
        WHERE atendimento_id = ${id}
        ORDER BY data_criacao DESC
        LIMIT 40
      ) ultimas`;
    conversa = (c?.v as string) ?? "";
  }

  return Response.json(
    { v: `${geral?.v ?? ""}|${conversa}` },
    { headers: { "Cache-Control": "no-store" } },
  );
}
