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
// · O QR Code vive DENTRO do cartão da instância, não numa tela à parte. Com
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
//
// O REDESENHO (2026-10-08): o estado da instância virou o protagonista do
// cartão (ícone tingido + selo); quem envia por ela aparece como gente, com
// avatar, numa faixa própria; e o painel de conexão põe o QR ao lado dos
// passos de como escaneá-lo, em vez de um bloco de texto embaixo.
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  Check,
  CheckCircle2,
  Link2,
  Loader2,
  Pencil,
  PlugZap,
  Plus,
  QrCode,
  RefreshCw,
  Smartphone,
  Trash2,
  Webhook,
  X,
} from "lucide-react";
import type { InstanciaUazapi, UsuarioConfig } from "../dados";
import {
  consultarConexao,
  criarInstanciaNaUazapi,
  desconectarDoWhatsApp,
  gerarQrCode,
  removerInstancia,
  renomearInstancia,
  sincronizarWebhook,
  statusDasInstancias,
  vincularUsuarioInstancia,
  type ConexaoUazapi,
  type EstadoConexao,
} from "../actions";
import {
  botao,
  botaoFantasma,
  botaoSecundario,
  campoTexto,
  rotuloCampo,
  textoAjuda,
} from "./ui";
import {
  Atencao,
  Avatar,
  BotaoIcone,
  Cabecalho,
  Erro,
  formatarTelefone,
  Painel,
  PainelTopo,
} from "./pecas";

// De quanto em quanto tempo a tela pergunta à uazapi se já escanearam. 3s é o
// meio-termo: o QR expira em 2 minutos, então ~40 consultas por ciclo — e o
// usuário não fica olhando para um QR já escaneado.
const INTERVALO_CONSULTA = 3000;

// Rótulo e cores de cada estado. `hibernated` é sessão pausada com credencial
// viva: não é erro, mas também não é "pode enviar" — por isso âmbar.
const ESTADOS: Record<EstadoConexao, { rotulo: string; selo: string; icone: string; ponto: string }> = {
  connected: {
    rotulo: "Conectado",
    selo: "bg-emerald-50 text-emerald-700 ring-emerald-600/15 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-400/20",
    icone: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400",
    ponto: "bg-emerald-500",
  },
  connecting: {
    rotulo: "Aguardando leitura",
    selo: "bg-amber-50 text-amber-700 ring-amber-600/15 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-400/20",
    icone: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400",
    ponto: "bg-amber-500",
  },
  hibernated: {
    rotulo: "Hibernada",
    selo: "bg-amber-50 text-amber-700 ring-amber-600/15 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-400/20",
    icone: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400",
    ponto: "bg-amber-500",
  },
  disconnected: {
    rotulo: "Desconectado",
    selo: "bg-red-50 text-red-700 ring-red-600/15 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-400/20",
    icone: "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500",
    ponto: "bg-red-500",
  },
};

export function SecaoWhatsApp({ instancias, usuarios }: { instancias: InstanciaUazapi[]; usuarios: UsuarioConfig[] }) {
  // O estado de TODAS as instâncias numa chamada só (/instance/all com o admin
  // token). É o que permite pintar o estado de cada cartão assim que a tela
  // abre: uma consulta por instância deixaria a página fazendo N chamadas à
  // uazapi, e foi por isso que antes só havia estado depois de abrir o painel.
  //
  // Mapa vazio = não deu para saber (sem admin token, ou a uazapi fora). A
  // tela mostra o estado como desconhecido; nada quebra.
  const [status, setStatus] = useState<Record<string, EstadoConexao>>({});

  // Id da instância recém-criada. O cartão dela monta com o painel aberto e
  // pede o QR Code sozinho. Some depois de usado — reabrir a tela não deve
  // gerar QR de novo.
  const [novaId, setNovaId] = useState<string | null>(null);
  const [criando, setCriando] = useState(instancias.length === 0);
  // A pendência que a criação pode devolver (o webhook não ficou pronto, por
  // exemplo). Mora aqui, e não no formulário, porque o formulário fecha ao
  // criar — e o aviso precisa continuar à vista.
  const [avisoCriacao, setAvisoCriacao] = useState<string | null>(null);

  const recarregarStatus = useCallback(() => {
    statusDasInstancias()
      .then(setStatus)
      .catch(() => setStatus({}));
  }, []);

  useEffect(() => {
    let vivo = true;
    statusDasInstancias()
      .then((m) => vivo && setStatus(m))
      .catch(() => vivo && setStatus({}));
    return () => {
      vivo = false;
    };
  }, [instancias]);

  return (
    <section className="flex flex-col gap-6">
      <Cabecalho
        Icone={Smartphone}
        titulo="WhatsApp"
        contagem={instancias.length}
        descricao="Os números que o CRM usa para conversar. Cada instância da uazapi é um número, ligado à pessoa que envia por ele — pareie o celular pelo QR Code."
        acao={
          !criando && (
            <button
              type="button"
              onClick={() => {
                setAvisoCriacao(null);
                setCriando(true);
              }}
              className={botao}
            >
              <Plus className="size-4" aria-hidden="true" />
              Nova instância
            </button>
          )
        }
      />

      {criando && (
        <NovaInstancia
          usuarios={usuarios}
          aoFechar={instancias.length > 0 ? () => setCriando(false) : undefined}
          aoCriar={(id, aviso) => {
            setNovaId(id);
            setAvisoCriacao(aviso);
            setCriando(false);
          }}
        />
      )}

      {avisoCriacao && <Atencao>{avisoCriacao}</Atencao>}

      {instancias.length > 0 && (
        <ul className="flex flex-col gap-4">
          {instancias.map((i) => (
            <InstanciaCard
              key={i.id}
              instancia={i}
              usuarios={usuarios}
              estado={status[i.id] ?? null}
              aoMudarConexao={recarregarStatus}
              recemCriada={i.id === novaId}
            />
          ))}
        </ul>
      )}

      {/* O aviso mais caro desta tela. A arckwpp é compartilhada com o
          SprintHub, e é por isso que "desconectar do WhatsApp" e "remover do
          CRM" são botões diferentes, com textos diferentes. */}
      <Atencao>
        Parear um número aqui mexe na instância da uazapi de verdade. Se ela for
        compartilhada com outro sistema, trocar o WhatsApp dela derruba o número
        lá também.
      </Atencao>
    </section>
  );
}

// ── Nova instância ──────────────────────────────────────────────────────────
// Um formulário com nome e usuário. Eram dois — "criar na uazapi" e
// "cadastrar com URL e token" —, e os dois lado a lado faziam a tela perguntar
// algo que ela já sabe: a URL do servidor está no .env e o token quem devolve é
// a própria uazapi, ao criar.
//
// O botão leva direto ao QR: criar a instância e parear o celular são o mesmo
// pedido ("quero mais um número no CRM"), e separá-los em dois cliques deixava
// a instância recém-criada parada na lista, sem WhatsApp nenhum.
function NovaInstancia({
  usuarios,
  aoCriar,
  aoFechar,
}: {
  usuarios: UsuarioConfig[];
  aoCriar: (id: string, aviso: string | null) => void;
  aoFechar?: () => void;
}) {
  const [nome, setNome] = useState("");
  const [usuarioId, setUsuarioId] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [criando, iniciar] = useTransition();

  function criar() {
    const n = nome.trim();
    if (!n || !usuarioId || criando) return;
    setErro(null);
    iniciar(async () => {
      try {
        const { id, aviso } = await criarInstanciaNaUazapi(n, usuarioId);
        setNome("");
        setUsuarioId("");
        // Abre o cartão da instância nova já pedindo o QR Code — é o passo
        // seguinte inevitável, e quem acabou de clicar não deveria ter que
        // procurá-lo na lista.
        aoCriar(id, aviso);
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao criar instância");
      }
    });
  }

  const substitui = usuarios.find((u) => u.id === usuarioId)?.instancia_id;

  return (
    <Painel className="surge overflow-hidden">
      <PainelTopo
        titulo="Nova instância"
        descricao="Criamos a instância na uazapi, já com o webhook apontado para este CRM, e o QR Code abre no cartão dela em seguida."
        acao={
          aoFechar && (
            <BotaoIcone rotulo="Fechar" onClick={aoFechar}>
              <X className="size-4" aria-hidden="true" />
            </BotaoIcone>
          )
        }
      />
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className={rotuloCampo}>Nome da instância</span>
          <input
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && criar()}
            autoFocus
            placeholder="Ex.: Comercial"
            className={campoTexto}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className={rotuloCampo}>Quem envia por ela</span>
          <select
            value={usuarioId}
            onChange={(e) => setUsuarioId(e.target.value)}
            disabled={criando}
            className={campoTexto}
          >
            <option value="">Escolha o usuário responsável…</option>
            {usuarios.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nome}
              </option>
            ))}
          </select>
        </label>
        {usuarios.length === 0 && (
          <p className="text-[12px] text-amber-700 sm:col-span-2 dark:text-amber-400">
            Cadastre um usuário em Configurações · Usuários para vincular este WhatsApp.
          </p>
        )}
        {substitui && (
          <p className="text-[12px] text-amber-700 sm:col-span-2 dark:text-amber-400">
            Este usuário já envia por outro número. Ao criar, ele passa a enviar por esta instância.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-zinc-100 bg-zinc-50/60 px-5 py-3 dark:border-zinc-800/80 dark:bg-zinc-900/30">
        {/* Os três passos, para quem clica saber o que vem depois. */}
        <ol className="mr-auto flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-zinc-500 dark:text-zinc-400">
          {["Criar na uazapi", "Escanear o QR Code", "Pronto para enviar"].map((passo, i) => (
            <li key={passo} className="flex items-center gap-2">
              {i > 0 && <span className="h-px w-3 bg-zinc-300 dark:bg-zinc-700" aria-hidden="true" />}
              <span className="flex size-4 items-center justify-center rounded-full bg-zinc-200 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {i + 1}
              </span>
              {passo}
            </li>
          ))}
        </ol>
        {aoFechar && (
          <button type="button" onClick={aoFechar} className={botaoFantasma}>
            Cancelar
          </button>
        )}
        <button
          type="button"
          onClick={criar}
          disabled={!nome.trim() || !usuarioId || criando}
          className={botao}
        >
          {criando ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <QrCode className="size-4" aria-hidden="true" />
          )}
          {criando ? "Criando…" : "Criar e gerar QR Code"}
        </button>
      </div>
      {erro && (
        <div className="px-5 pb-4">
          <Erro>{erro}</Erro>
        </div>
      )}
    </Painel>
  );
}

// ── Uma instância ───────────────────────────────────────────────────────────
function InstanciaCard({
  instancia,
  usuarios,
  /** Estado vindo de /instance/all. `null` = ainda não sei. */
  estado,
  aoMudarConexao,
  /** Criada agora, nesta tela: abre já pedindo o QR Code. */
  recemCriada = false,
}: {
  instancia: InstanciaUazapi;
  usuarios: UsuarioConfig[];
  estado: EstadoConexao | null;
  aoMudarConexao: () => void;
  recemCriada?: boolean;
}) {
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(instancia.nome);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();

  // `null` = painel fechado. Abrir é o que dispara a primeira consulta; o
  // estado da conexão só é buscado quando alguém quer ver — a lista com cinco
  // instâncias não sai fazendo cinco chamadas à uazapi ao carregar a página.
  const [conexao, setConexao] = useState<ConexaoUazapi | null>(null);
  const [aberto, setAberto] = useState(recemCriada);

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
        `Remover "${instancia.nome}"? A instância é APAGADA na uazapi — o aparelho desconecta e o número some do servidor — e sai do CRM. Não tem volta. Os atendimentos já gravados continuam.`,
      )
    )
      return;
    setErro(null);
    iniciar(async () => {
      try {
        await removerInstancia(instancia.id);
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao remover a instância");
      }
    });
  }

  function vincular(usuarioId: string) {
    if (!usuarioId) return;
    setErro(null);
    iniciar(async () => {
      try {
        await vincularUsuarioInstancia(instancia.id, usuarioId);
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao vincular usuário");
      }
    });
  }

  // O que a tela exibe como número: o que a uazapi acabou de dizer, se o painel
  // já consultou; senão o que está gravado na nossa linha.
  const numero = formatarTelefone(conexao?.numero ?? instancia.numero);
  const estadoAtual = conexao?.estado ?? estado;
  const visual = estadoAtual ? (ESTADOS[estadoAtual] ?? ESTADOS.disconnected) : null;
  const vinculados = usuarios.filter((u) => u.instancia_id === instancia.id);
  const outros = usuarios.filter((u) => u.instancia_id !== instancia.id);
  let host = instancia.base_url;
  try {
    host = new URL(instancia.base_url).host;
  } catch {}

  return (
    <li>
      <Painel className="overflow-hidden">
        <div className="flex items-start gap-4 p-5">
          {/* O ícone tingido pelo estado + o ponto: "posso usar este número?"
              se responde de relance, varrendo a lista. */}
          <div className="relative shrink-0">
            <span
              className={`flex size-11 items-center justify-center rounded-xl ${
                visual?.icone ?? "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500"
              }`}
            >
              <Smartphone className="size-5" aria-hidden="true" />
            </span>
            <span
              className={`absolute -bottom-0.5 -right-0.5 size-3 rounded-full ring-2 ring-white dark:ring-zinc-950 ${
                visual?.ponto ?? "bg-zinc-300 dark:bg-zinc-600"
              }`}
              role="img"
              aria-label={visual?.rotulo ?? "Estado desconhecido"}
              title={visual?.rotulo ?? "Estado desconhecido"}
            />
          </div>

          <div className="min-w-0 flex-1">
            {editando ? (
              <div className="flex items-center gap-1.5">
                <input
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") salvar();
                    if (e.key === "Escape") cancelar();
                  }}
                  autoFocus
                  aria-label="Nome da instância"
                  className={`${campoTexto} h-8 max-w-xs`}
                />
                <BotaoIcone rotulo="Salvar" onClick={salvar} disabled={salvando || !nome.trim()}>
                  <Check className="size-4" aria-hidden="true" />
                </BotaoIcone>
                <BotaoIcone rotulo="Cancelar" onClick={cancelar}>
                  <X className="size-4" aria-hidden="true" />
                </BotaoIcone>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-[15px] font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                  {instancia.nome}
                </h2>
                {visual && (
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${visual.selo}`}
                  >
                    {visual.rotulo}
                  </span>
                )}
              </div>
            )}
            <p
              className={`mt-1 text-[13px] tabular-nums ${
                numero ? "text-zinc-700 dark:text-zinc-300" : "text-zinc-400 dark:text-zinc-500"
              }`}
            >
              {numero ?? "Nenhum número pareado"}
            </p>
            <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
              {host} · token {instancia.token_mascarado}
            </p>
          </div>

          {!editando && (
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => setAberto((v) => !v)}
                aria-expanded={aberto}
                className={`${botaoSecundario} h-8`}
              >
                {aberto ? (
                  <X className="size-3.5" aria-hidden="true" />
                ) : (
                  <QrCode className="size-3.5" aria-hidden="true" />
                )}
                {aberto ? "Fechar" : "Conexão"}
              </button>
              <BotaoIcone rotulo={`Renomear ${instancia.nome}`} onClick={() => setEditando(true)}>
                <Pencil className="size-3.5" aria-hidden="true" />
              </BotaoIcone>
              <BotaoIcone
                rotulo={`Remover ${instancia.nome} do CRM e da uazapi`}
                onClick={remover}
                disabled={salvando}
                perigo
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </BotaoIcone>
            </div>
          )}
        </div>

        {erro && (
          <div className="px-5 pb-4">
            <Erro>{erro}</Erro>
          </div>
        )}

        {/* Quem envia por este número — como gente, não como uma frase. */}
        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 bg-zinc-50/50 px-5 py-3 dark:border-zinc-800/80 dark:bg-zinc-900/20">
          <span className="text-[12px] font-medium text-zinc-500 dark:text-zinc-400">Envia por aqui</span>
          {vinculados.length === 0 ? (
            <span className="text-[12px] text-zinc-400 dark:text-zinc-500">ninguém ainda</span>
          ) : (
            vinculados.map((u) => (
              <span
                key={u.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white py-0.5 pl-0.5 pr-2.5 text-[12px] text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
              >
                <Avatar nome={u.nome} iniciais={u.iniciais} tamanho="sm" />
                {u.nome}
              </span>
            ))
          )}
          {outros.length > 0 && (
            <label className="relative ml-auto">
              <span className="sr-only">Vincular usuário a este WhatsApp</span>
              <Plus
                className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400"
                aria-hidden="true"
              />
              <select
                value=""
                disabled={salvando}
                onChange={(e) => vincular(e.target.value)}
                className="h-8 appearance-none rounded-lg border border-dashed border-zinc-300 bg-transparent pl-7 pr-3 text-[12px] font-medium text-zinc-600 outline-none transition hover:border-zinc-400 hover:text-zinc-900 focus-visible:ring-4 focus-visible:ring-zinc-900/5 dark:border-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-50"
              >
                <option value="">Vincular pessoa</option>
                {outros.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nome}
                    {u.instancia_id ? " (sai do número atual)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {aberto && (
          <PainelConexao
            instanciaId={instancia.id}
            nome={instancia.nome}
            gerarAoAbrir={recemCriada}
            conexao={conexao}
            aoMudar={(c) => {
              setConexao(c);
              // O estado da lista vem de outra consulta (/instance/all). Sem
              // este aviso, parear deixaria o painel dizendo "Conectado" e o
              // cartão ainda vermelho até alguém recarregar a página.
              aoMudarConexao();
            }}
          />
        )}
      </Painel>
    </li>
  );
}

// ── Painel de conexão: QR Code, código de pareamento e estado ───────────────
function PainelConexao({
  instanciaId,
  nome,
  conexao,
  aoMudar,
  /** Instância criada agora: em vez de só consultar, já pede o QR Code. */
  gerarAoAbrir = false,
}: {
  instanciaId: string;
  nome: string;
  conexao: ConexaoUazapi | null;
  aoMudar: (c: ConexaoUazapi | null) => void;
  gerarAoAbrir?: boolean;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // Vazio = QR Code; preenchido = código de pareamento para este número.
  const [telefone, setTelefone] = useState("");

  // `aoMudar` é o setState do pai — estável entre renders, então pode entrar
  // nas dependências sem reiniciar nada.
  // `pedirQr` é uma trava de uma vez só: a primeira consulta do painel de uma
  // instância recém-criada GERA o QR em vez de só perguntar o estado. Sem a
  // trava, o laço de 3 em 3 segundos pediria um QR novo a cada volta e o código
  // na tela mudaria debaixo da câmera de quem está tentando ler.
  const pedirQr = useRef(gerarAoAbrir);

  const consultar = useCallback(async () => {
    try {
      const primeira = pedirQr.current;
      pedirQr.current = false;
      const c = primeira
        ? await gerarQrCode(instanciaId)
        : await consultarConexao(instanciaId);
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

  // O webhook da instância: é ele que faz a resposta do cliente aparecer no
  // /chat. Quem cria a instância por aqui já nasce com ele apontado — mas sem
  // o número, que só existe depois de parear. Este botão fecha esse ciclo, e
  // recusa mexer quando o webhook é de outro sistema (ver sincronizarWebhook).
  const [webhook, setWebhook] = useState<string | null>(null);

  function sincronizar() {
    setOcupado(true);
    setWebhook(null);
    sincronizarWebhook(instanciaId)
      .then(setWebhook)
      .catch((e) =>
        setWebhook(e instanceof Error ? e.message : "Falha ao falar com a uazapi"),
      )
      .finally(() => setOcupado(false));
  }

  return (
    <div className="surge @container border-t border-zinc-100 px-5 py-5 dark:border-zinc-800/80">
      {conexao === null && !erro ? (
        <p className="flex items-center justify-center gap-2 py-8 text-[13px] text-zinc-400 dark:text-zinc-500">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Consultando a uazapi…
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Sem o selo do estado aqui: o cabeçalho do cartão já o mostra, e
              ele acompanha esta consulta (ver `estadoAtual`). */}
          <div className="flex flex-wrap items-center gap-2">
            {conexao?.perfil && (
              <span className="text-[13px] text-zinc-600 dark:text-zinc-300">
                <span className="text-zinc-400 dark:text-zinc-500">Perfil no WhatsApp: </span>
                {conexao.perfil}
              </span>
            )}
            <div className="ml-auto flex items-center gap-1">
              <button type="button" onClick={() => void consultar()} className={`${botaoFantasma} h-8 px-2.5 text-[12px]`}>
                <RefreshCw className="size-3.5" aria-hidden="true" />
                Atualizar
              </button>
              <button
                type="button"
                onClick={sincronizar}
                disabled={ocupado}
                title="Aponta o webhook desta instância para este CRM, com o número pareado"
                className={`${botaoFantasma} h-8 px-2.5 text-[12px]`}
              >
                <Webhook className="size-3.5" aria-hidden="true" />
                Webhook
              </button>
            </div>
          </div>

          {webhook && (
            <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-[12px] leading-relaxed text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
              {webhook}
            </p>
          )}

          {/* Conectado: nada de QR. O que resta é poder desligar. */}
          {conectado ? (
            <div className="flex flex-wrap items-center gap-4 rounded-xl border border-emerald-200/80 bg-emerald-50/60 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/20">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
                <CheckCircle2 className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium tabular-nums text-emerald-950 dark:text-emerald-100">
                  Pareado com {formatarTelefone(conexao?.numero) ?? "número não informado"}
                </p>
                <p className="text-[12px] text-emerald-800/80 dark:text-emerald-300/80">
                  Este é o número que sai nos envios do CRM.
                </p>
              </div>
              <button
                type="button"
                onClick={desconectar}
                disabled={ocupado}
                className={`${botaoSecundario} hover:border-red-200 hover:bg-red-50 hover:text-red-600 dark:hover:border-red-900 dark:hover:bg-red-950/40 dark:hover:text-red-400`}
              >
                <PlugZap className="size-4" aria-hidden="true" />
                Desconectar
              </button>
            </div>
          ) : (
            <div className="grid gap-6 @2xl:grid-cols-[auto_1fr]">
              {/* O QR (ou o código), num quadro branco fixo: ele vem com fundo
                  transparente e some no tema escuro se o quadro decidir a cor
                  por ele. <img> cru de propósito: é um data: URI gerado agora,
                  que o next/image não otimiza. */}
              <div className="flex justify-center">
                {conexao?.paircode ? (
                  <div className="flex size-56 flex-col items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white p-4 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                    <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                      Código de pareamento
                    </span>
                    <strong className="font-mono text-[26px] tracking-[0.18em] text-zinc-950 dark:text-zinc-50">
                      {conexao.paircode}
                    </strong>
                    <span className="text-[11px] text-zinc-400">vale 5 minutos</span>
                  </div>
                ) : conexao?.qrcode ? (
                  <div className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-700">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={conexao.qrcode}
                      alt={`QR Code para conectar o WhatsApp em ${nome}`}
                      className="size-52 rounded-lg bg-white"
                    />
                  </div>
                ) : (
                  <div className="flex size-56 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-zinc-300 text-center text-zinc-400 dark:border-zinc-700 dark:text-zinc-500">
                    <QrCode className="size-8" aria-hidden="true" />
                    <span className="max-w-[10rem] text-[12px]">Gere o QR Code para parear um celular</span>
                  </div>
                )}
              </div>

              <div className="flex min-w-0 flex-col gap-4">
                <ol className="flex flex-col gap-2.5">
                  {(conexao?.paircode
                    ? [
                        "Abra o WhatsApp no celular deste número.",
                        "Vá em Aparelhos conectados → Conectar um aparelho.",
                        "Toque em Conectar com número de telefone e digite o código.",
                      ]
                    : [
                        "Abra o WhatsApp no celular deste número.",
                        "Vá em Aparelhos conectados → Conectar um aparelho.",
                        "Aponte a câmera para o código ao lado.",
                      ]
                  ).map((passo, i) => (
                    <li key={passo} className="flex items-start gap-2.5 text-[13px] text-zinc-700 dark:text-zinc-300">
                      <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[11px] font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900">
                        {i + 1}
                      </span>
                      {passo}
                    </li>
                  ))}
                </ol>
                {conexao?.qrcode && !conexao.paircode && (
                  <p className={textoAjuda}>
                    O código vale 2 minutos e se renova sozinho enquanto este cartão estiver aberto.
                  </p>
                )}

                {/* Alternativa ao QR, quando escanear não é prático. */}
                <div className="mt-auto flex flex-col gap-1.5 border-t border-zinc-100 pt-4 dark:border-zinc-800/80">
                  <label htmlFor={`tel-${instanciaId}`} className={rotuloCampo}>
                    Sem câmera? Receba um código de 8 dígitos
                  </label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      id={`tel-${instanciaId}`}
                      type="text"
                      inputMode="numeric"
                      value={telefone}
                      onChange={(e) => setTelefone(e.target.value)}
                      placeholder="5547999999999 — com DDI e DDD"
                      className={`${campoTexto} tabular-nums`}
                    />
                    <button
                      type="button"
                      onClick={() => void acao(() => gerarQrCode(instanciaId, telefone))}
                      disabled={ocupado}
                      className={botao}
                    >
                      {ocupado ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : telefone.trim() ? (
                        <Link2 className="size-4" aria-hidden="true" />
                      ) : (
                        <QrCode className="size-4" aria-hidden="true" />
                      )}
                      {telefone.trim() ? "Gerar código" : "Gerar QR Code"}
                    </button>
                  </div>
                  <p className={textoAjuda}>Em branco, gera um QR Code novo.</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {erro && (
        <div className="mt-3">
          <Erro>{erro}</Erro>
        </div>
      )}
    </div>
  );
}
