// A automação dos artigos (o workflow do n8n que lê os feeds e gera os
// artigos): a agenda combinada e o formato do estado que a tela recebe. SEM
// banco e SEM rede — a aba Automação é componente de cliente e importa daqui.
//
// A AGENDA MORA AQUI, num lugar só: o workflow (lib/blog-rss-workflow.ts), a
// pauta (lib/blog-pauta.ts, quantos por blog) e o texto da tela leem a mesma
// constante. Mudar a agenda é mudar este objeto e religar a automação na tela,
// que reescreve o workflow no n8n.
//
// 2026-11-05: era toda segunda às 8h, 10 por blog. Passou a ser de segunda a
// sexta às 7h, 2 por blog — o mesmo volume na semana, com notícia de no máximo
// um dia (a de segunda pegava só as manchetes do fim de semana) e uma revisão
// de dois artigos por manhã em vez de dez de uma vez.
export const AGENDA_AUTOMACAO = {
  /** Cron do gatilho do n8n, no fuso abaixo. */
  cron: "0 7 * * 1-5",
  fuso: "America/Sao_Paulo",
  hora: 7,
  /** 0 = domingo … 6 = sábado, como Date.getUTCDay. */
  diasDaSemana: [1, 2, 3, 4, 5],
  /** Artigos por blog em cada rodada. */
  porBlog: 2,
  texto: "De segunda a sexta, às 7h",
} as const;

/**
 * Feeds de mercado e economia que a aba Automação oferece em um clique.
 *
 * Só entram os conferidos em 2026-11-05: o feed responde com notícia do dia E
 * a matéria abre no leitor da geração (lib/artigo-materia.ts) sem paywall.
 * Ficaram de fora Valor e Estadão (paywall), o Google Notícias (o link não abre
 * a matéria) e os feeds de seção que vieram vazios (Exame Economia, CNN
 * Economia, Poder360, IstoÉ Dinheiro).
 */
export const FONTES_SUGERIDAS: { nome: string; url: string; tema: "economia" | "imoveis" }[] = [
  { nome: "InfoMoney", url: "https://www.infomoney.com.br/feed/", tema: "economia" },
  { nome: "G1 · Economia", url: "https://g1.globo.com/rss/g1/economia/", tema: "economia" },
  { nome: "Agência Brasil · Economia", url: "https://agenciabrasil.ebc.com.br/rss/economia/feed.xml", tema: "economia" },
  { nome: "Money Times", url: "https://www.moneytimes.com.br/feed/", tema: "economia" },
  { nome: "Seu Dinheiro · Economia", url: "https://www.seudinheiro.com/economia/feed/", tema: "economia" },
  { nome: "Folha · Mercado", url: "http://feeds.folha.uol.com.br/mercado/rss091.xml", tema: "economia" },
  { nome: "Gazeta do Povo · Economia", url: "https://www.gazetadopovo.com.br/feed/rss/economia.xml", tema: "economia" },
  { nome: "Exame", url: "https://exame.com/feed/", tema: "economia" },
  { nome: "InfoMoney · Mercado imobiliário", url: "https://www.infomoney.com.br/tudo-sobre/mercado-imobiliario/feed/", tema: "imoveis" },
  { nome: "Money Times · Imóveis", url: "https://www.moneytimes.com.br/tag/imoveis/feed/", tema: "imoveis" },
];

/** Teto de produto: 5 feeds por blog (a rota recusa o sexto). */
export const MAX_FEEDS = 5;

export interface ExecucaoAutomacao {
  id: string;
  inicio: string;
  fim: string | null;
  situacao: "sucesso" | "erro" | "rodando" | "outro";
}

export type EstadoAutomacao =
  /** N8N_BASE_URL ou N8N_API_KEY não definidas neste servidor. */
  | { estado: "sem-motor" }
  | { estado: "erro"; mensagem: string }
  /** O workflow ainda não existe no n8n. */
  | { estado: "nao-criada"; podeLigarDaqui: boolean }
  | {
      estado: "ligada" | "pausada";
      workflowId: string;
      /** O workflow no n8n é de uma versão anterior da agenda ou do endereço: religar atualiza. */
      desatualizada: boolean;
      /** Próxima rodada (ISO), quando ligada. */
      proxima: string | null;
      execucoes: ExecucaoAutomacao[];
      podeLigarDaqui: boolean;
    };

/**
 * A próxima rodada da agenda depois de `agora`, em ISO. Brasília está em UTC-3
 * o ano todo desde 2019 (sem horário de verão), então a conta é fixa.
 */
export function proximaRodada(agora = new Date()): string {
  const OFFSET_H = 3;
  for (let d = 0; d < 8; d++) {
    const alvo = new Date(agora.getTime());
    // Meia-noite de Brasília do dia d, em UTC, + a hora da rodada.
    const brasilia = new Date(agora.getTime() - OFFSET_H * 3_600_000);
    const dia = new Date(Date.UTC(brasilia.getUTCFullYear(), brasilia.getUTCMonth(), brasilia.getUTCDate() + d));
    alvo.setTime(dia.getTime() + (AGENDA_AUTOMACAO.hora + OFFSET_H) * 3_600_000);
    if (alvo.getTime() <= agora.getTime()) continue;
    if (!(AGENDA_AUTOMACAO.diasDaSemana as readonly number[]).includes(dia.getUTCDay())) continue;
    return alvo.toISOString();
  }
  return new Date(agora.getTime() + 86_400_000).toISOString();
}
