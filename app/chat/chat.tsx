"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ComponentType,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Camera,
  Check,
  CheckCheck,
  Clock,
  Download,
  FileText,
  Inbox,
  Loader2,
  Mail,
  MapPin,
  MessageCircle,
  Plus,
  Search,
  SendHorizonal,
  Smartphone,
  TriangleAlert,
  UserPlus,
  Wallet,
  X,
} from "lucide-react";
import {
  type Atendimento,
  type Contato,
  type Etapa,
  type Funil,
  type Mensagem,
  type Oportunidade,
  type Usuario,
} from "../data";
import type { DadosChat } from "./dados";
import { SeletorMenu } from "../components/filtros-ui";
import {
  assumirAtendimento,
  criarOportunidade,
  encerrarAtendimento,
  enviarMensagem,
  iniciarAtendimento,
  marcarLido,
  reabrirAtendimento,
} from "./actions";
import { supabase } from "@/lib/supabase";
import { brl, horaCurta } from "../formato";

type Aba = "meus" | "fila" | "encerrados";

const CANAL: Record<
  Atendimento["canal"],
  { rotulo: string; Icone: ComponentType<{ className?: string }> }
> = {
  whatsapp: { rotulo: "WhatsApp", Icone: MessageCircle },
  whatsapp_oficial: { rotulo: "WhatsApp API", Icone: MessageCircle },
  instagram: { rotulo: "Instagram", Icone: Camera },
  email: { rotulo: "E-mail", Icone: Mail },
};

// Iniciais do contato: contatos não têm coluna de iniciais como usuarios, então
// derivo do nome — primeira letra das duas primeiras palavras.
function iniciais(nome: string) {
  const partes = nome.trim().split(/\s+/);
  return ((partes[0]?.[0] ?? "") + (partes[1]?.[0] ?? "")).toUpperCase();
}

export default function Chat({
  dados,
  atendimentoInicial,
}: {
  dados: DadosChat;
  // ?atendimento=<id> na URL (a ficha da oportunidade linka pra cá). Resolvido
  // no servidor e entregue como prop — mesmo padrão do ?op= da tela inicial.
  atendimentoInicial: string | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Dados vêm do servidor (Neon) via props. As mutações chamam server actions
  // que fazem revalidatePath('/chat') — o React recomita a árvore com as props
  // novas, então NÃO espelho a lista em useState (fonte única = props).
  const { atendimentos, usuarios, contatos, funis, etapas, instancias } = dados;

  // Sem auth ainda: o "usuário logado" é o primeiro cadastrado (ou ninguém).
  // Vira a sessão de verdade quando auth existir.
  const usuarioAtual = usuarios[0]?.id ?? null;

  const contatoPorId = useMemo(
    () => new Map(contatos.map((c) => [c.id, c])),
    [contatos],
  );
  const usuarioPorId = useMemo(
    () => new Map(usuarios.map((u) => [u.id, u])),
    [usuarios],
  );
  const etapaPorId = useMemo(
    () => new Map(etapas.map((e) => [e.id, e])),
    [etapas],
  );
  const funilPorId = useMemo(
    () => new Map(funis.map((f) => [f.id, f])),
    [funis],
  );

  // Otimistas: mensagens que acabei de mandar e ainda não voltaram do servidor.
  // Some quando o revalidate traz a linha real (casada pelo id temporário).
  const [otimistas, setOtimistas] = useState<Mensagem[]>([]);
  const mensagens = useMemo(
    () => [...dados.mensagens, ...otimistas],
    [dados.mensagens, otimistas],
  );

  // Chegando por ?atendimento=, abre já na aba certa pro item aparecer
  // destacado na lista — senão a mensagem some com a conversa certa mas a
  // barra lateral não mostra nada selecionado.
  // "" = todos os canais. Valor é o NÚMERO (numero_instancia), não o id da
  // instância — é por número que atendimentos casa (várias instâncias sem
  // numero, por ainda não terem WhatsApp pareado, não entram na lista).
  const [canal, setCanal] = useState("");
  const opcoesCanal = useMemo(
    () => [
      { valor: "", rotulo: "Todos os canais" },
      ...instancias
        .filter((i): i is typeof i & { numero: string } => i.numero !== null)
        .map((i) => ({ valor: i.numero, rotulo: i.nome })),
    ],
    [instancias],
  );

  const [aba, setAba] = useState<Aba>(() => {
    const alvo = atendimentoInicial
      ? atendimentos.find((a) => a.id === atendimentoInicial)
      : undefined;
    if (!alvo) return "meus";
    if (alvo.status === "na_fila") return "fila";
    if (alvo.status === "encerrado") return "encerrados";
    return "meus";
  });
  const [selecionadoId, setSelecionadoId] = useState<string | null>(
    () => atendimentoInicial,
  );

  // Tira o ?atendimento= da barra de endereços depois de usar, senão um F5
  // reabre a conversa que o usuário talvez já tenha trocado.
  useEffect(() => {
    if (!atendimentoInicial) return;
    window.history.replaceState(null, "", window.location.pathname);
  }, [atendimentoInicial]);
  const [novoAberto, setNovoAberto] = useState(false);

  // Realtime: em vez de polling, o Supabase avisa no instante em que uma linha de
  // mensagens/atendimentos muda (o webhook grava → Postgres Changes empurra pra
  // cá). Aí revalido a rota, que re-executa carregarChat no server. Zero timer.
  useEffect(() => {
    const canal = supabase
      .channel("chat-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "mensagens" },
        () => startTransition(() => router.refresh()),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "atendimentos" },
        () => startTransition(() => router.refresh()),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(canal);
    };
  }, [router]);

  // Assim que o servidor confirma o envio, a mensagem real entra em dados; limpo
  // os otimistas cujo texto+atendimento já apareceu na lista real.
  useEffect(() => {
    if (otimistas.length === 0) return;
    setOtimistas((atuais) =>
      atuais.filter(
        (o) =>
          !dados.mensagens.some(
            (m) =>
              m.atendimento_id === o.atendimento_id &&
              m.origem === "agente" &&
              m.texto === o.texto,
          ),
      ),
    );
  }, [dados.mensagens]); // eslint-disable-line react-hooks/exhaustive-deps

  // Última mensagem de cada conversa, para a prévia e a ordenação da lista.
  const ultimaPorId = useMemo(() => {
    const mapa = new Map<string, Mensagem>();
    for (const m of mensagens) {
      const atual = mapa.get(m.atendimento_id);
      if (!atual || m.data_criacao > atual.data_criacao) {
        mapa.set(m.atendimento_id, m);
      }
    }
    return mapa;
  }, [mensagens]);

  // Canal é ortogonal à aba: filtra em cima do que a aba já decidiu, não troca
  // o critério dela. "" (todos) não descarta nem quem não tem numero_instancia
  // (email/instagram, ou whatsapp de antes desta coluna existir).
  const passaCanal = useCallback(
    (a: Atendimento) => !canal || a.numero_instancia === canal,
    [canal],
  );

  // Conversas da aba, mais recentes no topo (pela última mensagem, com a data de
  // criação como desempate para conversa ainda sem mensagem).
  const daAba = useMemo(() => {
    const filtro = (a: Atendimento) => {
      if (!passaCanal(a)) return false;
      if (aba === "meus")
        return a.responsavel_id === usuarioAtual && a.status === "aberto";
      if (aba === "fila") return a.status === "na_fila";
      return a.status === "encerrado";
    };
    const quando = (a: Atendimento) =>
      ultimaPorId.get(a.id)?.data_criacao ?? a.data_criacao;
    return atendimentos
      .filter(filtro)
      .sort((a, b) => quando(b).localeCompare(quando(a)));
  }, [atendimentos, aba, ultimaPorId, usuarioAtual, passaCanal]);

  // Contagem das abas também respeita o canal — senão o número do badge some
  // com o motivo de a lista logo abaixo estar vazia.
  const contagem = useMemo(
    () => ({
      meus: atendimentos.filter(
        (a) => passaCanal(a) && a.responsavel_id === usuarioAtual && a.status === "aberto",
      ).length,
      fila: atendimentos.filter((a) => passaCanal(a) && a.status === "na_fila").length,
      encerrados: atendimentos.filter((a) => passaCanal(a) && a.status === "encerrado")
        .length,
    }),
    [atendimentos, usuarioAtual, passaCanal],
  );

  const selecionado = useMemo(
    () => atendimentos.find((a) => a.id === selecionadoId) ?? null,
    [atendimentos, selecionadoId],
  );

  const daConversa = useMemo(
    () =>
      mensagens
        .filter((m) => m.atendimento_id === selecionadoId)
        .sort((a, b) => a.data_criacao.localeCompare(b.data_criacao)),
    [mensagens, selecionadoId],
  );

  // Abrir zera as não lidas no banco (abriu, leu) e seleciona.
  const abrir = useCallback(
    (id: string) => {
      setSelecionadoId(id);
      startTransition(() => marcarLido(id));
    },
    [startTransition],
  );

  const assumir = useCallback(
    (id: string) => {
      setAba("meus");
      startTransition(() => assumirAtendimento(id, usuarioAtual));
    },
    [usuarioAtual, startTransition],
  );

  const encerrar = useCallback(
    (id: string) => {
      setAba("encerrados");
      startTransition(() => encerrarAtendimento(id));
    },
    [startTransition],
  );

  const reabrir = useCallback(
    (id: string) => {
      setAba("meus");
      startTransition(() => reabrirAtendimento(id, usuarioAtual));
    },
    [usuarioAtual, startTransition],
  );

  const enviar = useCallback(
    (texto: string) => {
      const corpo = texto.trim();
      if (!corpo || !selecionado) return;

      // Otimista: mostra o balão 'pendente' na hora (com o relógio). A linha real
      // — com status 'enviado'/'erro' e id_externo — chega pelo revalidate do
      // server action, e este otimista some (casado por atendimento+texto no
      // efeito de limpeza lá em cima).
      const otimista: Mensagem = {
        id: `tmp-${Date.now()}`,
        atendimento_id: selecionado.id,
        origem: "agente",
        autor_id: usuarioAtual,
        texto: corpo,
        status: "pendente",
        id_externo: null,
        data_criacao: new Date().toISOString(),
        // O que se digita no CRM é sempre texto: anexar arquivo daqui ainda
        // não existe (só recebemos mídia, ver lib/midia.ts).
        tipo: "texto",
        midia_estado: "ausente",
        midia_mime: null,
        midia_nome: null,
        midia_tamanho: null,
        midia_duracao: null,
        midia_erro: null,
      };
      setOtimistas((atuais) => [...atuais, otimista]);

      // Responder um da fila/encerrado assume a conversa; o action grava
      // 'pendente' no Neon ANTES de disparar pela uazapi e casa o retorno.
      if (selecionado.status !== "aberto") setAba("meus");

      startTransition(async () => {
        try {
          await enviarMensagem(selecionado.id, usuarioAtual, corpo);
        } catch {
          // O action já marcou a linha como 'erro' no banco; o revalidate a traz.
          setOtimistas((atuais) => atuais.filter((o) => o.id !== otimista.id));
        }
      });
    },
    [selecionado, usuarioAtual, startTransition],
  );

  const iniciarComContato = useCallback(
    (contatoId: string) => {
      setNovoAberto(false);
      // O action reusa a conversa não-encerrada se já houver (não duplica),
      // senão cria; devolve o id pra selecionar.
      startTransition(async () => {
        const id = await iniciarAtendimento(contatoId, usuarioAtual);
        setSelecionadoId(id);
        setAba("meus");
      });
    },
    [usuarioAtual, startTransition],
  );

  return (
    <div className="flex h-screen overflow-hidden bg-conteudo">
      {/* Lista. No estreito, some quando há conversa aberta (dá a tela toda pro
          thread) e volta com a seta de voltar. */}
      <section
        className={`w-full flex-col border-r border-zinc-200 lg:flex lg:w-80 lg:shrink-0 dark:border-zinc-800 ${
          selecionado ? "hidden lg:flex" : "flex"
        }`}
      >
        <header className="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h1 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Chat
          </h1>
          <button
            type="button"
            onClick={() => setNovoAberto(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-2.5 py-1.5 text-[12px] font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Novo
          </button>
        </header>

        <div className="flex items-center gap-1 border-b border-zinc-200 px-2 py-2 dark:border-zinc-800">
          <TabBotao rotulo="Meus" contagem={contagem.meus} ativo={aba === "meus"} aoClicar={() => setAba("meus")} />
          <TabBotao rotulo="Fila" contagem={contagem.fila} ativo={aba === "fila"} aoClicar={() => setAba("fila")} destaque />
          <TabBotao rotulo="Encerrados" contagem={contagem.encerrados} ativo={aba === "encerrados"} aoClicar={() => setAba("encerrados")} />
        </div>

        {/* Só aparece com alguma instância conectada (Configurações) — com
            zero, é um seletor de uma opção só ("Todos os canais") sem função. */}
        {opcoesCanal.length > 1 && (
          <div className="border-b border-zinc-200 px-2 py-2 dark:border-zinc-800">
            <SeletorMenu
              Icone={Smartphone}
              rotulo="Canal"
              valor={canal}
              opcoes={opcoesCanal}
              aoMudar={setCanal}
              botao="w-full"
              ativo={canal !== ""}
            />
          </div>
        )}

        <ul className="min-h-0 flex-1 overflow-y-auto">
          {daAba.length === 0 ? (
            <li className="flex flex-col items-center gap-2 px-6 py-16 text-center">
              <Inbox className="size-7 text-zinc-300 dark:text-zinc-700" aria-hidden="true" />
              <p className="text-[13px] font-medium text-zinc-900 dark:text-zinc-50">
                {aba === "fila" ? "Fila vazia" : aba === "meus" ? "Nenhum atendimento seu" : "Nada encerrado"}
              </p>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                {aba === "meus"
                  ? "Assuma um da fila ou inicie um novo."
                  : aba === "fila"
                    ? "Toda mensagem nova sem dono cai aqui."
                    : "Atendimentos encerrados aparecem aqui."}
              </p>
            </li>
          ) : (
            daAba.map((a) => {
              const contato = contatoPorId.get(a.contato_id);
              const ultima = ultimaPorId.get(a.id);
              const { Icone: IconeCanal } = CANAL[a.canal];
              const aberto = a.id === selecionadoId;
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => abrir(a.id)}
                    aria-current={aberto ? "true" : undefined}
                    className={`flex w-full items-center gap-3 border-b border-zinc-100 px-4 py-3 text-left transition dark:border-zinc-900 ${
                      aberto
                        ? "bg-zinc-100 dark:bg-zinc-900"
                        : "hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                    }`}
                  >
                    <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-[11px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                      {iniciais(contato?.nome ?? "?")}
                      <span className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-white ring-1 ring-zinc-200 dark:bg-zinc-950 dark:ring-zinc-800">
                        <IconeCanal className="size-2.5 text-zinc-500 dark:text-zinc-400" />
                      </span>
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50">
                          {contato?.nome ?? "Contato removido"}
                        </span>
                        {ultima && (
                          <span className="shrink-0 text-[10px] tabular-nums text-zinc-400 dark:text-zinc-500">
                            {horaCurta(ultima.data_criacao)}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 flex items-center justify-between gap-2">
                        <span className="truncate text-[12px] text-zinc-500 dark:text-zinc-400">
                          {ultima
                            ? (ultima.origem === "agente" ? "Você: " : "") +
                              previaDaMensagem(ultima)
                            : "Sem mensagens ainda"}
                        </span>
                        {a.nao_lidas > 0 && (
                          <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-semibold tabular-nums text-white">
                            {a.nao_lidas}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </section>

      {/* Thread */}
      <section
        className={`min-w-0 flex-1 flex-col bg-conteudo lg:flex ${
          selecionado ? "flex" : "hidden lg:flex"
        }`}
      >
        {selecionado ? (
          <Conversa
            atendimento={selecionado}
            contato={contatoPorId.get(selecionado.contato_id)}
            usuarioPorId={usuarioPorId}
            usuarios={usuarios}
            funis={funis}
            etapas={etapas}
            etapaPorId={etapaPorId}
            funilPorId={funilPorId}
            oportunidades={
              dados.oportunidadesPorContato.get(selecionado.contato_id) ?? []
            }
            mensagens={daConversa}
            aoVoltar={() => setSelecionadoId(null)}
            aoAssumir={() => assumir(selecionado.id)}
            aoEncerrar={() => encerrar(selecionado.id)}
            aoReabrir={() => reabrir(selecionado.id)}
            aoEnviar={enviar}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <MessageCircle className="size-9 text-zinc-300 dark:text-zinc-700" aria-hidden="true" />
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
              Selecione um atendimento
            </p>
            <p className="max-w-xs text-xs text-zinc-500 dark:text-zinc-400">
              Escolha uma conversa à esquerda, assuma um da fila, ou inicie um
              novo a partir de um contato.
            </p>
          </div>
        )}
      </section>

      {novoAberto && (
        <NovoAtendimento
          contatos={contatos}
          aoEscolher={iniciarComContato}
          aoFechar={() => setNovoAberto(false)}
        />
      )}
    </div>
  );
}

function TabBotao({
  rotulo,
  contagem,
  ativo,
  aoClicar,
  destaque = false,
}: {
  rotulo: string;
  contagem: number;
  ativo: boolean;
  aoClicar: () => void;
  destaque?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      aria-pressed={ativo}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] font-medium transition ${
        ativo
          ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
          : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
      }`}
    >
      {rotulo}
      {contagem > 0 && (
        <span
          className={`flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums ${
            ativo
              ? "bg-white/20 text-white dark:bg-zinc-900/20 dark:text-zinc-900"
              : destaque
                ? "bg-emerald-500 text-white"
                : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
          }`}
        >
          {contagem}
        </span>
      )}
    </button>
  );
}

function Conversa({
  atendimento,
  contato,
  usuarioPorId,
  usuarios,
  funis,
  etapas,
  etapaPorId,
  funilPorId,
  oportunidades,
  mensagens,
  aoVoltar,
  aoAssumir,
  aoEncerrar,
  aoReabrir,
  aoEnviar,
}: {
  atendimento: Atendimento;
  contato: Contato | undefined;
  usuarioPorId: Map<string, Usuario>;
  usuarios: Usuario[];
  funis: Funil[];
  etapas: Etapa[];
  etapaPorId: Map<string, Etapa>;
  funilPorId: Map<string, Funil>;
  oportunidades: Oportunidade[];
  mensagens: Mensagem[];
  aoVoltar: () => void;
  aoAssumir: () => void;
  aoEncerrar: () => void;
  aoReabrir: () => void;
  aoEnviar: (texto: string) => void;
}) {
  const { rotulo: canalRotulo, Icone: IconeCanal } = CANAL[atendimento.canal];
  const [texto, setTexto] = useState("");
  const [opAberta, setOpAberta] = useState(false);
  const fimRef = useRef<HTMLDivElement>(null);

  // Rola pro fim ao abrir a conversa e a cada mensagem nova.
  useEffect(() => {
    fimRef.current?.scrollIntoView({ block: "end" });
  }, [mensagens.length, atendimento.id]);

  function submeter() {
    if (!texto.trim()) return;
    aoEnviar(texto);
    setTexto("");
  }

  const encerrado = atendimento.status === "encerrado";
  const naFila = atendimento.status === "na_fila";

  return (
    <>
      <header className="flex items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <button
          type="button"
          onClick={aoVoltar}
          aria-label="Voltar para a lista"
          className="-ml-1 shrink-0 rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100 lg:hidden dark:hover:bg-zinc-900"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </button>

        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-[11px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {iniciais(contato?.nome ?? "?")}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-zinc-900 dark:text-zinc-50">
            {contato?.nome ?? "Contato removido"}
          </p>
          <p className="flex items-center gap-1 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
            <IconeCanal className="size-3" aria-hidden="true" />
            {canalRotulo}
            {contato?.whatsapp ? ` · ${contato.whatsapp}` : ""}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setOpAberta(true)}
          disabled={!contato}
          title="Criar oportunidade para este contato"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-[12px] font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:pointer-events-none disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          <Wallet className="size-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">Oportunidade</span>
        </button>

        {naFila && (
          <button
            type="button"
            onClick={aoAssumir}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            <Check className="size-3.5" aria-hidden="true" />
            Assumir
          </button>
        )}
        {atendimento.status === "aberto" && (
          <button
            type="button"
            onClick={aoEncerrar}
            className="shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-[12px] font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Encerrar
          </button>
        )}
        {encerrado && (
          <button
            type="button"
            onClick={aoReabrir}
            className="shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-[12px] font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Reabrir
          </button>
        )}
      </header>

      {naFila && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-[12px] text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
          Na fila, sem responsável. Responder assume o atendimento pra você.
        </div>
      )}

      {/* Oportunidades do contato: mostra se tem, e leva ao card no funil. */}
      {oportunidades.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-4 py-1.5 dark:border-zinc-800 dark:bg-zinc-900/40">
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
            <Wallet className="size-3" aria-hidden="true" />
            {oportunidades.length}{" "}
            {oportunidades.length === 1 ? "oportunidade" : "oportunidades"}:
          </span>
          {oportunidades.map((o) => {
            const et = etapaPorId.get(o.etapa_id);
            return (
              <Link
                key={o.id}
                href={`/?op=${o.id}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                title={et ? `${funilPorId.get(o.funil_id)?.nome ?? ""} · ${et.nome}` : undefined}
              >
                {et && (
                  <span className={`size-1.5 rounded-full ${et.cor}`} aria-hidden="true" />
                )}
                <span className="max-w-[10rem] truncate">{o.nome}</span>
                <span className="tabular-nums text-zinc-400 dark:text-zinc-500">
                  {brl(o.valor)}
                </span>
              </Link>
            );
          })}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-2">
          {mensagens.map((m) => (
            <Balao key={m.id} mensagem={m} usuarioPorId={usuarioPorId} />
          ))}
          <div ref={fimRef} />
        </div>
      </div>

      <div className="border-t border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto flex max-w-2xl items-end gap-2">
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              // Enter envia; Shift+Enter quebra linha.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submeter();
              }
            }}
            rows={1}
            placeholder={encerrado ? "Reabra para responder…" : "Escreva uma mensagem…"}
            className="max-h-32 min-h-[40px] flex-1 resize-none rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus-visible:ring-zinc-100/10"
          />
          <button
            type="button"
            onClick={submeter}
            disabled={!texto.trim()}
            aria-label="Enviar mensagem"
            className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-white transition hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            <SendHorizonal className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {opAberta && contato && (
        <NovaOportunidade
          contato={contato}
          funis={funis}
          etapas={etapas}
          usuarios={usuarios}
          aoFechar={() => setOpAberta(false)}
        />
      )}
    </>
  );
}

const campoModal =
  "w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus-visible:ring-zinc-100/10";

// Criar oportunidade a partir do atendimento: contato é fixo (o da conversa);
// aqui escolhe funil + etapa + nome/valor/responsável.
function NovaOportunidade({
  contato,
  funis,
  etapas,
  usuarios,
  aoFechar,
}: {
  contato: Contato;
  funis: Funil[];
  etapas: Etapa[];
  usuarios: Usuario[];
  aoFechar: () => void;
}) {
  const [nome, setNome] = useState("");
  const [valor, setValor] = useState("");
  const [responsavelId, setResponsavelId] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();

  // Só funis com ao menos uma etapa — sem etapa não há onde a oportunidade cair.
  const funisValidos = useMemo(
    () => funis.filter((f) => etapas.some((e) => e.funil_id === f.id)),
    [funis, etapas],
  );
  const [funilId, setFunilId] = useState(funisValidos[0]?.id ?? "");
  const etapasDoFunil = useMemo(
    () =>
      etapas
        .filter((e) => e.funil_id === funilId)
        .sort((a, b) => a.ordem - b.ordem),
    [etapas, funilId],
  );
  const [etapaId, setEtapaId] = useState(etapasDoFunil[0]?.id ?? "");

  function trocarFunil(id: string) {
    setFunilId(id);
    const primeira = etapas
      .filter((e) => e.funil_id === id)
      .sort((a, b) => a.ordem - b.ordem)[0];
    setEtapaId(primeira?.id ?? "");
  }

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") aoFechar();
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  function criar() {
    const n = nome.trim();
    if (!n || !funilId || !etapaId) return;
    setErro(null);
    iniciar(async () => {
      try {
        await criarOportunidade(
          contato.id,
          funilId,
          etapaId,
          n,
          Number(valor) || 0,
          responsavelId || null,
        );
        aoFechar();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao criar oportunidade");
      }
    });
  }

  const semFunil = funisValidos.length === 0;

  return (
    <div
      className="veu-surge fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[1px]"
      onClick={aoFechar}
      role="dialog"
      aria-modal="true"
      aria-label="Nova oportunidade"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <header className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <Wallet className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                Nova oportunidade
              </h2>
              <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                Para {contato.nome}
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

        {semFunil ? (
          <div className="px-5 py-8 text-center text-[13px] text-zinc-500 dark:text-zinc-400">
            Você ainda não tem um funil com etapas. Crie um em{" "}
            <span className="font-medium text-zinc-700 dark:text-zinc-200">
              Configurações
            </span>{" "}
            antes de criar oportunidades.
          </div>
        ) : (
          <div className="flex flex-col gap-4 px-5 py-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Nome
              </span>
              <input
                type="text"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Ex.: Projeto residencial"
                autoFocus
                className={campoModal}
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                  Valor (R$)
                </span>
                <input
                  type="number"
                  min={0}
                  step={100}
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  placeholder="0"
                  className={`${campoModal} tabular-nums`}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                  Responsável
                </span>
                <select
                  value={responsavelId}
                  onChange={(e) => setResponsavelId(e.target.value)}
                  className={campoModal}
                >
                  <option value="">Sem responsável</option>
                  {usuarios.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nome}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                  Funil
                </span>
                <select
                  value={funilId}
                  onChange={(e) => trocarFunil(e.target.value)}
                  className={campoModal}
                >
                  {funisValidos.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nome}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                  Etapa
                </span>
                <select
                  value={etapaId}
                  onChange={(e) => setEtapaId(e.target.value)}
                  className={campoModal}
                >
                  {etapasDoFunil.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nome}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {erro && <p className="text-xs text-red-500">{erro}</p>}

            <div className="mt-1 flex items-center justify-end gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
              <button
                type="button"
                onClick={aoFechar}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-[13px] font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={criar}
                disabled={!nome.trim() || !etapaId || salvando}
                className="rounded-lg bg-zinc-900 px-3 py-2 text-[13px] font-medium text-white transition hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Criar oportunidade
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Prévia da conversa na lista. Mensagem de mídia costuma vir SEM legenda, e
// antes disto a linha aparecia em branco — a conversa parecia vazia quando na
// verdade tinha um áudio. Rótulo do anexo quando não há texto.
const ROTULO_ANEXO: Record<string, string> = {
  imagem: "Imagem",
  sticker: "Figurinha",
  audio: "Áudio",
  video: "Vídeo",
  documento: "Documento",
  localizacao: "Localização",
  contato: "Contato",
  desconhecido: "Anexo",
};

function previaDaMensagem(m: Mensagem): string {
  if (m.texto) return m.texto;
  return ROTULO_ANEXO[m.tipo] ?? "Mensagem";
}

// Peso do arquivo em algo que se lê de relance. Sem casa decimal abaixo de
// 1 MB: "312 KB" informa tanto quanto "312,4 KB" e ocupa menos.
function tamanhoCurto(bytes: number | null): string | null {
  if (!bytes) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function duracaoCurta(seg: number | null): string | null {
  if (!seg) return null;
  const m = Math.floor(seg / 60);
  const s = seg % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * O anexo dentro do balão.
 *
 * O arquivo nunca é apontado pelo caminho no disco — vem sempre de
 * /api/midia/<id da mensagem>, que é quem decide se pode entregar (ver
 * app/api/midia/[id]/route.ts). Por isso este componente só precisa do id.
 *
 * Os estados que NÃO são 'salva' aparecem, e é de propósito: "chegou um áudio
 * que não conseguimos baixar" é informação de auditoria. Esconder viraria uma
 * conversa com buracos invisíveis, que é justamente o que havia antes.
 */
function Anexo({ mensagem, meu }: { mensagem: Mensagem; meu: boolean }) {
  const src = `/api/midia/${mensagem.id}`;
  const apagado = meu
    ? "text-white/60 dark:text-zinc-900/60"
    : "text-zinc-400 dark:text-zinc-500";

  if (mensagem.tipo === "localizacao" || mensagem.tipo === "contato") {
    return (
      <div className={`flex items-center gap-1.5 py-0.5 text-[12px] ${apagado}`}>
        <MapPin className="size-3.5 shrink-0" aria-hidden />
        <span>{mensagem.tipo === "localizacao" ? "Localização" : "Contato"}</span>
      </div>
    );
  }

  if (mensagem.midia_estado === "pendente") {
    return (
      <div className={`flex items-center gap-1.5 py-0.5 text-[12px] ${apagado}`}>
        <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
        <span>Baixando anexo…</span>
      </div>
    );
  }

  if (mensagem.midia_estado === "erro") {
    return (
      <div className="flex items-start gap-1.5 py-0.5 text-[12px] text-amber-600 dark:text-amber-500">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          Anexo não salvo
          {mensagem.midia_erro ? ` — ${mensagem.midia_erro}` : ""}
        </span>
      </div>
    );
  }

  if (mensagem.tipo === "imagem" || mensagem.tipo === "sticker") {
    return (
      <a href={src} target="_blank" rel="noreferrer" className="block">
        {/* <img> e não next/image: o tamanho vem do arquivo do cliente, não é
            conhecido em build, e a rota já serve com cache imutável. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={mensagem.texto || "Imagem recebida"}
          className={`mb-1 max-h-72 w-auto rounded-lg ${
            mensagem.tipo === "sticker" ? "max-h-32" : ""
          }`}
          loading="lazy"
        />
      </a>
    );
  }

  if (mensagem.tipo === "audio") {
    return (
      <div className="mb-1">
        <audio controls preload="none" src={src} className="h-9 w-56 max-w-full">
          <a href={src}>Baixar áudio</a>
        </audio>
        {duracaoCurta(mensagem.midia_duracao) && (
          <span className={`ml-1 text-[10px] tabular-nums ${apagado}`}>
            {duracaoCurta(mensagem.midia_duracao)}
          </span>
        )}
      </div>
    );
  }

  if (mensagem.tipo === "video") {
    return (
      <video
        controls
        preload="metadata"
        src={src}
        className="mb-1 max-h-72 w-auto rounded-lg"
      >
        <a href={src}>Baixar vídeo</a>
      </video>
    );
  }

  // documento e 'desconhecido': link para abrir/baixar. O tipo desconhecido cai
  // aqui de propósito — não saber classificar não pode virar anexo inacessível.
  const detalhe = [mensagem.midia_mime, tamanhoCurto(mensagem.midia_tamanho)]
    .filter(Boolean)
    .join(" · ");
  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      className={`mb-1 flex items-center gap-2 rounded-lg px-2 py-1.5 ${
        meu ? "bg-white/10 dark:bg-zinc-900/10" : "bg-zinc-100 dark:bg-zinc-800"
      }`}
    >
      <FileText className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium">
          {mensagem.midia_nome ?? "Documento"}
        </span>
        {detalhe && <span className={`block truncate text-[10px] ${apagado}`}>{detalhe}</span>}
      </span>
      <Download className="size-3.5 shrink-0" aria-hidden />
    </a>
  );
}

function Balao({
  mensagem,
  usuarioPorId,
}: {
  mensagem: Mensagem;
  usuarioPorId: Map<string, Usuario>;
}) {
  const meu = mensagem.origem === "agente";
  const autor = mensagem.autor_id ? usuarioPorId.get(mensagem.autor_id) : null;
  return (
    <div className={`flex ${meu ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed ${
          meu
            ? "rounded-br-md bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
            : "rounded-bl-md border border-zinc-200 bg-white text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
        }`}
      >
        {mensagem.tipo !== "texto" && <Anexo mensagem={mensagem} meu={meu} />}
        {mensagem.texto && (
          <p className="whitespace-pre-wrap break-words">{mensagem.texto}</p>
        )}
        <div
          className={`mt-1 flex items-center justify-end gap-1 text-[10px] tabular-nums ${
            meu ? "text-white/60 dark:text-zinc-900/60" : "text-zinc-400 dark:text-zinc-500"
          }`}
        >
          <span>
            {meu && autor ? `${autor.nome} · ` : ""}
            {horaCurta(mensagem.data_criacao)}
          </span>
          {meu && <StatusMsg status={mensagem.status} />}
        </div>
      </div>
    </div>
  );
}

// Estado de entrega da mensagem que enviamos, no rodapé do balão. Ícones herdam
// a cor apagada do horário (funciona nos dois temas, já que o balão inverte);
// só o erro ganha destaque, porque é o único que exige ação.
function StatusMsg({ status }: { status: Mensagem["status"] }) {
  if (status === "pendente")
    return <Clock className="size-3 shrink-0" aria-label="Enviando" />;
  if (status === "erro")
    return (
      <TriangleAlert
        className="size-3 shrink-0 text-red-400"
        aria-label="Falha no envio"
      />
    );
  if (status === "entregue" || status === "lido")
    return (
      <CheckCheck
        className="size-3 shrink-0"
        aria-label={status === "lido" ? "Lida" : "Entregue"}
      />
    );
  return <Check className="size-3 shrink-0" aria-label="Enviada" />;
}

function NovoAtendimento({
  contatos,
  aoEscolher,
  aoFechar,
}: {
  contatos: Contato[];
  aoEscolher: (contatoId: string) => void;
  aoFechar: () => void;
}) {
  const [busca, setBusca] = useState("");

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") aoFechar();
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return contatos;
    return contatos.filter(
      (c) =>
        c.nome.toLowerCase().includes(termo) ||
        c.email.toLowerCase().includes(termo),
    );
  }, [busca, contatos]);

  return (
    <div
      className="veu-surge fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[1px]"
      onClick={aoFechar}
      role="dialog"
      aria-modal="true"
      aria-label="Novo atendimento"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[70vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <header className="flex items-center justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <UserPlus className="size-4 text-zinc-500" aria-hidden="true" />
            <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Novo atendimento
            </h2>
          </div>
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar"
            className="-mr-1 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="border-b border-zinc-200 p-3 dark:border-zinc-800">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar contato por nome ou e-mail"
              autoFocus
              className="w-full rounded-lg border border-zinc-300 bg-white py-2 pl-8 pr-2.5 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus-visible:ring-zinc-100/10"
            />
          </div>
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {filtrados.length === 0 ? (
            <li className="px-4 py-10 text-center text-[13px] text-zinc-500 dark:text-zinc-400">
              Nenhum contato encontrado.
            </li>
          ) : (
            filtrados.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => aoEscolher(c.id)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {iniciais(c.nome)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50">
                      {c.nome}
                    </span>
                    <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                      {c.email}
                    </span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
