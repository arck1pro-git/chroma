// Tipos do módulo Webhooks e o gerador do prompt de implementação.
//
// Sem import de banco de propósito: este arquivo é importado pelo CLIENTE (o
// botão de copiar prompt recalcula o texto a cada campo que você mexe, sem ida
// ao servidor). Leitura e escrita ficam em app/webhooks/dados.ts e acoes.ts.
//
// O schema está em migration-webhooks.sql, com as decisões de modelagem.

/**
 * O nome com que toda webhook nasce.
 *
 * Mora aqui porque dois lados dependem dele: a lista o usa ao criar, e o
 * onboarding o trata como "ainda sem nome" — o passo 1 só fica concluído
 * quando alguém troca esse rótulo por algo que diga de onde vem o lead.
 */
export const NOME_PADRAO = "Nova captação";

export type TipoCampo = "texto" | "numero" | "data" | "booleano";

export type DestinoCampo =
  | "contato.nome"
  | "contato.whatsapp"
  | "contato.email"
  | "contato.cidade"
  | "contato.estado"
  | "contato.pais"
  | "oportunidade.nome"
  | "oportunidade.valor"
  | "contato.campo"
  | "oportunidade.campo"
  | "ignorar";

export type TipoAcao =
  | "criar_lead"
  | "inscrever_fluxo"
  | "adicionar_segmento"
  | "adicionar_tag";

export type WebhookCampo = {
  id: string;
  chave: string;
  rotulo: string;
  tipo: TipoCampo;
  obrigatorio: boolean;
  destino: DestinoCampo;
  destino_chave: string | null;
  ordem: number;
};

export type WebhookAcao = {
  id: string;
  tipo: TipoAcao;
  ordem: number;
  fluxo_id: string | null;
  segmento_id: string | null;
  tag_id: string | null;
  criar_oportunidade: boolean;
  funil_id: string | null;
  etapa_id: string | null;
  // Resolvido no JOIN, só para a tela — a ação em si guarda o id.
  alvo_nome: string | null;
  funil_nome: string | null;
  etapa_nome: string | null;
};

export type Webhook = {
  id: string;
  nome: string;
  descricao: string | null;
  slug: string;
  segredo: string;
  ativo: boolean;
  data_criacao: string;
  // Agregados da listagem.
  total_campos: number;
  total_acoes: number;
  recebidos_7d: number;
  erros_7d: number;
};

export type Recebimento = {
  id: string;
  estado: "ok" | "recusado" | "erro";
  erro: string | null;
  resumo: string | null;
  payload: Record<string, unknown>;
  contato_id: string | null;
  // Resolvido no JOIN, só para a tela: a lista responde "quem passou por aqui",
  // e uuid não é nome de gente. Nulo quando o lead foi recusado (nem chegou a
  // virar contato) ou quando o contato foi apagado depois.
  contato_nome: string | null;
  data_criacao: string;
};

// ── Rótulos ─────────────────────────────────────────────────────────────────
// Um lugar só para o texto de cada destino: ele aparece no seletor da tela, no
// resumo da linha e dentro do prompt. Três cópias divergiriam.
export const DESTINOS: { valor: DestinoCampo; rotulo: string; grupo: string }[] = [
  { valor: "contato.nome", rotulo: "Nome", grupo: "Contato" },
  { valor: "contato.whatsapp", rotulo: "WhatsApp", grupo: "Contato" },
  { valor: "contato.email", rotulo: "E-mail", grupo: "Contato" },
  { valor: "contato.cidade", rotulo: "Cidade", grupo: "Contato" },
  { valor: "contato.estado", rotulo: "Estado", grupo: "Contato" },
  { valor: "contato.pais", rotulo: "País", grupo: "Contato" },
  { valor: "contato.campo", rotulo: "Campo personalizado", grupo: "Contato" },
  { valor: "oportunidade.nome", rotulo: "Título do card", grupo: "Oportunidade" },
  { valor: "oportunidade.valor", rotulo: "Valor", grupo: "Oportunidade" },
  { valor: "oportunidade.campo", rotulo: "Campo personalizado", grupo: "Oportunidade" },
  { valor: "ignorar", rotulo: "Não usar", grupo: "Outros" },
];

/**
 * Um campo personalizado do CRM (campos_personalizados), como o seletor de
 * destino precisa vê-lo: onde ele mora e como se chama.
 */
export type CampoDoCrm = {
  entidade: "contato" | "oportunidade";
  chave: string;
  rotulo: string;
};

/**
 * Uma linha do seletor "Vira o quê no CRM".
 *
 * O `valor` é o que vai no <option>, e ele CARREGA A CHAVE quando o destino é
 * campo personalizado: "contato.campo:utm_source". Antes o seletor tinha uma
 * opção genérica "Campo personalizado" e um input ao lado onde a pessoa
 * DIGITAVA a chave — e digitar chave de campo personalizado é errar chave de
 * campo personalizado: um "utm-source" com hífen grava um valor que nenhuma
 * tela do CRM lê, e nada avisa.
 *
 * Com cada campo virando uma opção, o par (destino, chave) sempre sai de algo
 * que existe no banco.
 */
export type OpcaoDestino = {
  valor: string;
  rotulo: string;
  grupo: string;
  destino: DestinoCampo;
  destinoChave: string | null;
};

const GRUPOS_DESTINO = ["Contato", "Oportunidade", "Outros"] as const;

/** O par (destino, chave) colapsado no valor de um <option>. */
export function valorDeDestino(destino: DestinoCampo, chave: string | null) {
  return destino.endsWith(".campo") && chave ? `${destino}:${chave}` : destino;
}

/** O caminho de volta: do valor do <option> para o par que o banco guarda. */
export function lerValorDeDestino(valor: string): {
  destino: DestinoCampo;
  destinoChave: string;
} {
  const corte = valor.indexOf(":");
  if (corte < 0) return { destino: valor as DestinoCampo, destinoChave: "" };
  return {
    destino: valor.slice(0, corte) as DestinoCampo,
    destinoChave: valor.slice(corte + 1),
  };
}

/**
 * Todas as linhas do seletor: os campos fixos do contato e da oportunidade,
 * mais UMA LINHA POR CAMPO PERSONALIZADO cadastrado, mais "Não usar".
 *
 * `emUso` são os pares que os campos já declarados desta webhook apontam. Um
 * deles pode apontar para um campo personalizado que foi apagado depois em
 * Configurações — e essa linha tem que continuar aparecendo, marcada, senão o
 * seletor mostraria outro destino e a primeira edição gravaria um destino que
 * ninguém escolheu.
 */
export function opcoesDeDestino(
  camposCrm: CampoDoCrm[],
  emUso: { destino: DestinoCampo; destino_chave: string | null }[] = [],
): OpcaoDestino[] {
  const opcoes: OpcaoDestino[] = [];

  for (const grupo of GRUPOS_DESTINO) {
    // Os fixos, menos as duas entradas genéricas de campo personalizado: quem
    // as substitui é a lista logo abaixo, campo a campo.
    for (const d of DESTINOS) {
      if (d.grupo !== grupo || d.valor.endsWith(".campo")) continue;
      opcoes.push({
        valor: d.valor,
        rotulo: d.rotulo,
        grupo,
        destino: d.valor,
        destinoChave: null,
      });
    }

    const entidade = grupo === "Contato" ? "contato" : "oportunidade";
    const destino: DestinoCampo =
      entidade === "contato" ? "contato.campo" : "oportunidade.campo";

    for (const c of camposCrm) {
      if (c.entidade !== entidade) continue;
      opcoes.push({
        valor: valorDeDestino(destino, c.chave),
        rotulo: `${c.rotulo} (personalizado)`,
        grupo,
        destino,
        destinoChave: c.chave,
      });
    }
  }

  // Campo personalizado que sumiu do cadastro mas ainda é destino de alguém.
  for (const campo of emUso) {
    if (!campo.destino.endsWith(".campo") || !campo.destino_chave) continue;
    const valor = valorDeDestino(campo.destino, campo.destino_chave);
    if (opcoes.some((o) => o.valor === valor)) continue;
    opcoes.push({
      valor,
      rotulo: `"${campo.destino_chave}" (não cadastrado)`,
      grupo: campo.destino.startsWith("contato") ? "Contato" : "Oportunidade",
      destino: campo.destino,
      destinoChave: campo.destino_chave,
    });
  }

  return opcoes;
}

export function rotuloDoDestino(campo: WebhookCampo): string {
  const base = DESTINOS.find((d) => d.valor === campo.destino);
  if (!base) return campo.destino;
  if (campo.destino.endsWith(".campo")) {
    return `${base.grupo} · campo "${campo.destino_chave}"`;
  }
  return `${base.grupo} · ${base.rotulo}`;
}

/** A URL completa da webhook, com segredo. É o que se cola do outro lado. */
export function urlDaWebhook(baseUrl: string, slug: string, segredo: string) {
  return `${baseUrl.replace(/\/+$/, "")}/api/webhooks/${slug}?secret=${segredo}`;
}

// ── Exemplo de valor por tipo ───────────────────────────────────────────────
// O prompt precisa de um payload de exemplo que pareça real: "string" em todo
// campo faz quem implementa mandar literalmente "string".
function exemploDoCampo(campo: WebhookCampo): string {
  if (campo.tipo === "numero") return "1500";
  if (campo.tipo === "booleano") return "true";
  if (campo.tipo === "data") return '"2026-09-11"';

  switch (campo.destino) {
    case "contato.nome":
      return '"Maria Oliveira"';
    case "contato.whatsapp":
      return '"5547999346074"';
    case "contato.email":
      return '"maria@exemplo.com.br"';
    case "contato.cidade":
      return '"Joinville"';
    case "contato.estado":
      return '"SC"';
    case "contato.pais":
      return '"Brasil"';
    default:
      return `"exemplo de ${campo.rotulo.toLowerCase()}"`;
  }
}

/**
 * O prompt copiável.
 *
 * É um PROMPT, não documentação: o destinatário é uma IA trabalhando no código
 * de quem vai enviar o lead (site, landing page, n8n). Por isso ele começa
 * dizendo o que fazer, traz o contrato exato e termina com as restrições — que
 * são a parte que uma IA sem contexto erraria sozinha:
 *
 *  · chamar do SERVIDOR, não do navegador. O segredo vai na URL (decisão
 *    registrada em migration-webhooks.sql); num fetch de página pública ele
 *    fica visível para qualquer visitante.
 *  · os nomes das chaves são exatos. Campo não declarado é descartado em
 *    silêncio, e "e-mail" não é "email" — é o erro nº 1 dessa integração.
 *  · o que cada resposta significa, para o outro lado saber quando repetir.
 */
export function promptDeImplementacao(
  webhook: Pick<Webhook, "nome" | "slug" | "segredo" | "descricao">,
  campos: WebhookCampo[],
  baseUrl: string,
): string {
  const url = urlDaWebhook(baseUrl, webhook.slug, webhook.segredo);
  const usados = campos.filter((c) => c.destino !== "ignorar");
  const obrigatorios = usados.filter((c) => c.obrigatorio);

  const linhasCampos = usados.length
    ? usados
        .map(
          (c) =>
            `- \`${c.chave}\` (${c.tipo}${c.obrigatorio ? ", obrigatório" : ", opcional"}) — ${c.rotulo}. No CRM vira: ${rotuloDoDestino(c)}.`,
        )
        .join("\n")
    : "- (nenhum campo declarado ainda — declare os campos no CRM antes de implementar)";

  const exemploJson = usados.length
    ? `{\n${usados.map((c) => `  "${c.chave}": ${exemploDoCampo(c)}`).join(",\n")}\n}`
    : "{}";

  const curl = `curl -X POST '${url}' \\\n  -H 'Content-Type: application/json' \\\n  -d '${exemploJson.replace(/\n\s*/g, " ")}'`;

  return `Implemente o envio de leads para o CRM Chroma pela webhook "${webhook.nome}".
${webhook.descricao ? `\nContexto desta captação: ${webhook.descricao}\n` : ""}
## Endpoint

POST ${url}
Content-Type: application/json

O segredo já está na URL acima. Não acrescente header de autenticação.

## Corpo da requisição

Envie um JSON com estas chaves, escritas exatamente assim:

${linhasCampos}

Exemplo de corpo válido:

\`\`\`json
${exemploJson}
\`\`\`

Exemplo de chamada:

\`\`\`bash
${curl}
\`\`\`

## Respostas

- \`200\` — lead recebido. O corpo traz \`{ "ok": true, "contato_id": "..." }\`. Não reenvie.
- \`422\` — faltou campo obrigatório ou o JSON é inválido. O corpo traz \`{ "erro": "..." }\` explicando. Reenviar igual vai falhar de novo: corrija o payload.
- \`401\` — segredo errado na URL.
- \`404\` — webhook desativada ou inexistente.
- \`5xx\` — falha temporária do CRM. Pode repetir com espera progressiva.

## Restrições importantes

1. Chame do SERVIDOR (backend, função serverless, n8n, Zapier), nunca de JavaScript rodando no navegador do visitante. O segredo está na URL e ficaria exposto a qualquer pessoa que abrisse a página.
2. Use os nomes de chave exatamente como listados acima. Chave que não está na lista é descartada em silêncio pelo CRM — acento, hífen e maiúscula importam (\`email\` não é \`e-mail\`).
3. ${obrigatorios.length ? `Estes campos não podem ir vazios: ${obrigatorios.map((c) => `\`${c.chave}\``).join(", ")}. Valide antes de enviar.` : "Nenhum campo é obrigatório, mas envie ao menos nome e uma forma de contato (whatsapp ou e-mail) — sem isso o lead entra sem como ser respondido."}
4. Envie o WhatsApp só com dígitos, com DDI e DDD: \`5547999346074\`.
5. Se o envio falhar, não descarte o lead em silêncio — registre o erro para reenvio manual.`;
}
