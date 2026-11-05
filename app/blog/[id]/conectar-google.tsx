"use client";

// Antes dos números do Google: o que falta para lê-los, como passo a passo.
//
// Não é tela de erro. "Sem acesso" é o estado de TODO blog novo — a conta de
// serviço do CRM só enxerga o site depois que alguém a adiciona como usuária no
// Search Console dele. A tela diz exatamente onde clicar, entrega o e-mail para
// copiar e confere de novo com um botão. Ver lib/blog-google.ts para a ordem
// das perguntas (credencial → endereço → acesso).
import { useState } from "react";
import type { GoogleDoBlog } from "@/lib/blog-google-tipos";
import { AlertTriangle, Check, Copy, ExternalLink, Globe, RefreshCw, Search } from "@/app/components/icones";

type EstadoSemDados = Exclude<GoogleDoBlog, { estado: "ok" }>;

export default function ConectarGoogle({
  estado,
  verificando,
  podeEditar,
  aoVerificar,
  aoConfigurar,
}: {
  estado: EstadoSemDados;
  verificando: boolean;
  podeEditar: boolean;
  aoVerificar: () => void;
  aoConfigurar: () => void;
}) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-4 pb-10 pt-4 @md:px-6">
        <div className="surge rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900 tela-baixa:p-5">
          <span className="flex size-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600 ring-1 ring-inset ring-sky-100 dark:bg-sky-950/60 dark:text-sky-400 dark:ring-sky-900">
            {estado.estado === "erro" ? <AlertTriangle className="size-5" aria-hidden="true" /> : <Search className="size-5" aria-hidden="true" />}
          </span>

          {estado.estado === "sem-endereco" && (
            <>
              <Titulo>Diga ao CRM onde o blog mora</Titulo>
              <Texto>
                Os números vêm do Search Console do site. Para achar o site certo, o blog precisa do endereço dele —
                o mesmo que monta o link de cada artigo (ex.: https://amaan.com.br/blog).
              </Texto>
              {podeEditar && (
                <BotaoPrimario aoClicar={aoConfigurar}>
                  <Globe className="size-3.5" aria-hidden="true" />
                  Definir o endereço do blog
                </BotaoPrimario>
              )}
            </>
          )}

          {estado.estado === "sem-acesso" && <SemAcesso estado={estado} verificando={verificando} aoVerificar={aoVerificar} />}

          {estado.estado === "sem-credencial" && (
            <>
              <Titulo>O Google não está configurado neste servidor</Titulo>
              <Texto>
                Faltam as credenciais da conta de serviço do Google (GOOGLE_SA_EMAIL e GOOGLE_SA_PRIVATE_KEY). Quem
                cuida do TI coloca as duas nas variáveis de ambiente, e os números aparecem aqui.
              </Texto>
            </>
          )}

          {estado.estado === "erro" && (
            <>
              <Titulo>O Search Console não respondeu</Titulo>
              <Texto>Pode ser instabilidade do Google. Tente de novo em instantes.</Texto>
              <p className="mt-2 break-words rounded-lg bg-zinc-50 px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400">
                {estado.mensagem}
              </p>
              <BotaoPrimario aoClicar={aoVerificar} ocupado={verificando}>
                <RefreshCw className={`size-3.5 ${verificando ? "animate-spin" : ""}`} aria-hidden="true" />
                {verificando ? "Tentando…" : "Tentar de novo"}
              </BotaoPrimario>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SemAcesso({
  estado,
  verificando,
  aoVerificar,
}: {
  estado: Extract<EstadoSemDados, { estado: "sem-acesso" }>;
  verificando: boolean;
  aoVerificar: () => void;
}) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(estado.email);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sem permissão de área de transferência: o e-mail está na tela para selecionar.
    }
  }

  return (
    <>
      <Titulo>Conecte o Search Console de {estado.host}</Titulo>
      <Texto>
        Um passo só, feito uma vez no Google: dar ao CRM acesso de leitura ao site. Leva um minuto.
      </Texto>

      <ol className="mt-5 flex flex-col gap-4">
        <Passo n={1}>
          Abra o{" "}
          <a
            href="https://search.google.com/search-console"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 font-medium text-sky-700 underline-offset-2 hover:underline dark:text-sky-400"
          >
            Search Console
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>{" "}
          e escolha a propriedade de <strong className="font-medium text-zinc-900 dark:text-zinc-50">{estado.host}</strong>.
          Se ela não existir, crie uma do tipo Domínio.
        </Passo>
        <Passo n={2}>
          Vá em <strong className="font-medium text-zinc-900 dark:text-zinc-50">Configurações → Usuários e permissões</strong>{" "}
          e clique em <strong className="font-medium text-zinc-900 dark:text-zinc-50">Adicionar usuário</strong>.
        </Passo>
        <Passo n={3}>
          Cole este e-mail e deixe a permissão como <strong className="font-medium text-zinc-900 dark:text-zinc-50">Restrita</strong>{" "}
          (só leitura):
          <span className="mt-2 flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 py-1.5 pl-3 pr-1.5 dark:border-zinc-700 dark:bg-zinc-800/60">
            <code className="min-w-0 flex-1 select-all break-all font-mono text-[12px] text-zinc-800 dark:text-zinc-200">
              {estado.email}
            </code>
            <button
              type="button"
              onClick={copiar}
              className="flex shrink-0 items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] font-medium text-zinc-700 shadow-sm ring-1 ring-zinc-200 transition hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-700 dark:hover:bg-zinc-800"
            >
              {copiado ? <Check className="size-3" aria-hidden="true" /> : <Copy className="size-3" aria-hidden="true" />}
              {copiado ? "Copiado" : "Copiar"}
            </button>
          </span>
        </Passo>
        <Passo n={4}>Volte aqui e confira.</Passo>
      </ol>

      <BotaoPrimario aoClicar={aoVerificar} ocupado={verificando}>
        <RefreshCw className={`size-3.5 ${verificando ? "animate-spin" : ""}`} aria-hidden="true" />
        {verificando ? "Conferindo…" : "Já adicionei, conferir"}
      </BotaoPrimario>

      <p className="mt-4 text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">
        {estado.propriedades.length === 0
          ? "Hoje a conta do CRM não enxerga nenhum site no Search Console."
          : `Hoje a conta do CRM enxerga: ${estado.propriedades.map((p) => p.replace(/^sc-domain:/, "")).join(", ")}. Nenhum cobre o endereço deste blog.`}
      </p>
    </>
  );
}

function Titulo({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-4 text-[16px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{children}</h2>;
}

function Texto({ children }: { children: React.ReactNode }) {
  return <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">{children}</p>;
}

function Passo({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[11px] font-semibold text-white dark:bg-zinc-50 dark:text-zinc-900">
        {n}
      </span>
      <span className="min-w-0 pt-0.5 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">{children}</span>
    </li>
  );
}

function BotaoPrimario({
  aoClicar,
  ocupado,
  children,
}: {
  aoClicar: () => void;
  ocupado?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      disabled={ocupado}
      className="mt-5 flex items-center gap-1.5 rounded-full bg-zinc-900 px-4 py-2 text-[12px] font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
    >
      {children}
    </button>
  );
}
