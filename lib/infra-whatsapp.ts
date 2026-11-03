// Módulo Infra: os dois WhatsApps.
//   · Oficial (Meta): por número, a qualidade (verde, amarela, vermelha), o
//     limite de conversas que a empresa inicia em 24 h (o "tier", que a Meta põe
//     em whatsapp_business_manager_messaging_limit) e o estado de envio
//     (health_status: disponível, limitado, bloqueado). O uso contra o tier sai
//     do banco: contatos que receberam mensagem nossa pelo número nas últimas
//     24 h. É uma estimativa por cima, porque resposta dentro da janela que o
//     lead abriu não conta para a Meta. O token do usuário de sistema também
//     aparece: token vencido derruba o oficial inteiro.
//   · Web (uazapi): o estado de cada instância (lib/uazapi-estado.ts), com a
//     secundária que assume quando a principal cai (lib/uazapi-reserva.ts).
import "server-only";
import { sql } from "@/lib/db";
import { requisicao, wabasMeta } from "@/lib/meta";
import { buscarInstanciasRemotas, estadoDa } from "@/lib/uazapi-estado";
import { estadoPorUso, piorEstado, type CartaoInfra, type EstadoInfra, type MedidaInfra } from "@/lib/infra-tipos";

const TIERS: Record<string, number> = {
  TIER_50: 50,
  TIER_250: 250,
  TIER_1K: 1_000,
  TIER_2K: 2_000,
  TIER_10K: 10_000,
  TIER_100K: 100_000,
};

const QUALIDADE: Record<string, { valor: string; estado: EstadoInfra }> = {
  GREEN: { valor: "Alta (verde)", estado: "ok" },
  YELLOW: { valor: "Média (amarela)", estado: "atencao" },
  RED: { valor: "Baixa (vermelha)", estado: "critico" },
};

const ENVIO: Record<string, { valor: string; estado: EstadoInfra }> = {
  AVAILABLE: { valor: "Disponível", estado: "ok" },
  LIMITED: { valor: "Limitado", estado: "atencao" },
  BLOCKED: { valor: "Bloqueado", estado: "critico" },
};

// O que a Meta escreve em additional_info, em português. O resto vai como veio.
const AVISOS_DA_META: Array<[RegExp, string]> = [
  [/messaging limit will decrease/i, "a Meta avisa que o limite de conversas vai cair se a qualidade não melhorar"],
];

type Saude = {
  can_send_message?: string;
  entities?: Array<{ entity_type: string; can_send_message?: string; additional_info?: string[] }>;
};

const fim4 = (numero: string) => numero.replace(/\D/g, "").slice(-4);
const mil = (n: number) => n.toLocaleString("pt-BR");

export async function cartaoWhatsappOficial(): Promise<CartaoInfra> {
  const lidoEm = new Date().toISOString();
  const base = { chave: "whatsapp-oficial", titulo: "WhatsApp oficial", subtitulo: "Meta · Cloud API, campanhas e templates", lidoEm };
  const medidas: MedidaInfra[] = [];
  const avisos: string[] = [];

  const enviadas = await sql`
    SELECT right(regexp_replace(coalesce(a.numero_instancia, ''), '\\D', '', 'g'), 8) AS fim8,
           count(DISTINCT a.contato_id)::int AS contatos
      FROM mensagens m
      JOIN atendimentos a ON a.id = m.atendimento_id
     WHERE a.canal = 'whatsapp_oficial' AND m.origem = 'agente' AND m.data_criacao > now() - interval '24 hours'
     GROUP BY 1`;
  const porNumero = new Map(enviadas.map((e) => [e.fim8 as string, Number(e.contatos)]));

  for (const waba of await wabasMeta()) {
    const [conta, numeros] = await Promise.all([
      requisicao<{ whatsapp_business_manager_messaging_limit?: string }>(waba.id, {
        params: { fields: "whatsapp_business_manager_messaging_limit" },
      }),
      requisicao<{ data: Array<{ id: string; display_phone_number: string; quality_rating?: string; health_status?: Saude }> }>(
        `${waba.id}/phone_numbers`,
        { params: { fields: "display_phone_number,quality_rating,health_status", limit: "100" } },
      ),
    ]);
    const tier = conta.whatsapp_business_manager_messaging_limit ?? "";
    const limite = TIERS[tier];
    for (const n of numeros.data) {
      const final = `…${fim4(n.display_phone_number)}`;
      const qualidade = QUALIDADE[n.quality_rating ?? ""] ?? { valor: n.quality_rating ?? "sem nota", estado: "desconhecido" as const };
      medidas.push({ rotulo: `Qualidade ${final}`, valor: qualidade.valor, estado: qualidade.estado });

      const contatos = porNumero.get(n.display_phone_number.replace(/\D/g, "").slice(-8)) ?? 0;
      if (limite) {
        const uso = contatos / limite;
        medidas.push({ rotulo: `Conversas em 24 h ${final}`, valor: mil(contatos), limite: `de ${mil(limite)} (${tier})`, uso, estado: estadoPorUso(uso) });
        if (uso >= 0.75) avisos.push(`O número ${final} já falou com ${mil(contatos)} contatos em 24 h, perto do limite de ${mil(limite)}: acima dele, a Meta recusa as mensagens novas.`);
      } else {
        medidas.push({ rotulo: `Conversas em 24 h ${final}`, valor: mil(contatos), limite: tier === "TIER_UNLIMITED" ? "sem limite" : "limite não lido" });
      }

      const saudeNumero = n.health_status?.entities?.find((e) => e.entity_type === "PHONE_NUMBER");
      const envio = ENVIO[saudeNumero?.can_send_message ?? n.health_status?.can_send_message ?? ""];
      if (envio) medidas.push({ rotulo: `Envio ${final}`, valor: envio.valor, estado: envio.estado });
      for (const info of saudeNumero?.additional_info ?? []) {
        const traduzido = AVISOS_DA_META.find(([re]) => re.test(info))?.[1] ?? info;
        avisos.push(`Número ${final}: ${traduzido}.`);
      }
      if (qualidade.estado === "critico") {
        avisos.push(`A qualidade do número ${final} está vermelha: é o último aviso da Meta antes de cortar o limite. Segure campanhas frias e mande só para quem pediu.`);
      }
    }
  }

  const tokenDoSistema = process.env.META_SYSTEM_USER_TOKEN?.trim();
  if (tokenDoSistema) {
    const d = await requisicao<{ data?: { is_valid?: boolean; expires_at?: number } }>("debug_token", {
      params: { input_token: tokenDoSistema },
    }).catch(() => null);
    const expira = d?.data?.expires_at ?? null;
    if (d?.data?.is_valid === false) {
      medidas.push({ rotulo: "Token da Meta", valor: "Inválido", estado: "critico" });
      avisos.push("O token da Meta não vale mais: o oficial, as campanhas, os leads e o Instagram param até gerar outro.");
    } else if (expira) {
      const dias = Math.floor((expira * 1000 - Date.now()) / 86_400_000);
      const estado: EstadoInfra = dias <= 7 ? "critico" : dias <= 30 ? "atencao" : "ok";
      medidas.push({ rotulo: "Token da Meta", valor: `vence em ${dias} dias`, estado });
      if (estado !== "ok") avisos.push(`O token da Meta vence em ${dias} dias: gere outro antes, ou o oficial, as campanhas e o Instagram param.`);
    } else if (d?.data) {
      medidas.push({ rotulo: "Token da Meta", valor: "Não vence", estado: "ok" });
    }
  }

  return { ...base, estado: piorEstado(...medidas.map((m) => m.estado)), medidas, avisos };
}

const ESTADO_WEB: Record<string, { valor: string; estado: EstadoInfra }> = {
  conectado: { valor: "Conectado", estado: "ok" },
  conectando: { valor: "Conectando", estado: "atencao" },
  desconectado: { valor: "Desconectado", estado: "critico" },
  desconhecido: { valor: "Sem resposta", estado: "desconhecido" },
};

export async function cartaoWhatsappWeb(): Promise<CartaoInfra> {
  const linhas = await sql`
    SELECT id, nome, numero, instancia_uazapi_id, secundaria_de
      FROM instancias_uazapi
     WHERE tipo = 'web'
     ORDER BY data_criacao`;
  const remotas = await buscarInstanciasRemotas()
    .then((l) => (l.length ? l : null))
    .catch(() => null);
  const estados = new Map(linhas.map((l) => [l.id as string, estadoDa(remotas, l)]));
  const nomes = new Map(linhas.map((l) => [l.id as string, l.nome as string]));

  const medidas: MedidaInfra[] = [];
  const avisos: string[] = [];
  for (const l of linhas) {
    const estado = estados.get(l.id as string) ?? "desconhecido";
    const visual = { ...ESTADO_WEB[estado] };
    const principalDe = l.secundaria_de ? nomes.get(l.secundaria_de as string) : null;
    const reserva = linhas.find((o) => o.secundaria_de === l.id);
    const reservaVerde = reserva && estados.get(reserva.id as string) === "conectado";
    if (estado === "desconectado" && reservaVerde) visual.estado = "atencao";
    medidas.push({
      rotulo: principalDe ? `${l.nome} (secundária de ${principalDe})` : (l.nome as string),
      valor: visual.valor,
      limite: l.numero ? `…${fim4(l.numero as string)}` : "sem número pareado",
      estado: visual.estado,
    });
    if (estado === "desconectado") {
      avisos.push(
        reservaVerde
          ? `${l.nome} caiu: a secundária ${reserva.nome} está assumindo os envios. Reconecte pelo QR em Configurações › WhatsApp.`
          : `${l.nome} está desconectado: as conversas, a IA e as cadências desse número não saem. Reconecte pelo QR em Configurações › WhatsApp.`,
      );
    }
  }
  if (!remotas && linhas.length) avisos.push("A uazapi não respondeu agora: o estado das instâncias não foi lido.");

  return {
    chave: "whatsapp-web",
    titulo: "WhatsApp Web",
    subtitulo: "uazapi · chat do comercial, IA e cadências",
    estado: linhas.length ? piorEstado(...medidas.map((m) => m.estado)) : "desconhecido",
    medidas: linhas.length ? medidas : [{ rotulo: "Instâncias", valor: "nenhuma cadastrada" }],
    avisos,
    lidoEm: new Date().toISOString(),
  };
}
