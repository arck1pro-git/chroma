"use client";

import { useEffect, useState, type ComponentType, type SVGProps } from "react";
import {
  Calendar,
  CheckCircle2,
  Circle,
  Mail,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import LogoGoogleCalendar from "../components/logo-google-calendar";
import LogoMeta from "../components/logo-meta";
import { SeletorMenu } from "../components/filtros-ui";

type IconeSvg = ComponentType<SVGProps<SVGSVGElement>>;
type IntegracaoId = "meta" | "email" | "google-calendar";

type Integracao = {
  id: IntegracaoId;
  nome: string;
  descricao: string;
  Logo: IconeSvg;
  // O que gera acesso e roda em runtime mora no banco (esta conexão); o segredo
  // fixo do app fica em variável de ambiente. Esta linha é o lembrete disso.
  segredoEnv: string;
};

// Catálogo é conteúdo de UI, não tabela: quais integrações existem não muda com
// o uso. O que muda — se está conectada e com qual conta — é o estado abaixo.
const CATALOGO: Integracao[] = [
  {
    id: "meta",
    nome: "Meta",
    descricao:
      "API oficial (Graph) para disparos no WhatsApp, Instagram e Facebook.",
    Logo: LogoMeta,
    segredoEnv: "META_APP_ID e META_APP_SECRET",
  },
  {
    id: "email",
    nome: "E-mail",
    descricao: "Provedor de envio para disparar os e-mails criados no módulo.",
    Logo: Mail,
    segredoEnv: "a chave de API do provedor",
  },
  {
    id: "google-calendar",
    nome: "Google Calendar",
    descricao: "Sincronize reuniões e compromissos com o funil.",
    Logo: LogoGoogleCalendar,
    segredoEnv: "GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET",
  },
];

type Conexao = { conectado: boolean; conta?: string };

// ⚠ Mock de UI, não tabela do banco. Numa conexão real, isto vira uma linha por
// integração com o token (criptografado em repouso), a conta e a validade — a
// modelagem é sua. Aqui só guardo se está ligada e o rótulo da conta, que é o
// necessário pra tela mostrar os dois estados.
const CONEXAO_VAZIA: Record<IntegracaoId, Conexao> = {
  meta: { conectado: false },
  email: { conectado: false },
  "google-calendar": { conectado: false },
};

export default function Integracoes() {
  const [conexoes, setConexoes] =
    useState<Record<IntegracaoId, Conexao>>(CONEXAO_VAZIA);
  const [aberta, setAberta] = useState<IntegracaoId | null>(null);

  const integracaoAberta = CATALOGO.find((i) => i.id === aberta) ?? null;

  function conectar(id: IntegracaoId, conta: string) {
    setConexoes((c) => ({ ...c, [id]: { conectado: true, conta } }));
  }
  function desconectar(id: IntegracaoId) {
    setConexoes((c) => ({ ...c, [id]: { conectado: false } }));
  }

  const totalConectadas = Object.values(conexoes).filter(
    (c) => c.conectado,
  ).length;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-conteudo">
      <header className="border-b border-zinc-200 px-6 py-4 xl:px-16 dark:border-zinc-800">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Integrações
          </h1>
          <p className="mt-0.5 text-[13px] text-zinc-500 dark:text-zinc-400">
            {totalConectadas === 0
              ? "Nenhuma conexão ativa ainda."
              : `${totalConectadas} de ${CATALOGO.length} ${
                  totalConectadas === 1 ? "conectada" : "conectadas"
                }.`}
          </p>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-6 py-6 xl:px-16">
        <ul className="mx-auto flex max-w-3xl flex-col gap-3">
          {CATALOGO.map((integracao) => {
            const conexao = conexoes[integracao.id];
            const { Logo } = integracao;
            return (
              <li
                key={integracao.id}
                className="flex items-center gap-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
                  <Logo className="size-6" aria-hidden="true" />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[14px] font-semibold text-zinc-900 dark:text-zinc-50">
                      {integracao.nome}
                    </p>
                    <StatusPill conectado={conexao.conectado} />
                  </div>
                  <p className="mt-0.5 truncate text-[12px] text-zinc-500 dark:text-zinc-400">
                    {conexao.conectado && conexao.conta
                      ? conexao.conta
                      : integracao.descricao}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setAberta(integracao.id)}
                  className={
                    conexao.conectado
                      ? "shrink-0 rounded-lg border border-zinc-300 px-3 py-2 text-[13px] font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                      : "shrink-0 rounded-lg bg-zinc-900 px-3 py-2 text-[13px] font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                  }
                >
                  {conexao.conectado ? "Gerenciar" : "Conectar"}
                </button>
              </li>
            );
          })}
        </ul>
      </main>

      {integracaoAberta && (
        <PainelConexao
          integracao={integracaoAberta}
          conexao={conexoes[integracaoAberta.id]}
          aoConectar={(conta) => conectar(integracaoAberta.id, conta)}
          aoDesconectar={() => desconectar(integracaoAberta.id)}
          aoFechar={() => setAberta(null)}
        />
      )}
    </div>
  );
}

function StatusPill({ conectado }: { conectado: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${
        conectado
          ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20"
          : "bg-zinc-50 text-zinc-500 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-zinc-700"
      }`}
    >
      {conectado ? (
        <CheckCircle2 className="size-3" aria-hidden="true" />
      ) : (
        <Circle className="size-3" aria-hidden="true" />
      )}
      {conectado ? "Conectado" : "Não conectado"}
    </span>
  );
}

function PainelConexao({
  integracao,
  conexao,
  aoConectar,
  aoDesconectar,
  aoFechar,
}: {
  integracao: Integracao;
  conexao: Conexao;
  aoConectar: (conta: string) => void;
  aoDesconectar: () => void;
  aoFechar: () => void;
}) {
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") aoFechar();
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  const { Logo } = integracao;

  return (
    <div
      className="veu-surge fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[1px]"
      onClick={aoFechar}
      role="dialog"
      aria-modal="true"
      aria-label={`Conexão · ${integracao.nome}`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <header className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
              <Logo className="size-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                {integracao.nome}
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {conexao.conectado ? "Conexão ativa" : "Configurar conexão"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar"
            className="-mr-1 shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="px-5 py-4">
          {conexao.conectado ? (
            <ResumoConexao
              conta={conexao.conta ?? ""}
              aoDesconectar={() => {
                aoDesconectar();
                aoFechar();
              }}
            />
          ) : integracao.id === "meta" ? (
            <FormMeta aoConectar={aoConectar} aoFechar={aoFechar} />
          ) : integracao.id === "email" ? (
            <FormEmail aoConectar={aoConectar} aoFechar={aoFechar} />
          ) : (
            <FormGoogleCalendar aoConectar={aoConectar} aoFechar={aoFechar} />
          )}
        </div>

        <NotaSegredo texto={integracao.segredoEnv} />
      </div>
    </div>
  );
}

// Fecha todo painel: o segredo do app não se digita aqui. Amarra a decisão de
// arquitetura (env para o fixo/secreto, banco para o que rotaciona) na tela.
function NotaSegredo({ texto }: { texto: string }) {
  return (
    <div className="flex items-start gap-2 border-t border-zinc-200 bg-zinc-50 px-5 py-3 dark:border-zinc-800 dark:bg-zinc-900/40">
      <ShieldCheck
        className="mt-0.5 size-3.5 shrink-0 text-zinc-400"
        aria-hidden="true"
      />
      <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
        {texto} ficam em variáveis de ambiente, não aqui. Esta tela guarda só o
        acesso gerado na autorização.
      </p>
    </div>
  );
}

function ResumoConexao({
  conta,
  aoDesconectar,
}: {
  conta: string;
  aoDesconectar: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 dark:border-emerald-500/20 dark:bg-emerald-500/10">
        <CheckCircle2
          className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
          aria-hidden="true"
        />
        <p className="min-w-0 truncate text-[13px] font-medium text-emerald-800 dark:text-emerald-300">
          {conta}
        </p>
      </div>
      <button
        type="button"
        onClick={aoDesconectar}
        className="self-start rounded-lg border border-red-200 px-3 py-2 text-[13px] font-medium text-red-600 transition hover:bg-red-50 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-500/10"
      >
        Desconectar
      </button>
    </div>
  );
}

const campoTexto =
  "w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus-visible:ring-zinc-100/10";

function Campo({
  rotulo,
  children,
}: {
  rotulo: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        {rotulo}
      </span>
      {children}
    </label>
  );
}

function AcoesForm({
  rotulo,
  Icone,
  desabilitado,
  aoFechar,
}: {
  rotulo: string;
  Icone: IconeSvg;
  desabilitado?: boolean;
  aoFechar: () => void;
}) {
  return (
    <div className="mt-1 flex items-center justify-end gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <button
        type="button"
        onClick={aoFechar}
        className="rounded-lg border border-zinc-300 px-3 py-2 text-[13px] font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
      >
        Cancelar
      </button>
      <button
        type="submit"
        disabled={desabilitado}
        className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-2 text-[13px] font-medium text-white transition hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        <Icone className="size-4" aria-hidden="true" />
        {rotulo}
      </button>
    </div>
  );
}

function FormMeta({
  aoConectar,
  aoFechar,
}: {
  aoConectar: (conta: string) => void;
  aoFechar: () => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        // No real, aqui abre o OAuth da Meta; ele devolve o token e a conta,
        // que é o que guardamos. O mock pula direto pro resultado.
        aoConectar("WhatsApp Business · Chroma (verificado)");
      }}
      className="flex flex-col gap-4"
    >
      <p className="text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">
        Autorize o app da Chroma na sua conta Business para liberar os disparos
        pela API oficial. Você escolhe as contas na tela da Meta.
      </p>
      <AcoesForm rotulo="Autorizar com a Meta" Icone={LogoMeta} aoFechar={aoFechar} />
    </form>
  );
}

const PROVEDORES = [
  { valor: "resend", rotulo: "Resend" },
  { valor: "sendgrid", rotulo: "SendGrid" },
  { valor: "ses", rotulo: "Amazon SES" },
  { valor: "smtp", rotulo: "SMTP" },
];

function FormEmail({
  aoConectar,
  aoFechar,
}: {
  aoConectar: (conta: string) => void;
  aoFechar: () => void;
}) {
  const [provedor, setProvedor] = useState("resend");
  const [dominio, setDominio] = useState("");

  const rotuloProvedor =
    PROVEDORES.find((p) => p.valor === provedor)?.rotulo ?? provedor;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!dominio.trim()) return;
        aoConectar(`${rotuloProvedor} · ${dominio.trim()}`);
      }}
      className="flex flex-col gap-4"
    >
      <Campo rotulo="Provedor">
        <SeletorMenu
          Icone={Send}
          rotulo="Escolher provedor"
          valor={provedor}
          opcoes={PROVEDORES}
          aoMudar={setProvedor}
          botao="w-full"
          ativo
        />
      </Campo>
      <Campo rotulo="Domínio remetente">
        <input
          type="text"
          value={dominio}
          onChange={(e) => setDominio(e.target.value)}
          placeholder="chroma.com.br"
          autoFocus
          required
          className={campoTexto}
        />
      </Campo>
      <AcoesForm
        rotulo="Ativar envio"
        Icone={Send}
        desabilitado={!dominio.trim()}
        aoFechar={aoFechar}
      />
    </form>
  );
}

function FormGoogleCalendar({
  aoConectar,
  aoFechar,
}: {
  aoConectar: (conta: string) => void;
  aoFechar: () => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        // Igual à Meta: no real abre o consentimento do Google e volta com a
        // conta autorizada. Mock entrega o resultado.
        aoConectar("agenda@chroma.com.br");
      }}
      className="flex flex-col gap-4"
    >
      <p className="text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">
        Conecte uma conta Google para sincronizar compromissos do funil com a
        agenda. O consentimento é feito na tela do Google.
      </p>
      <AcoesForm
        rotulo="Conectar com o Google"
        Icone={Calendar}
        aoFechar={aoFechar}
      />
    </form>
  );
}
