// O que aconteceu com o lead — a trilha que a ficha da oportunidade e a gaveta
// de contatos mostram em ordem.
//
// POR QUE `historico` E NÃO `anotacoes`: as duas aparecem na mesma ficha e é
// fácil confundir. Anotação é opinião de gente, editável e apagável ("cliente
// pediu pra ligar depois das 18h"). Histórico é FATO, não se edita nem se
// apaga — é a definição que está no schema.sql. Mudança de etapa e entrada em
// automação são fato: quem as escreve é o sistema, no momento em que acontecem.
//
// TODA FUNÇÃO AQUI GRAVA EM UMA CONSULTA SÓ, resolvendo os nomes por JOIN
// dentro do próprio INSERT. Não é economia de round-trip: é que os nomes
// (etapa, fluxo) têm que ser os que valiam NO INSTANTE do evento, e um SELECT
// antes seguido de um INSERT depois é uma janela onde a etapa pode ser
// renomeada entre um e outro.
//
// ELAS NUNCA DERRUBAM A AÇÃO QUE AS CHAMOU. Registrar é efeito colateral: se o
// INSERT falhar, o lead já mudou de etapa e desfazer a mudança por causa da
// anotação seria trocar um problema pequeno por um grande. O erro vai para o
// log do servidor e a ação segue — ver `aSalvo` no fim do arquivo.
//
// AUTOR: as linhas nascem sem `autor_id`. Este CRM ainda não tem sessão — o
// "usuário atual" do chat é `usuarios[0]` —, e carimbar um usuário escolhido
// por acaso seria inventar responsável. A ficha já mostra "Sistema" quando o
// autor é nulo. Quando houver login, é só passar o id para cá.
import { listaUuid, sql } from "@/lib/db";

/** Roda o registro sem deixar o erro subir para quem chamou. */
async function aSalvo(o_que: string, gravar: () => Promise<unknown>) {
  try {
    await gravar();
  } catch (e) {
    console.error(`[historico] falhou ao registrar ${o_que}:`, e);
  }
}

// ── Etapa ───────────────────────────────────────────────────────────────────

/**
 * "Oportunidade X criada em Qualificação" — o nascimento do lead no funil.
 *
 * Chamada DEPOIS do INSERT da oportunidade, com o id que ele devolveu: é dele
 * que saem o contato, o nome e a etapa, sem que quem chama precise repassá-los.
 */
export async function registrarOportunidadeCriada(oportunidadeId: string) {
  await aSalvo("criação da oportunidade", () =>
    sql`
      INSERT INTO historico (contato_id, oportunidade_id, descricao)
      SELECT o.contato_id, o.id,
             'Oportunidade "' || o.nome || '" criada em ' ||
               coalesce(e.nome, 'etapa desconhecida')
      FROM oportunidades o
      LEFT JOIN etapas e ON e.id = o.etapa_id
      WHERE o.id = ${oportunidadeId}`,
  );
}

/**
 * "Movida de Proposta para Negociação".
 *
 * A MUDANÇA E O REGISTRO NA MESMA CONSULTA, e é o ponto desta função: o nome da
 * etapa de origem só existe ANTES do UPDATE. Lido em outra consulta, ele já
 * seria o novo — ou o de uma terceira etapa, se dois arrastes se cruzarem.
 *
 * O CTE `antes` enxerga a linha como ela estava no início da instrução (é a
 * mesma foto para toda a consulta), e `movida` grava. CTE que escreve roda
 * mesmo sem ninguém ler o resultado dela — é o que deixa o INSERT lá embaixo
 * ser o corpo principal.
 *
 * Arraste que solta o card na mesma etapa não vira linha: o `IS DISTINCT FROM`
 * embaixo descarta, senão o histórico encheria de "movida de Proposta para
 * Proposta" a cada reordenação.
 */
export async function moverEtapaRegistrando(
  oportunidadeId: string,
  etapaId: string,
  funilId: string,
) {
  await sql`
    WITH antes AS (
      SELECT id, contato_id, etapa_id FROM oportunidades WHERE id = ${oportunidadeId}
    ),
    movida AS (
      UPDATE oportunidades
      SET etapa_id = ${etapaId}, funil_id = ${funilId}
      WHERE id = ${oportunidadeId}
      RETURNING id
    )
    INSERT INTO historico (contato_id, oportunidade_id, descricao)
    SELECT a.contato_id, a.id,
           'Movida de ' || coalesce(de.nome, 'etapa desconhecida') ||
           ' para ' || coalesce(para.nome, 'etapa desconhecida')
    FROM antes a
    LEFT JOIN etapas de   ON de.id = a.etapa_id
    LEFT JOIN etapas para ON para.id = ${etapaId}
    WHERE a.etapa_id IS DISTINCT FROM ${etapaId}::uuid`;
}

// ── Fluxo ───────────────────────────────────────────────────────────────────

/**
 * De onde veio a inscrição. Entra na frase porque "entrou na automação" sem
 * dizer por quê é a pergunta que sempre vem depois — e a resposta muda o que se
 * faz: cadência de etapa se resolve movendo o card, inscrição manual se
 * resolve tirando da automação.
 */
export type OrigemFluxo = "etapa" | "manual" | "segmento" | "api";

const PORQUE: Record<OrigemFluxo, string> = {
  etapa: " pela cadência da etapa",
  manual: "",
  segmento: " pelo segmento",
  api: " pela captação",
};

/**
 * "Entrou na automação X pela cadência da etapa" — uma linha por entidade.
 *
 * Recebe a LISTA que a inscrição devolveu, e não a lista que alguém pediu para
 * inscrever: quem já estava dentro do fluxo não entra de novo (o ON CONFLICT da
 * inscrição), e registrar a intenção diria que o lead entrou duas vezes.
 */
export async function registrarEntradaEmFluxo(
  fluxoId: string,
  entidadeTipo: "contato" | "oportunidade",
  entidadeIds: string[],
  origem: OrigemFluxo,
) {
  if (entidadeIds.length === 0) return;
  const ids = listaUuid(entidadeIds);
  const porque = PORQUE[origem];

  await aSalvo("entrada em fluxo", () =>
    // Duas consultas e não uma com a tabela variável, pela mesma razão que
    // separa `inscreverContatos` de `inscreverOportunidades`: o FROM não
    // parametriza, e montar o nome da tabela por concatenação é abrir injeção.
    entidadeTipo === "oportunidade"
      ? sql`
          INSERT INTO historico (contato_id, oportunidade_id, descricao)
          SELECT o.contato_id, o.id,
                 'Entrou na automação "' || f.nome || '"' || ${porque}
          FROM oportunidades o
          CROSS JOIN fluxos f
          WHERE f.id = ${fluxoId}
            AND o.id = ANY(string_to_array(${ids}, ',')::uuid[])`
      : sql`
          INSERT INTO historico (contato_id, oportunidade_id, descricao)
          SELECT c.id, NULL,
                 'Entrou na automação "' || f.nome || '"' || ${porque}
          FROM contatos c
          CROSS JOIN fluxos f
          WHERE f.id = ${fluxoId}
            AND c.id = ANY(string_to_array(${ids}, ',')::uuid[])`,
  );
}

/**
 * "Saiu da automação X — Removida da cadência pelo quadro".
 *
 * O motivo é o mesmo texto que vai para `fluxo_execucoes.erro_msg`: os dois
 * lados contam a mesma saída, e inventar uma segunda redação aqui faria a ficha
 * e a tela da automação discordarem sobre o que aconteceu.
 *
 * Só é chamada quando alguma execução foi mesmo cancelada. Pedir para sair de
 * um fluxo em que o lead não estava não é evento nenhum.
 */
export async function registrarSaidaDeFluxo(
  fluxoId: string,
  entidadeTipo: "contato" | "oportunidade",
  entidadeIds: string[],
  motivo: string,
) {
  if (entidadeIds.length === 0) return;
  const ids = listaUuid(entidadeIds);
  const texto = motivo.trim().slice(0, 300);

  await aSalvo("saída de fluxo", () =>
    entidadeTipo === "oportunidade"
      ? sql`
          INSERT INTO historico (contato_id, oportunidade_id, descricao)
          SELECT o.contato_id, o.id,
                 'Saiu da automação "' || f.nome || '" — ' || ${texto}
          FROM oportunidades o
          CROSS JOIN fluxos f
          WHERE f.id = ${fluxoId}
            AND o.id = ANY(string_to_array(${ids}, ',')::uuid[])`
      : sql`
          INSERT INTO historico (contato_id, oportunidade_id, descricao)
          SELECT c.id, NULL,
                 'Saiu da automação "' || f.nome || '" — ' || ${texto}
          FROM contatos c
          CROSS JOIN fluxos f
          WHERE f.id = ${fluxoId}
            AND c.id = ANY(string_to_array(${ids}, ',')::uuid[])`,
  );
}

// ── As outras mudanças da oportunidade ──────────────────────────────────────
//
// O pedido era "toda e qualquer alteração no lead". Estas três são o resto do
// que as ações do funil mexem, e ficam aqui pelo mesmo motivo das de cima: a
// frase é escrita uma vez.

/** "Marcada como ganha" / "Oportunidade reaberta". */
export async function registrarStatus(oportunidadeId: string, status: string) {
  const frase =
    status === "aberta" ? "Oportunidade reaberta" : `Marcada como ${status}`;

  await aSalvo("mudança de status", () =>
    sql`
      INSERT INTO historico (contato_id, oportunidade_id, descricao)
      SELECT o.contato_id, o.id, ${frase}
      FROM oportunidades o WHERE o.id = ${oportunidadeId}`,
  );
}

/** "Responsável alterado para Ana Mendes" — ou "Responsável removido". */
export async function registrarResponsavel(
  oportunidadeIds: string[],
  responsavelId: string | null,
) {
  if (oportunidadeIds.length === 0) return;
  const ids = listaUuid(oportunidadeIds);

  await aSalvo("troca de responsável", () =>
    sql`
      INSERT INTO historico (contato_id, oportunidade_id, descricao)
      SELECT o.contato_id, o.id,
             CASE WHEN u.nome IS NULL THEN 'Responsável removido'
                  ELSE 'Responsável alterado para ' || u.nome END
      FROM oportunidades o
      LEFT JOIN usuarios u ON u.id = ${responsavelId}::uuid
      WHERE o.id = ANY(string_to_array(${ids}, ',')::uuid[])`,
  );
}

/** "Segmento "Clientes VIP" adicionado" — no contato, não na oportunidade. */
export async function registrarSegmento(
  contatoIds: string[],
  segmentoId: string,
) {
  if (contatoIds.length === 0) return;
  const ids = listaUuid(contatoIds);

  await aSalvo("entrada em segmento", () =>
    sql`
      INSERT INTO historico (contato_id, oportunidade_id, descricao)
      SELECT c.id, NULL, 'Segmento "' || s.nome || '" adicionado'
      FROM contatos c
      CROSS JOIN segmentos s
      WHERE s.id = ${segmentoId}
        AND c.id = ANY(string_to_array(${ids}, ',')::uuid[])`,
  );
}

// ── Contato ─────────────────────────────────────────────────────────────────

/** "Contato criado" — com a origem quando ele não nasceu de alguém digitando. */
export async function registrarContatoCriado(
  contatoId: string,
  origem = "",
) {
  const frase = origem ? `Contato criado ${origem}` : "Contato criado";

  await aSalvo("criação do contato", () =>
    sql`
      INSERT INTO historico (contato_id, descricao)
      SELECT c.id, ${frase} FROM contatos c WHERE c.id = ${contatoId}`,
  );
}

/**
 * "Dados alterados: nome, WhatsApp".
 *
 * A EDIÇÃO E O REGISTRO NA MESMA CONSULTA, pelo motivo de `moverEtapaRegistrando`:
 * saber O QUE mudou exige comparar com o valor anterior, que deixa de existir no
 * instante do UPDATE. A lista sai do próprio banco — o `IS DISTINCT FROM` de
 * cada coluna decide se o nome dela entra.
 *
 * Salvar sem mexer em nada não vira linha: sem campo diferente, o array fica
 * vazio e o INSERT não encontra o que gravar.
 */
export async function atualizarContatoRegistrando(
  id: string,
  d: {
    nome: string;
    whatsapp: string;
    email: string;
    cidade: string;
    estado: string;
    pais: string;
  },
) {
  await sql`
    WITH antes AS (
      SELECT id, nome, whatsapp, email, cidade, estado, pais
      FROM contatos WHERE id = ${id}
    ),
    salvo AS (
      UPDATE contatos SET
        nome = ${d.nome}, whatsapp = ${d.whatsapp}, email = ${d.email},
        cidade = ${d.cidade}, estado = ${d.estado}, pais = ${d.pais}
      WHERE id = ${id}
      RETURNING id
    ),
    mudou AS (
      SELECT a.id, array_remove(ARRAY[
        CASE WHEN a.nome     IS DISTINCT FROM ${d.nome}     THEN 'nome' END,
        CASE WHEN a.whatsapp IS DISTINCT FROM ${d.whatsapp} THEN 'WhatsApp' END,
        CASE WHEN a.email    IS DISTINCT FROM ${d.email}    THEN 'e-mail' END,
        CASE WHEN a.cidade   IS DISTINCT FROM ${d.cidade}   THEN 'cidade' END,
        CASE WHEN a.estado   IS DISTINCT FROM ${d.estado}   THEN 'estado' END,
        CASE WHEN a.pais     IS DISTINCT FROM ${d.pais}     THEN 'país' END
      ], NULL) AS campos
      FROM antes a
    )
    INSERT INTO historico (contato_id, descricao)
    SELECT m.id, 'Dados alterados: ' || array_to_string(m.campos, ', ')
    FROM mudou m
    WHERE cardinality(m.campos) > 0`;
}

/** 'Tag "Urgente" adicionada' / 'removida'. */
export async function registrarTag(
  contatoId: string,
  tagId: string,
  acao: "adicionada" | "removida",
) {
  await aSalvo("tag do contato", () =>
    sql`
      INSERT INTO historico (contato_id, descricao)
      SELECT c.id, 'Tag "' || t.nome || '" ' || ${acao}
      FROM contatos c CROSS JOIN tags t
      WHERE c.id = ${contatoId} AND t.id = ${tagId}`,
  );
}
