"use server";

// As ações do módulo Formulários Meta. Toda ação daqui é ponto de entrada de
// rede: exige o módulo e trata a entrada como não confiável — inclusive as
// chaves das perguntas, que são conferidas contra o formulário DE VERDADE, lido
// na Meta, e não contra o que a tela mandou.
import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { exigirModulo } from "@/lib/auth/dal";
import { sql } from "@/lib/db";
import { enderecoDoCrm } from "@/lib/endereco";
import { DESTINOS, type DestinoCampo } from "@/lib/webhooks";
import {
  estadoDaIntegracao,
  formularioComPerguntas,
  ligarRecebimento,
  slugDoFormulario,
  varrerLeadsDaMeta,
  type EstadoIntegracaoMeta,
  type ResultadoVarredura,
} from "@/lib/meta-leads";

export type EntradaFormulario = {
  formId: string;
  /** Uma linha por pergunta com destino. A que não vem é "só guardar na ficha". */
  campos: Array<{ chave: string; destino: string; destinoChave: string }>;
  criarOportunidade: boolean;
  funilId: string;
  etapaId: string;
  responsavelId: string;
  responsavelAlternadoId: string;
  segmentoId: string;
  ativo: boolean;
};

export type Resultado = { ok: true } | { ok: false; erro: string };

class Recusa extends Error {}

/** Destinos que guardam UM valor: duas perguntas no mesmo, a segunda apagaria a primeira. */
const DESTINO_UNICO = new Set<DestinoCampo>([
  "contato.nome",
  "contato.whatsapp",
  "contato.email",
  "contato.cidade",
  "contato.estado",
  "contato.pais",
  "oportunidade.nome",
  "oportunidade.valor",
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Salva a configuração de um formulário: o que cada pergunta vira, se o lead
 * vira oportunidade (e onde, e de quem) e o segmento. Cria a configuração na
 * primeira vez. Uma transação só: ou fica tudo, ou nada.
 */
export async function salvarFormulario(e: EntradaFormulario): Promise<Resultado> {
  await exigirModulo("formularios");
  try {
    if (!/^\d+$/.test(e.formId)) throw new Recusa("Formulário inválido");
    const form = await formularioComPerguntas(e.formId);
    if (!form) throw new Recusa("Não achei este formulário nas páginas da Meta do CRM");
    const perguntas = new Map(form.perguntas.map((p) => [p.chave, p]));

    // ── O que cada pergunta vira ──
    const validos = new Set(DESTINOS.map((d) => d.valor));
    const usados = new Set<string>();
    const campos: Array<{ chave: string; rotulo: string; destino: DestinoCampo; destinoChave: string | null }> = [];
    const personalizados = await sql`SELECT entidade, chave FROM campos_personalizados`;
    const existe = new Set(personalizados.map((c) => `${c.entidade}:${c.chave}`));
    for (const c of e.campos) {
      const pergunta = perguntas.get(c.chave);
      if (!pergunta) throw new Recusa(`A pergunta "${c.chave}" não é deste formulário`);
      const destino = c.destino as DestinoCampo;
      if (!validos.has(destino)) throw new Recusa(`Destino inválido para "${pergunta.rotulo}"`);
      let destinoChave: string | null = null;
      if (destino.endsWith(".campo")) {
        const entidade = destino.startsWith("contato") ? "contato" : "oportunidade";
        if (!existe.has(`${entidade}:${c.destinoChave}`)) {
          throw new Recusa(`O campo personalizado escolhido para "${pergunta.rotulo}" não existe mais`);
        }
        destinoChave = c.destinoChave;
      }
      if (DESTINO_UNICO.has(destino)) {
        if (usados.has(destino)) {
          const rotulo = DESTINOS.find((d) => d.valor === destino)?.rotulo ?? destino;
          throw new Recusa(`Duas perguntas vão para "${rotulo}" — escolha uma só`);
        }
        usados.add(destino);
      }
      campos.push({ chave: c.chave, rotulo: pergunta.rotulo.slice(0, 200), destino, destinoChave });
    }
    if (!usados.has("contato.whatsapp") && !usados.has("contato.email")) {
      throw new Recusa(
        "Mande o telefone ou o e-mail para o contato: sem eles o CRM não reconhece a pessoa de novo nem consegue falar com ela",
      );
    }

    // ── Para onde o lead vai ──
    const funilId = e.funilId.trim();
    const etapaId = e.etapaId.trim();
    if (e.criarOportunidade) {
      if (!UUID.test(funilId) || !UUID.test(etapaId)) throw new Recusa("Escolha o funil e a etapa");
      const [et] = await sql`SELECT 1 FROM etapas WHERE id = ${etapaId} AND funil_id = ${funilId}`;
      if (!et) throw new Recusa("A etapa escolhida não é deste funil");
    }
    const dono = e.criarOportunidade && UUID.test(e.responsavelId) ? e.responsavelId : null;
    const alternado = e.criarOportunidade && UUID.test(e.responsavelAlternadoId) ? e.responsavelAlternadoId : null;
    if (alternado && !dono) throw new Recusa("Para alternar, escolha o primeiro responsável também");
    if (alternado && alternado === dono) throw new Recusa("A alternância precisa de duas pessoas diferentes");
    for (const u of [dono, alternado].filter(Boolean) as string[]) {
      const [ok] = await sql`SELECT 1 FROM usuarios WHERE id = ${u} AND ativo`;
      if (!ok) throw new Recusa("O responsável escolhido não está mais ativo");
    }
    const segmentoId = UUID.test(e.segmentoId) ? e.segmentoId : null;
    if (segmentoId) {
      const [s] = await sql`SELECT 1 FROM segmentos WHERE id = ${segmentoId}`;
      if (!s) throw new Recusa("O segmento escolhido não existe mais");
    }

    await sql.begin(async (tx: typeof sql) => {
      const [w] = await tx`
        INSERT INTO webhooks (nome, descricao, slug, segredo, ativo)
        VALUES (
          ${`Meta · ${form.nome}`.slice(0, 120)},
          ${`Formulário instantâneo da página ${form.pagina.nome}.`},
          ${slugDoFormulario(form.id)},
          ${randomBytes(32).toString("hex")},
          ${e.ativo})
        ON CONFLICT (slug) DO UPDATE
          SET nome = EXCLUDED.nome, ativo = EXCLUDED.ativo, data_atualizacao = now()
        RETURNING id`;
      const webhookId = w.id as string;

      await tx`DELETE FROM webhook_campos WHERE webhook_id = ${webhookId}`;
      let ordem = 0;
      for (const c of campos) {
        ordem++;
        await tx`
          INSERT INTO webhook_campos (webhook_id, chave, rotulo, tipo, obrigatorio, destino, destino_chave, ordem)
          VALUES (${webhookId}, ${c.chave}, ${c.rotulo},
                  ${c.destino === "oportunidade.valor" ? "numero" : "texto"},
                  false, ${c.destino}, ${c.destinoChave}, ${ordem})`;
      }

      const atualizados = await tx`
        UPDATE webhook_acoes
           SET criar_oportunidade = ${e.criarOportunidade},
               funil_id = ${e.criarOportunidade ? funilId : null},
               etapa_id = ${e.criarOportunidade ? etapaId : null},
               responsavel_id = ${dono},
               responsavel_alternado_id = ${alternado},
               -- Trocar quem está no rodízio zera a vez (ver configurarCriarLead,
               -- em app/webhooks/acoes.ts).
               ultimo_responsavel_id = NULL
         WHERE webhook_id = ${webhookId} AND tipo = 'criar_lead'
        RETURNING id`;
      if (atualizados.length === 0) {
        await tx`
          INSERT INTO webhook_acoes
            (webhook_id, tipo, ordem, criar_oportunidade, funil_id, etapa_id, responsavel_id, responsavel_alternado_id)
          VALUES (${webhookId}, 'criar_lead', 0, ${e.criarOportunidade},
                  ${e.criarOportunidade ? funilId : null}, ${e.criarOportunidade ? etapaId : null},
                  ${dono}, ${alternado})`;
      }

      await tx`DELETE FROM webhook_acoes WHERE webhook_id = ${webhookId} AND tipo = 'adicionar_segmento'`;
      if (segmentoId) {
        await tx`
          INSERT INTO webhook_acoes (webhook_id, tipo, ordem, segmento_id)
          VALUES (${webhookId}, 'adicionar_segmento', 1, ${segmentoId})`;
      }
    });

    revalidatePath("/formularios");
    return { ok: true };
  } catch (err) {
    if (err instanceof Recusa) return { ok: false, erro: err.message };
    console.error("[formularios] salvar:", err);
    return { ok: false, erro: err instanceof Error ? err.message : "Não consegui salvar agora" };
  }
}

/** Liga ou pausa o recebimento de um formulário já configurado. */
export async function alternarFormulario(formId: string, ativo: boolean): Promise<Resultado> {
  await exigirModulo("formularios");
  if (!/^\d+$/.test(formId)) return { ok: false, erro: "Formulário inválido" };
  const feitos = await sql`
    UPDATE webhooks SET ativo = ${ativo}, data_atualizacao = now()
     WHERE slug = ${slugDoFormulario(formId)} RETURNING id`;
  if (feitos.length === 0) return { ok: false, erro: "Configure o formulário antes de ligar" };
  revalidatePath("/formularios");
  return { ok: true };
}

export async function estadoIntegracaoMeta(): Promise<EstadoIntegracaoMeta> {
  await exigirModulo("formularios");
  return estadoDaIntegracao();
}

export async function ligarRecebimentoMeta(): Promise<{ ok: boolean; mensagem: string }> {
  await exigirModulo("formularios");
  const base = enderecoDoCrm(await headers());
  try {
    const feito = await ligarRecebimento(base.url, base.publico);
    return {
      ok: true,
      mensagem: feito.length ? `Feito: ${feito.join(" · ")}.` : "Já estava tudo ligado.",
    };
  } catch (err) {
    return { ok: false, mensagem: err instanceof Error ? err.message : "Não consegui ligar o recebimento." };
  }
}

/**
 * "Buscar leads agora" de um formulário: os últimos 7 dias. SÓ no endereço
 * público: no ambiente de teste um lead de verdade entraria no banco de lá,
 * passaria pela cadência de lá e a pessoa receberia mensagem duas vezes.
 */
export async function buscarLeadsAgora(
  formId: string,
): Promise<{ ok: true; resultado: ResultadoVarredura } | { ok: false; mensagem: string }> {
  await exigirModulo("formularios");
  const base = enderecoDoCrm(await headers());
  if (!base.publico) {
    return {
      ok: false,
      mensagem:
        "No ambiente de teste a busca real fica desligada: o lead entraria aqui e na produção, e a pessoa receberia mensagem duas vezes.",
    };
  }
  if (!/^\d+$/.test(formId)) return { ok: false, mensagem: "Formulário inválido" };
  try {
    const resultado = await varrerLeadsDaMeta(7 * 24, formId);
    if (resultado.novos > 0) {
      revalidatePath("/");
      revalidatePath("/formularios");
    }
    return { ok: true, resultado };
  } catch (err) {
    return { ok: false, mensagem: err instanceof Error ? err.message : "Falha ao buscar na Meta." };
  }
}
