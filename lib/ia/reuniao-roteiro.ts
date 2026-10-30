// O ROTEIRO DAS REUNIÕES com o investidor, que o copiloto da extensão segue
// (lib/ia/reuniao.ts). Pedido dele em 2026-10-30: "aqui vai encontrar a
// orientação de como devem ser as reuniões para orientar na extensão". É o
// roteiro "Sparks × AMAAN · SCP" (sparks-amaan-scp-v1) do Compasso,
// https://compasso-reunioes-fabricio.flowy-tern-0567.chatgpt.site. Mudou lá,
// muda aqui: este arquivo é a cópia que vale para o CRM.
//
// DECISÕES:
//   · As 8 etapas vão na ordem. Em cada uma, o que precisa ficar claro e a
//     pergunta sugerida. Os pesos do Compasso (nota da reunião) ficaram de fora:
//     o copiloto sugere o próximo movimento, não dá nota. O "revisar os campos
//     de fechamento no CRM" da última etapa fica com o resumo do fim.
//   · "A empresa" no lugar de "AMAAN" ("Operação e tese", sem o nome): a
//     extensão serve também às reuniões da Arck1Pro, e quem diz qual é a empresa
//     é o funil do lead e o conhecimento do produto. Os demais títulos são os do
//     Compasso, como o vendedor os conhece.
//   · Os desfechos e os motivos de não avanço são os campos de fechamento do
//     Compasso. O resumo da reunião (que vira anotação na ficha) usa os mesmos.

type Etapa = {
  titulo: string;
  objetivo: string;
  /** O que precisa ficar claro na etapa, com a pergunta (ou a ação) sugerida ao vendedor. */
  criterios: Array<{ ponto: string; sugestao: string }>;
};

export const ETAPAS_REUNIAO: Etapa[] = [
  {
    titulo: "Conexão e contexto",
    objetivo: "Apresentação breve da empresa e escuta do motivo da conversa. Autoridade com humildade e conexão.",
    criterios: [
      { ponto: "Motivo do interesse, nas palavras do investidor", sugestao: "O que fez você querer conhecer essa operação agora?" },
      { ponto: "Papel da empresa e do closer apresentados", sugestao: "Apresente brevemente a empresa e o seu papel nesta análise." },
    ],
  },
  {
    titulo: "Acordo de condução",
    objetivo: "Combinar objetivo, tempo e uma definição ao final: avançar, não avançar ou uma análise com próximo passo.",
    criterios: [
      { ponto: "Objetivo e tempo disponíveis alinhados", sugestao: "Quanto tempo temos e o que precisa ficar claro nesta conversa?" },
      {
        ponto: "Combinados os desfechos possíveis da conversa",
        sugestao: "Podemos terminar com uma definição clara, inclusive se for analisar um ponto ou não avançar?",
      },
    ],
  },
  {
    titulo: "Diagnóstico do investidor",
    objetivo: "Entender experiência, alocação atual, motivação e critério de escolha. Explorar consequências reais, sem inventar custo de não agir.",
    criterios: [
      { ponto: "Experiência com SCP ou incorporação", sugestao: "Você já participou de uma SCP ou de uma incorporação?" },
      { ponto: "Alocação atual e objetivo", sugestao: "Onde você costuma alocar esse capital e o que busca mudar?" },
      {
        ponto: "Critério principal de decisão",
        sugestao: "O que mais pesa na sua escolha: prazo, operação, executor, riscos ou outro critério?",
      },
    ],
  },
  {
    titulo: "Capital, liquidez e decisores",
    objetivo: "Verificar a compatibilidade inicial e quem participa da decisão. Não inferir capacidade ou perfil por uma palavra só.",
    criterios: [
      { ponto: "Faixa de capital disponível", sugestao: "Que faixa de capital você destinou a esta análise?" },
      {
        ponto: "Horizonte e necessidade de liquidez",
        sugestao: "Por quanto tempo esse capital pode ficar alocado, e quando você pode precisar dele?",
      },
      {
        ponto: "Decisores e análise externa",
        sugestao: "Além de você, quem participa da decisão ou precisa analisar os documentos?",
      },
    ],
  },
  {
    titulo: "Operação e tese",
    objetivo:
      "Apresentação ligada ao objetivo do investidor: a operação de incorporação, o mecanismo econômico, o executor e materiais concretos. Separar participação da compra de unidade.",
    criterios: [
      { ponto: "Mecanismo da operação explicado e ligado ao objetivo dele", sugestao: "Mostre como a operação funciona e de onde pode vir o resultado." },
      {
        ponto: "Participação em SCP separada da compra de unidade",
        sugestao: "Confirme o que está sendo analisado: participação na operação, não compra de apartamento.",
      },
      {
        ponto: "Entendimento ou dúvida do investidor confirmados",
        sugestao: "Como você explicaria essa operação com as suas palavras? O que ainda precisa ficar claro?",
      },
    ],
  },
  {
    titulo: "Riscos, premissas e documentos",
    objetivo:
      "Separar fato, premissa, projeção e risco residual. Confirmar a fonte e a versão dos documentos. Nenhum retorno ou condição vira promessa.",
    criterios: [
      { ponto: "Riscos, prazo e liquidez discutidos com limites claros", sugestao: "Quais riscos e limitações desta operação precisam de esclarecimento?" },
      {
        ponto: "Projeção tratada com premissas e sem garantia de resultado",
        sugestao: "Mostre as premissas do cenário aprovado e o que pode fazer o resultado divergir.",
      },
      { ponto: "Documentos da operação apresentados ou pedidos por ele", sugestao: "Que documento ou validação falta para você analisar esta operação?" },
    ],
  },
  {
    titulo: "Aporte, dúvidas e SND",
    objetivo:
      "Apresentar com naturalidade as condições aprovadas. Ouvir a objeção concreta, responder ou registrar a pendência, com firmeza gentil e espaço real para não avançar.",
    criterios: [
      { ponto: "Aporte e condições apresentados com fonte aprovada", sugestao: "Apresente só o aporte e as condições que estão nos materiais aprovados." },
      { ponto: "Objeção principal, ou a falta de dúvida, registrada", sugestao: "Qual ponto ainda impede você de avançar com clareza?" },
      {
        ponto: "Resposta compreendida, ou pendência assumida",
        sugestao: "Isso esclarece sua dúvida? Se não, o que falta, e quem vai responder?",
      },
    ],
  },
  {
    titulo: "Definição e próximo contato",
    objetivo:
      "Registrar o resultado real, a ação, o responsável e a data. \"Quero avançar\" abre a formalização; analisar com advogado ou outro decisor é um desfecho válido.",
    criterios: [
      {
        ponto: "Resultado da reunião explícito",
        sugestao: "Você quer avançar, precisa analisar algum ponto ou não faz sentido neste momento?",
      },
      { ponto: "Próxima ação, responsável e prazo confirmados", sugestao: "Qual é a próxima ação, quem assume e até quando?" },
    ],
  },
];

/** Os títulos das etapas, na ordem: o que o copiloto pode devolver como etapa. */
export const TITULOS_ETAPAS = ETAPAS_REUNIAO.map((e) => e.titulo);

/** Os desfechos da reunião (campos de fechamento do Compasso). */
export const DESFECHOS_REUNIAO = ["Quero avançar", "Tenho dúvida", "Vou analisar", "Outro decisor", "Advogado/contador", "Não faz sentido", "Timing"];

/** Por que não avançou, quando o desfecho é "Não faz sentido" ou "Timing". */
export const MOTIVOS_NAO_AVANCO = [
  "Sem capital disponível",
  "Liquidez/prazo incompatível",
  "Risco não compatível",
  "Não confiou na operação/executor",
  "Escolheu outra alocação",
  "Timing",
  "Outro",
];

const PRINCIPIOS = [
  "Conexão, liderança com firmeza gentil e desapego de uma venda sem compatibilidade.",
  "Uma decisão clara pode ser avançar, não agora ou analisar uma pendência real.",
  "\"Quero avançar\" inicia a formalização; a participação só vem depois do marco jurídico e operacional aprovado.",
  "Capital, prazo e liquidez precisam ser compatíveis. Não confundir SCP com compra de apartamento.",
  "Projeções, riscos e condições específicas dependem dos documentos aprovados da operação.",
  "O que a ficha do lead já traz (o que o SDR levantou no WhatsApp e no formulário) se confirma, não se pergunta do zero.",
];

/** O roteiro como texto do prompt: princípios e etapas, na ordem. */
export function roteiroParaModelo(): string {
  return [
    "ROTEIRO DA REUNIÃO (o método da empresa, do operador; confiável)",
    "Princípios:",
    ...PRINCIPIOS.map((p) => `- ${p}`),
    "",
    "Etapas, na ordem:",
    ...ETAPAS_REUNIAO.flatMap((e, i) => [
      `${i + 1}. ${e.titulo}: ${e.objetivo}`,
      ...e.criterios.map((c) => `   - ${c.ponto}. Sugestão: "${c.sugestao}"`),
    ]),
  ].join("\n");
}
