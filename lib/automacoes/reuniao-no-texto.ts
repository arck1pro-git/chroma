// As variáveis da REUNIÃO nas mensagens de cadência (2026-10-20, a nutrição
// pós-agendamento e o anti no-show da AMAAN: "sua reunião é amanhã, às 15:00 —
// seu acesso é: <link>").
//
// Não são do motor: o n8n troca {{primeiro_nome}} pelo que leu do lead, mas
// data, hora e link do Meet moram no CRM e no Google. O compilador as manda
// como [[reuniao_x]] (textoParaExpressao, no adaptador) e o CRM as troca aqui,
// no envio — com a reunião lida NAQUELA hora, então a remarcada sai certa.

/** O que a tela oferece para inserir, na ordem de uso. */
export const VARIAVEIS_DA_REUNIAO = [
  { chave: "reuniao_quando", rotulo: "Dia da reunião", exemplo: "amanhã, 21/10" },
  { chave: "reuniao_hora", rotulo: "Hora da reunião", exemplo: "15:00" },
  { chave: "reuniao_link", rotulo: "Link do Meet", exemplo: "https://meet.google.com/abc-defg-hij" },
  { chave: "reuniao_dia", rotulo: "Dia (curto)", exemplo: "amanhã" },
  { chave: "reuniao_data", rotulo: "Data", exemplo: "21/10" },
] as const;

const FUSO = "America/Sao_Paulo";
const fmtDiaIso = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO });
const fmtData = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit" });
const fmtHora = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" });
const fmtSemana = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, weekday: "long" });

/**
 * Os valores, a partir da reunião e do instante do envio. "hoje" e "amanhã"
 * contam pelo dia de Brasília, não por 24 horas: a reunião das 9h de amanhã é
 * "amanhã" também às 23h de hoje.
 */
export function variaveisDaReuniao(
  r: { inicio: string; meet: string | null; link: string | null },
  agora: Date,
): Record<string, string> {
  const inicio = new Date(r.inicio);
  const data = fmtData.format(inicio);
  const dias = Math.round((Date.parse(fmtDiaIso.format(inicio)) - Date.parse(fmtDiaIso.format(agora))) / 86_400_000);
  const semana = fmtSemana.format(inicio);
  const dia = dias <= 0 ? "hoje" : dias === 1 ? "amanhã" : semana;
  return {
    reuniao_quando: `${dia}, ${data}`,
    reuniao_dia: dia,
    reuniao_data: data,
    reuniao_hora: fmtHora.format(inicio),
    // O Meet; sem ele, o link do evento no Calendar ainda leva à reunião.
    reuniao_link: r.meet ?? r.link ?? "",
  };
}

export const temVariavelDeReuniao = (texto: string) => /\[\[reuniao_[a-z_]+\]\]/.test(texto);

export function preencherReuniao(texto: string, valores: Record<string, string>): string {
  return texto.replace(/\[\[(reuniao_[a-z_]+)\]\]/g, (_, chave: string) => valores[chave] ?? "");
}
