// A conexão que a IA usa para ler o CRM — separada de lib/db.ts de propósito.
//
// POR QUE UMA SEGUNDA CONEXÃO. O pedido é explícito: "não deve ser nunca
// possivel deletar dados… nunca remover elas de tags, segmentos". Enquanto a IA
// entrar no banco como dono, essa promessa é só uma frase no system prompt — e
// system prompt é texto que uma mensagem de WhatsApp bem escrita consegue
// disputar (ver ./sanitizar.ts). Com um role sem o privilégio, "não pode
// apagar" para de ser uma regra que o modelo obedece e vira um erro do Postgres
// que ele não tem como contornar.
//
// O ROLE está em migration-revisao-modulos.sql §5 (`chroma_ia`): SELECT em
// tudo, INSERT só em segmento/vínculo de segmento/estrutura de fluxo, UPDATE só
// em colunas de rascunho, DELETE em lugar nenhum, e nada em fluxo_execucoes —
// que é o que faria a IA DISPARAR automação para gente real.
//
// SEM DATABASE_URL_IA definida, isto cai de volta na conexão de dono e AVISA no
// log. É degradação consciente: sem o fallback, esquecer a variável derrubaria
// o painel de IA inteiro em vez de só deixá-lo sem a trava. O aviso existe para
// a diferença não passar despercebida em produção.
import postgres from "postgres";

type SqlPermissivo = ((
  strings: TemplateStringsArray,
  ...values: unknown[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
) => Promise<any[]>) & { [k: string]: any };

let cliente: ReturnType<typeof postgres> | null = null;
let avisou = false;

function conectar() {
  if (!cliente) {
    const url = process.env.DATABASE_URL_IA ?? process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL_IA/DATABASE_URL não definida");

    if (!process.env.DATABASE_URL_IA && !avisou) {
      avisou = true;
      console.warn(
        "[ia] DATABASE_URL_IA não definida — a IA está lendo o banco como DONO. " +
          "A garantia de 'não pode apagar' é só o prompt até você rodar " +
          "migration-revisao-modulos.sql §5 e apontar DATABASE_URL_IA para o role chroma_ia.",
      );
    }

    // Mesma configuração de lib/db.ts (pooler de transação: sem prepared
    // statements, sem a query de tipos). `max` bem menor: aqui só entram as
    // consultas de uma conversa por vez, não o Promise.all de uma página.
    cliente = postgres(url, {
      ssl: "require",
      prepare: false,
      fetch_types: false,
      max: 4,
      idle_timeout: 20,
      connect_timeout: 15,
    });
  }
  return cliente;
}

export const sqlIa = new Proxy((() => {}) as unknown as SqlPermissivo, {
  apply(_alvo, _this, args: unknown[]) {
    return (conectar() as unknown as (...a: unknown[]) => unknown)(...args);
  },
  get(_alvo, prop) {
    const real = conectar() as unknown as Record<PropertyKey, unknown>;
    const valor = real[prop];
    return typeof valor === "function" ? valor.bind(real) : valor;
  },
}) as SqlPermissivo;
