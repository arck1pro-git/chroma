"use client";

// Link com a uazapi: cadastrar instância, parear o número pelo QR Code e
// acompanhar a conexão.
//
// O DESENHO DESTA TELA, e por quê:
//
// · CADASTRAR e PAREAR são dois passos, não um. Cadastrar é dizer ao CRM
//   "existe uma instância nesta URL, com este token". Parear é pendurar um
//   WhatsApp nela. Uma instância pode já vir pareada do painel da uazapi — é o
//   caso da arckwpp —, e nessa não há QR nenhum a mostrar.
//
// · O QR Code vive DENTRO da linha da instância, não numa tela à parte. Com
//   mais de um número cadastrado, um QR solto no topo não diria de quem é — e
//   escanear o QR errado conecta o celular errado.
//
// · Enquanto o QR está na tela, a instância é consultada de 3 em 3 segundos
//   (ver `useEffect` em PainelConexao). É a uazapi que sabe quando o celular
//   escaneou; não existe evento vindo até nós. O laço PARA sozinho ao conectar,
//   ao fechar o painel e ao desmontar.
//
// · O token não passa por aqui em nenhum momento. As actions recebem o id da
//   linha e buscam a credencial no servidor (ver ../actions.ts).
import { useCallback, useEffect, useState, useTransition } from "react";
import {
  Check,
  Link2,
  Loader2,
  Pencil,
  Plug,
  PlugZap,
  QrCode,
  RefreshCw,
  Smartphone,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import type { InstanciaUazapi } from "../dados";
import {
  conectarInstancia,
  consultarConexao,
  desconectarDoWhatsApp,
  gerarQrCode,
  removerInstancia,
  renomearInstancia,
  type ConexaoUazapi,
  type EstadoConexao,
} from "../actions";
import { botao, campoTexto } from "./ui";

// De quanto em quanto tempo a tela pergunta à uazapi se já escanearam. 3s é o
// meio-termo: o QR expira em 2 minutos, então ~40 consultas por ciclo — e o
// usuário não fica olhando para um QR já escaneado.
const INTERVALO_CONSULTA = 3000;

// Rótulo e cor de cada estado. `hibernated` é sessão pausada com credencial
// viva: não é erro, mas também não é "pode enviar" — por isso âmbar.
const ESTADOS: Record<EstadoConexao, { rotulo: string; classe: string }> = {
  connected: {
    rotulo: "Conectado",
    classe:
      "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400",
  },
  connecting: {
    rotulo: "Aguardando leitura",
    classe: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400",
  },
  hibernated: {
    rotulo: "Hibernada",
    classe: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400",
  },
  disconnected: {
    rotulo: "Desconectado",
    classe: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  },
};

export function SecaoWhatsApp({ instancias }: { instancias: InstanciaUazapi[] }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">
          <Smartphone className="size-3.5 text-zinc-400" aria-hidden="true" />
          WhatsApp (uazapi)
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Os números que o CRM usa para enviar e receber. Cadastre a instância
          com a URL e o token da uazapi; depois pareie o celular pelo QR Code.
        </p>
      </div>

      <NovaInstancia />

      {instancias.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300 px-4 py-10 text-center text-[13px] text-zinc-400 dark:border-zinc-700">
          Nenhuma instância conectada ainda. Cadastre a primeira acima.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {instancias.map((i) => (
            <InstanciaCard key={i.id} instancia={i} />
          ))}
        </ul>
      )}

      {/* O aviso mais caro desta tela. A arckwpp é compartilhada com o
          SprintHub, e é por isso que "desconectar do WhatsApp" e "remover do
          CRM" são botões diferentes, com textos diferentes. */}
      <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2.5 text-[11px] leading-relaxed text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
        <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        <span>
          Parear um número aqui mexe na instância da uazapi de verdade. Se ela
          for compartilhada com outro sistema, trocar o WhatsApp dela derruba o
          número lá também.
        </span>
      </p>
    </section>
  );
}

// ── Cadastro ────────────────────────────────────────────────────────────────
// A credencial é testada contra a própria uazapi antes de gravar (GET
// /instance/status, em ../actions.ts) — token errado não entra na tabela.
function NovaInstancia() {
  const [nome, setNome] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [conectando, iniciar] = useTransition();

  function conectar() {
    if (!nome.trim() || !baseUrl.trim() || !token.trim()) return;
    setErro(null);
    iniciar(async () => {
      try {
        await conectarInstancia(nome, baseUrl, token);
        setNome("");
        setBaseUrl("");
        setToken("");
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao conectar instância");
      }
    });
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            Nome
          </span>
          <input
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && conectar()}
            placeholder="Ex.: Comercial"
            className={campoTexto}
          />
        </label>
        <label className="flex min-w-0 flex-[1.4] flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            URL da instância
          </span>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && conectar()}
            placeholder="https://sua-instancia.uazapi.com"
            className={campoTexto}
          />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            Token
          </span>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && conectar()}
            placeholder="Token da instância"
            className={campoTexto}
          />
        </label>
        <button
          type="button"
          onClick={conectar}
          disabled={!nome.trim() || !baseUrl.trim() || !token.trim() || conectando}
          className={botao}
        >
          <Plug className="size-4" aria-hidden="true" />
          {conectando ? "Conectando…" : "Cadastrar"}
        </button>
      </div>
      {erro && <p className="mt-2 text-xs text-red-500">{erro}</p>}
      <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">
        A URL e o token vêm do painel da uazapi. O token é conferido contra a
        instância antes de ser gravado e nunca volta inteiro para esta tela.
      </p>
    </div>
  );
}

// ── Uma instância ───────────────────────────────────────────────────────────
function InstanciaCard({ instancia }: { instancia: InstanciaUazapi }) {
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(instancia.nome);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();

  // `null` = painel fechado. Abrir é o que dispara a primeira consulta; o
  // estado da conexão só é buscado quando alguém quer ver — a lista com cinco
  // instâncias não sai fazendo cinco chamadas à uazapi ao carregar a página.
  const [conexao, setConexao] = useState<ConexaoUazapi | null>(null);
  const [aberto, setAberto] = useState(false);

  function salvar() {
    const n = nome.trim();
    if (!n) return;
    setErro(null);
    iniciar(async () => {
      try {
        await renomearInstancia(instancia.id, n);
        setEditando(false);
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao renomear");
      }
    });
  }

  function cancelar() {
    setNome(instancia.nome);
    setErro(null);
    setEditando(false);
  }

  function remover() {
    if (
      !window.confirm(
        `Remover "${instancia.nome}" do CRM? A instância continua existindo na uazapi e o WhatsApp segue pareado — só o CRM deixa de conhecer esse número. Os atendimentos já gravados continuam.`,
      )
    )
      return;
    iniciar(() => {
      removerInstancia(instancia.id);
    });
  }

  // O que a tela exibe como número: o que a uazapi acabou de dizer, se o painel
  // já consultou; senão o que está gravado na nossa linha.
  const numero = conexao?.numero ?? instancia.numero;

  return (
    <li className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
          <Smartphone className="size-4" aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          {editando ? (
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") salvar();
                if (e.key === "Escape") cancelar();
              }}
              autoFocus
              aria-label="Nome da instância"
              className={`${campoTexto} py-1`}
            />
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50">
                {instancia.nome}
              </p>
              {conexao && <Selo estado={conexao.estado} />}
            </div>
          )}
          <p className="truncate text-[11px] text-zinc-400 dark:text-zinc-500">
            {numero ?? "sem número pareado"} · {instancia.token_mascarado} ·{" "}
            {instancia.base_url}
          </p>
        </div>

        {editando ? (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={salvar}
              disabled={salvando}
              aria-label="Salvar"
              className="text-zinc-400 transition hover:text-emerald-600"
            >
              <Check className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={cancelar}
              aria-label="Cancelar"
              className="text-zinc-400 transition hover:text-zinc-900 dark:hover:text-zinc-50"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setAberto((v) => !v)}
              aria-expanded={aberto}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-[12px] font-medium text-zinc-600 transition hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
            >
              <Link2 className="size-3.5" aria-hidden="true" />
              {aberto ? "Fechar" : "Conexão"}
            </button>
            <button
              type="button"
              onClick={() => setEditando(true)}
              aria-label={`Renomear ${instancia.nome}`}
              className="p-1 text-zinc-400 transition hover:text-zinc-900 dark:hover:text-zinc-50"
            >
              <Pencil className="size-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={remover}
              disabled={salvando}
              aria-label={`Remover ${instancia.nome} do CRM`}
              className="p-1 text-zinc-400 transition hover:text-red-500"
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {erro && <p className="mt-2 text-xs text-red-500">{erro}</p>}

      {aberto && (
        <PainelConexao
          instanciaId={instancia.id}
          nome={instancia.nome}
          conexao={conexao}
          aoMudar={setConexao}
        />
      )}
    </li>
  );
}

function Selo({ estado }: { estado: EstadoConexao }) {
  const { rotulo, classe } = ESTADOS[estado] ?? ESTADOS.disconnected;
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${classe}`}
    >
      {rotulo}
    </span>
  );
}

// ── Painel de conexão: QR Code, código de pareamento e estado ───────────────
function PainelConexao({
  instanciaId,
  nome,
  conexao,
  aoMudar,
}: {
  instanciaId: string;
  nome: string;
  conexao: ConexaoUazapi | null;
  aoMudar: (c: ConexaoUazapi | null) => void;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // Vazio = QR Code; preenchido = código de pareamento para este número.
  const [telefone, setTelefone] = useState("");

  // `aoMudar` é o setState do pai — estável entre renders, então pode entrar
  // nas dependências sem reiniciar nada.
  const consultar = useCallback(async () => {
    try {
      const c = await consultarConexao(instanciaId);
      aoMudar(c);
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao consultar a uazapi");
    }
  }, [instanciaId, aoMudar]);

  // Um efeito só, com duas funções:
  //
  // 1. consultar ao abrir o painel — é essa consulta que diz se há QR a pedir
  //    ou se o número já está pareado;
  // 2. repetir enquanto o estado for "connecting", que é exatamente a janela
  //    em que o QR está na tela esperando o celular.
  //
  // Conectou, o laço para (o efeito reroda sem `conectando` e não agenda
  // intervalo). Fechou o painel ou trocou de instância, o cleanup limpa. A
  // trava `vivo` existe porque a consulta é assíncrona: sem ela, a resposta de
  // uma instância antiga pinta o painel de outra.
  const conectando = conexao?.estado === "connecting";
  useEffect(() => {
    let vivo = true;
    const consultarSeVivo = () => {
      if (vivo) void consultar();
    };

    consultarSeVivo();
    if (!conectando) {
      return () => {
        vivo = false;
      };
    }

    const id = setInterval(consultarSeVivo, INTERVALO_CONSULTA);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, [conectando, consultar]);

  async function acao(fn: () => Promise<ConexaoUazapi>) {
    setOcupado(true);
    setErro(null);
    try {
      aoMudar(await fn());
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao falar com a uazapi");
    } finally {
      setOcupado(false);
    }
  }

  function desconectar() {
    if (
      !window.confirm(
        `Desconectar o WhatsApp de "${nome}"? Isto acontece NA UAZAPI: o aparelho sai de "Aparelhos conectados" no celular e reconectar exige um QR Code novo. Se esta instância for compartilhada com outro sistema, o número cai lá também.`,
      )
    )
      return;
    void acao(() => desconectarDoWhatsApp(instanciaId));
  }

  const conectado = conexao?.estado === "connected";

  return (
    <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800/70">
      {conexao === null && !erro ? (
        <p className="flex items-center gap-2 py-2 text-[12px] text-zinc-400 dark:text-zinc-500">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          Consultando a uazapi…
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {conexao && <Selo estado={conexao.estado} />}
            {conexao?.perfil && (
              <span className="text-[12px] text-zinc-500 dark:text-zinc-400">
                {conexao.perfil}
              </span>
            )}
            <button
              type="button"
              onClick={() => void consultar()}
              className="ml-auto inline-flex items-center gap-1.5 text-[12px] text-zinc-400 transition hover:text-zinc-900 dark:hover:text-zinc-50"
            >
              <RefreshCw className="size-3" aria-hidden="true" />
              Atualizar
            </button>
          </div>

          {/* Conectado: nada de QR. O que resta é poder desligar. */}
          {conectado ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="flex-1 text-[12px] text-zinc-500 dark:text-zinc-400">
                Pareado com{" "}
                <strong className="font-medium text-zinc-900 dark:text-zinc-50">
                  {conexao?.numero ?? "número não informado"}
                </strong>
                . Este é o número que sai nos envios do CRM.
              </p>
              <button
                type="button"
                onClick={desconectar}
                disabled={ocupado}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-2 text-[13px] font-medium text-zinc-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:pointer-events-none disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-red-900 dark:hover:bg-red-950/40 dark:hover:text-red-400"
              >
                <PlugZap className="size-4" aria-hidden="true" />
                Desconectar WhatsApp
              </button>
            </div>
          ) : (
            <>
              {/* O QR propriamente dito. `unoptimized`/<img> cru de propósito:
                  é um data: URI gerado agora, que o next/image não otimiza. */}
              {conexao?.qrcode && (
                <div className="flex flex-col items-center gap-2 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={conexao.qrcode}
                    alt={`QR Code para conectar o WhatsApp em ${nome}`}
                    // Fundo branco fixo: o QR vem com fundo transparente e
                    // some no tema escuro se o card decidir a cor por ele.
                    className="size-56 rounded-lg bg-white p-2"
                  />
                  <p className="max-w-xs text-center text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                    No celular: WhatsApp → Aparelhos conectados → Conectar um
                    aparelho. O código vale 2 minutos e se renova sozinho
                    enquanto esta tela estiver aberta.
                  </p>
                </div>
              )}

              {/* Alternativa ao QR, quando escanear não é prático. */}
              {conexao?.paircode && (
                <div className="flex flex-col items-center gap-1 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                  <span className="text-[11px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                    Código de pareamento
                  </span>
                  <strong className="font-mono text-2xl tracking-[0.2em] text-zinc-900 dark:text-zinc-50">
                    {conexao.paircode}
                  </strong>
                  <p className="max-w-xs text-center text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                    No celular: Aparelhos conectados → Conectar com número de
                    telefone. Vale 5 minutos.
                  </p>
                </div>
              )}

              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <label className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                    Número (opcional)
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={telefone}
                    onChange={(e) => setTelefone(e.target.value)}
                    placeholder="5547999999999 — com DDI e DDD"
                    className={campoTexto}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void acao(() => gerarQrCode(instanciaId, telefone))}
                  disabled={ocupado}
                  className={botao}
                >
                  {ocupado ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <QrCode className="size-4" aria-hidden="true" />
                  )}
                  {telefone.trim() ? "Gerar código" : "Gerar QR Code"}
                </button>
              </div>
              <p className="text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">
                Deixe o número em branco para parear escaneando o QR Code.
                Preencha para receber um código de 8 dígitos em vez disso — útil
                quando não dá para apontar a câmera para esta tela.
              </p>
            </>
          )}
        </div>
      )}

      {erro && <p className="mt-2 text-xs text-red-500">{erro}</p>}
    </div>
  );
}
