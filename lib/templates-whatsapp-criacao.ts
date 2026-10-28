// A ENTRADA da criação de template (POST /api/meta/templates), no formato do
// editor (app/templates/editor.tsx). O zod só garante tipos e tamanhos que não
// deixam o corpo crescer à toa; as regras da Meta são as de problemasDo
// (lib/templates-whatsapp.ts), as mesmas que o editor mostra enquanto se digita.
//
// Fora de lib/templates-whatsapp.ts de propósito: aquele é importado pelas
// telas, e o zod iria junto para o navegador. Fora da rota para ser testado
// (scripts/testar-templates-whatsapp.ts).
//
// O `exemplo` do botão de link com variável (2026-10-28): o zod descartava o
// campo, componentesDoRascunho mandava o link de exemplo vazio e a Meta recusava
// todo template com link variável.
//
// O cabeçalho de mídia (2026-10-28) chega como formato e o id do documento da
// biblioteca usado de exemplo; a rota lê o arquivo e sobe para a Meta.
import { z } from "zod";
import { FORMATOS_DO_CABECALHO, LIMITE } from "@/lib/templates-whatsapp";

const texto = (max: number) => z.string().max(max).default("");

export const entradaDaCriacao = z.object({
  waba: z.string().regex(/^\d+$/),
  nome: texto(600),
  categoria: z.enum(["MARKETING", "UTILITY"]),
  cabecalho: texto(200),
  formatoCabecalho: z.enum(FORMATOS_DO_CABECALHO).default("TEXT"),
  midiaCabecalho: texto(64),
  corpo: texto(2000),
  rodape: texto(200),
  exemplosCabecalho: z.array(texto(LIMITE.exemplo)).max(1).default([]),
  exemplosCorpo: z.array(texto(LIMITE.exemplo)).max(100).default([]),
  botoes: z
    .array(
      z.object({
        tipo: z.enum(["QUICK_REPLY", "URL", "PHONE_NUMBER"]),
        texto: texto(100),
        destino: texto(LIMITE.url),
        exemplo: z.string().max(LIMITE.exemplo).optional(),
      }),
    )
    .max(20)
    .default([]),
});
