"use client";

// Os números de WhatsApp no RODAPÉ DA BARRA LATERAL, logo acima de
// Configurações.
//
// A pergunta que eles respondem de relance é uma só — "o número está no ar?" —
// e é por isso que a resposta é a BORDA, não um texto: verde conectado,
// vermelho desconectado, âmbar no meio do caminho (conectando, hibernado). Quem
// atende não lê legenda; vê a cor com o canto do olho e volta ao trabalho.
//
// A foto é a do perfil do WhatsApp, a mesma que o cliente vê ao receber a
// mensagem. Com mais de um número, é ela que diz QUAL caiu sem precisar abrir
// nada.
//
// ERA UMA MINI BARRA COLADA NA DIREITA, e mudou de lugar porque disputava a
// borda com o botão flutuante da IA e com os painéis que abrem por ali. No
// rodapé da barra da esquerda ele fica junto do resto do que é "estado do
// sistema": a conta de quem está logado e Configurações.
//
// NÃO HÁ LAÇO DE FUNDO, e isso é decisão de custo. A versão anterior
// reperguntava de 60 em 60 segundos (8 em 8 enquanto faltava foto), em TODAS as
// telas e para TODA pessoa logada — numa hospedagem que cobra por invocação,
// isso é uma conta que cresce sozinha com o time, sem ninguém pedir nada. Agora
// a lista é buscada UMA VEZ, quando a barra monta, e refeita só quando alguém
// mexe: ao parear, ao reconectar, ao remover, ou clicando no "atualizar" do
// painel.
//
// O preço: um número que cair DEPOIS de a página abrir continua verde até a
// próxima navegação com recarga. É o compromisso aceito — a pessoa que envia
// descobre pelo erro do envio, e quem quiser certeza abre o painel.
//
// O único laço que sobrou é o do QR Code, e ele é de outra natureza: dura os
// segundos em que o código está na frente de alguém, com o painel aberto, e
// para sozinho ao conectar. Sem ele não há como saber que o celular escaneou.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2,
  MessageCircleOff,
  Plus,
  QrCode,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { whatsappNoSelo, type EstadoWpp, type WhatsAppNoSelo } from "./acoes-wpp";
import {
  consultarConexao,
  criarInstanciaNaUazapi,
  gerarQrCode,
  removerInstancia,
  type ConexaoUazapi,
} from "@/app/configuracoes/actions";

// Enquanto o QR está na tela a pergunta é outra e a pressa é outra: a uazapi
// não avisa quando o celular escaneia, então a única forma de saber é
// perguntar. 3s é o mesmo intervalo da tela de Configurações, e o laço só
// existe com o painel aberto.
const INTERVALO_QR = 3000;

const BORDAS: Record<EstadoWpp, string> = {
  connected: "border-emerald-500",
  connecting: "border-amber-500",
  hibernated: "border-amber-500",
  disconnected: "border-red-500",
};

const ROTULOS: Record<EstadoWpp, string> = {
  connected: "Conectado",
  connecting: "Aguardando leitura do QR Code",
  hibernated: "Hibernada",
  disconnected: "Desconectado",
};

export default function SeloWhatsApp({
  /**
   * Quem pode criar instância. É o mesmo direito que a tela de Configurações
   * exige (`exigirModulo("configuracoes")`, nas actions): sem ele o "+" não
   * aparece, em vez de aparecer e explodir no clique.
   */
  podeCriar = false,
  /** A barra está recolhida? Muda o arranjo aqui e o lugar do painel. */
  recolhida = false,
}: {
  podeCriar?: boolean;
  recolhida?: boolean;
}) {
  const [numeros, setNumeros] = useState<WhatsAppNoSelo[]>([]);
  // O que está aberto ao lado da barra: "novo" (criar instância), o id de um
  // número (ver e mexer nele) ou nada. Um de cada vez — dois painéis abertos
  // sobre a mesma borda se cobririam.
  const [aberto, setAberto] = useState<"novo" | string | null>(null);

  // Busca depois da primeira pintura e repete no intervalo. `vivo` evita
  // escrever estado depois de desmontar; a action já engole os próprios erros e
  // devolve lista vazia.
  const buscar = useCallback(() => {
    whatsappNoSelo()
      .then(setNumeros)
      .catch(() => setNumeros([]));
  }, []);

  useEffect(() => {
    let vivo = true;
    whatsappNoSelo()
      .then((lista) => {
        if (vivo) setNumeros(lista);
      })
      .catch(() => {
        if (vivo) setNumeros([]);
      });
    return () => {
      vivo = false;
    };
  }, []);

  // Sem número cadastrado E sem poder criar, não há selo: um espaço vazio no
  // canto não informa nada. Com o direito de criar, a barra fica — só o "+"
  // dentro dela —, senão a primeira instância não teria por onde nascer aqui.
  if (numeros.length === 0 && !podeCriar) return null;

  return (
    <>
      {aberto === "novo" && (
        <PainelNovaInstancia
          recolhida={recolhida}
          aoFechar={() => setAberto(null)}
          aoConectar={buscar}
        />
      )}

      {numeros
        .filter((n) => n.id === aberto)
        .map((n) => (
          <PainelInstancia
            key={n.id}
            numero={n}
            recolhida={recolhida}
            aoFechar={() => setAberto(null)}
            aoMudar={buscar}
          />
        ))}

      {/* Aberta, as fotos ficam lado a lado e quebram linha; recolhida, uma
          embaixo da outra, centradas no trilho de 60px. */}
      <div
        className={`flex gap-1.5 ${
          recolhida
            ? "flex-col items-center py-1"
            : "flex-wrap items-center px-2.5 py-1"
        }`}
      >
        {numeros.map((n) => (
          <Selo
            key={n.id}
            numero={n}
            aberto={aberto === n.id}
            aoAbrir={() => setAberto((a) => (a === n.id ? null : n.id))}
          />
        ))}

        {podeCriar && (
          <button
            type="button"
            onClick={() => setAberto((a) => (a === "novo" ? null : "novo"))}
            aria-expanded={aberto === "novo"}
            aria-label="Novo número de WhatsApp"
            title="Novo número de WhatsApp"
            className="flex size-8 shrink-0 items-center justify-center rounded-full border border-dashed border-zinc-300 text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-950 dark:border-zinc-700 dark:hover:border-zinc-500 dark:hover:text-zinc-50"
          >
            <Plus className="size-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
    </>
  );
}

function Selo({
  numero,
  aberto,
  aoAbrir,
}: {
  numero: WhatsAppNoSelo;
  aberto: boolean;
  aoAbrir: () => void;
}) {
  // A URL da foto vem da CDN do WhatsApp e EXPIRA (tem `oe=` na querystring).
  // Quando isso acontece a imagem falha em silêncio e sobraria um buraco com
  // borda — por isso o fallback, que mantém o que importa: a cor.
  //
  // Guarda a URL QUE FALHOU, e não um booleano: a uazapi devolve uma URL nova a
  // cada consulta, e com booleano a primeira falha condenava o selo ao ícone
  // para sempre, mesmo depois de chegar um endereço bom.
  const [falhou, setFalhou] = useState<string | null>(null);

  const titulo = [
    numero.nome,
    numero.perfil,
    numero.numero,
    ROTULOS[numero.estado],
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      onClick={aoAbrir}
      aria-expanded={aberto}
      title={titulo}
      aria-label={titulo}
      className={`flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 bg-white transition hover:opacity-80 dark:bg-zinc-900 ${
        BORDAS[numero.estado] ?? BORDAS.disconnected
      } ${aberto ? "ring-2 ring-zinc-300 dark:ring-zinc-700" : ""}`}
    >
      {numero.foto && falhou !== numero.foto ? (
        // <img> cru, e não next/image: a URL é de um domínio externo que muda a
        // cada expiração, e configurá-lo em remotePatterns só para um avatar de
        // 44px não se paga.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={numero.foto}
          alt=""
          onError={() => setFalhou(numero.foto)}
          className="size-full object-cover"
        />
      ) : (
        <MessageCircleOff
          className="size-3.5 text-zinc-400 dark:text-zinc-500"
          aria-hidden="true"
        />
      )}
    </button>
  );
}

/**
 * O painel de criação, que sai da barra para a esquerda.
 *
 * Um campo e um botão, e o botão faz o caminho inteiro: cria a instância na
 * uazapi, aponta o webhook para este CRM e já pede o QR Code, que aparece aqui
 * mesmo. Não há um segundo clique entre "quero um número novo" e a câmera do
 * celular — que era o que sobrava quando isso só existia em Configurações.
 *
 * Enquanto o QR está na tela, o painel pergunta de 3 em 3 segundos se já
 * escanearam (a uazapi não avisa ninguém). Ao conectar, o laço para sozinho, a
 * barra recarrega — a foto nova aparece com a borda verde — e o painel mostra o
 * número pareado.
 */
function PainelNovaInstancia({
  recolhida,
  aoFechar,
  aoConectar,
}: {
  recolhida: boolean;
  aoFechar: () => void;
  /** A barra recarrega para a instância nova entrar na fila de fotos. */
  aoConectar: () => void;
}) {
  const [nome, setNome] = useState("");
  const [instanciaId, setInstanciaId] = useState<string | null>(null);
  const [conexao, setConexao] = useState<ConexaoUazapi | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // A instância já conectou nesta sessão do painel? Guarda para avisar a barra
  // uma vez só, em vez de a cada volta do laço.
  const avisou = useRef(false);

  async function criar() {
    const n = nome.trim();
    if (!n || ocupado) return;
    setOcupado(true);
    setErro(null);
    setAviso(null);

    try {
      const { id, aviso: pendencia } = await criarInstanciaNaUazapi(n);
      setInstanciaId(id);
      setAviso(pendencia);
      // O QR na sequência, sem passar pela lista: é o passo seguinte
      // inevitável de quem acabou de pedir um número novo.
      setConexao(await gerarQrCode(id));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao criar a instância");
    } finally {
      setOcupado(false);
    }
  }

  // O laço do pareamento. Só roda com QR na tela e para sozinho ao conectar —
  // é o mesmo desenho do painel de Configurações.
  const conectado = conexao?.estado === "connected";
  useEffect(() => {
    if (!instanciaId || conectado) return;
    let vivo = true;

    const id = setInterval(() => {
      consultarConexao(instanciaId)
        .then((c) => {
          if (!vivo) return;
          setConexao(c);
          if (c.estado === "connected" && !avisou.current) {
            avisou.current = true;
            aoConectar();
          }
        })
        .catch(() => {});
    }, INTERVALO_QR);

    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, [instanciaId, conectado, aoConectar]);

  return (
    <div
      role="dialog"
      aria-label="Nova instância de WhatsApp"
      // Colado à direita da barra lateral, na altura do rodapé dela. O
      // deslocamento acompanha a barra: 60px recolhida, 260px aberta. `fixed`
      // porque o QR Code não cabe nos 260px de dentro dela.
      className={`surge fixed bottom-20 z-40 w-[19rem] max-w-[calc(100vw-5rem)] rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-950 ${
        recolhida ? "left-[68px]" : "left-[268px]"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-[13px] font-semibold text-zinc-950 dark:text-zinc-50">
            Nova instância
          </h2>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            Nasce na uazapi com o webhook já apontado para este CRM.
          </p>
        </div>
        <button
          type="button"
          onClick={aoFechar}
          aria-label="Fechar"
          className="flex size-6 shrink-0 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-950 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>

      {/* Antes de existir instância: o nome e o botão. Depois, some — o nome já
          foi usado, e repetir o campo sugeriria que dá para criar outra sem
          fechar. */}
      {!instanciaId && (
        <div className="mt-3 flex flex-col gap-2">
          <input
            autoFocus
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void criar()}
            placeholder="Nome da instância"
            maxLength={60}
            className="w-full rounded-xl border border-zinc-200 bg-transparent px-3 py-2 text-[13px] text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-800 dark:text-zinc-50 dark:focus:border-zinc-600"
          />
          <button
            type="button"
            onClick={() => void criar()}
            disabled={!nome.trim() || ocupado}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-zinc-900 px-3 py-2 text-[13px] font-medium text-white transition hover:bg-zinc-800 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {ocupado ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <QrCode className="size-4" aria-hidden="true" />
            )}
            {ocupado ? "Criando…" : "Gerar QR Code"}
          </button>
        </div>
      )}

      {/* O QR. Fundo branco fixo: ele vem com fundo transparente e some no tema
          escuro se o cartão decidir a cor por ele. */}
      {!conectado && conexao?.qrcode && (
        <div className="mt-3 flex flex-col items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={conexao.qrcode}
            alt="QR Code para conectar o WhatsApp"
            className="size-48 rounded-lg bg-white p-2"
          />
          <p className="text-center text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            No celular: WhatsApp → Aparelhos conectados → Conectar um aparelho.
            O código vale 2 minutos e se renova sozinho.
          </p>
        </div>
      )}

      {conectado && (
        <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-[12px] leading-relaxed text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
          Conectado
          {conexao?.numero ? ` com ${conexao.numero}` : ""}. Este número já pode
          enviar pelo CRM.
        </p>
      )}

      {aviso && (
        <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-[11px] leading-relaxed text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
          {aviso}
        </p>
      )}

      {erro && <p className="mt-2 text-[12px] text-red-500">{erro}</p>}
    </div>
  );
}

/**
 * O painel de UM número, aberto ao clicar na foto dele.
 *
 * O que ele oferece depende do estado, e as duas ofertas são opostas de
 * propósito:
 *
 * · CONECTADO → remover. É a saída destrutiva: desconecta o aparelho, apaga a
 *   instância na uazapi e tira a linha do CRM (ver `removerInstancia`). Vem com
 *   confirmação, e o texto dela diz o que não tem volta.
 *
 * · DESCONECTADO → reconectar. Gera um QR novo para a MESMA instância: o token
 *   não muda ao reconectar, então as automações publicadas continuam saindo por
 *   ela sem republicar nada.
 *
 * Reconectar não aparece em número conectado, e remover não é o botão grande de
 * um número que caiu: quem vê a borda vermelha quer o WhatsApp de volta, não
 * quer apagar o número.
 */
function PainelInstancia({
  numero,
  recolhida,
  aoFechar,
  aoMudar,
}: {
  numero: WhatsAppNoSelo;
  recolhida: boolean;
  aoFechar: () => void;
  /** A barra recarrega — a borda muda de cor, ou a foto some. */
  aoMudar: () => void;
}) {
  const [conexao, setConexao] = useState<ConexaoUazapi | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const avisou = useRef(false);

  // O estado que vale é o que a uazapi acabou de dizer; enquanto não houver
  // consulta nova, o que veio com a barra.
  const estado = conexao?.estado ?? numero.estado;
  const conectado = estado === "connected";

  // Sem laço de fundo, esta é a forma de reperguntar: um clique, quando a
  // pessoa quer certeza. Atualiza o painel E a fila de fotos da barra.
  function atualizar() {
    setOcupado(true);
    setErro(null);
    consultarConexao(numero.id)
      .then((c) => {
        setConexao(c);
        aoMudar();
      })
      .catch((e) =>
        setErro(e instanceof Error ? e.message : "Falha ao consultar a uazapi"),
      )
      .finally(() => setOcupado(false));
  }

  async function reconectar() {
    setOcupado(true);
    setErro(null);
    try {
      setConexao(await gerarQrCode(numero.id));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao pedir o QR Code");
    } finally {
      setOcupado(false);
    }
  }

  function remover() {
    if (
      !window.confirm(
        `Remover "${numero.nome}"? A instância é APAGADA na uazapi — o aparelho desconecta e o número some do servidor — e sai do CRM. Não tem volta. As automações publicadas que usam este número param de enviar.`,
      )
    )
      return;

    setOcupado(true);
    setErro(null);
    removerInstancia(numero.id)
      .then(() => {
        aoMudar();
        aoFechar();
      })
      .catch((e) =>
        setErro(e instanceof Error ? e.message : "Falha ao remover a instância"),
      )
      .finally(() => setOcupado(false));
  }

  // O laço do pareamento: só roda com QR na tela, para sozinho ao conectar.
  const esperandoLeitura = Boolean(conexao?.qrcode) && !conectado;
  useEffect(() => {
    if (!esperandoLeitura) return;
    let vivo = true;

    const id = setInterval(() => {
      consultarConexao(numero.id)
        .then((c) => {
          if (!vivo) return;
          setConexao(c);
          if (c.estado === "connected" && !avisou.current) {
            avisou.current = true;
            aoMudar();
          }
        })
        .catch(() => {});
    }, INTERVALO_QR);

    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, [esperandoLeitura, numero.id, aoMudar]);

  return (
    <div
      role="dialog"
      aria-label={`Instância ${numero.nome}`}
      className={`surge fixed bottom-20 z-40 w-[19rem] max-w-[calc(100vw-5rem)] rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-950 ${
        recolhida ? "left-[68px]" : "left-[268px]"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-[13px] font-semibold text-zinc-950 dark:text-zinc-50">
            {numero.nome}
          </h2>
          <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
            {numero.numero ?? "sem número pareado"} · {ROTULOS[estado]}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={atualizar}
            disabled={ocupado}
            aria-label="Atualizar estado"
            title="Atualizar estado"
            className="flex size-6 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-950 disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar"
            className="flex size-6 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-950 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* O QR da reconexão. Mesmo desenho do painel de criação. */}
      {esperandoLeitura && conexao?.qrcode && (
        <div className="mt-3 flex flex-col items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={conexao.qrcode}
            alt={`QR Code para reconectar ${numero.nome}`}
            className="size-48 rounded-lg bg-white p-2"
          />
          <p className="text-center text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            No celular: WhatsApp → Aparelhos conectados → Conectar um aparelho.
            O código vale 2 minutos e se renova sozinho.
          </p>
        </div>
      )}

      <div className="mt-3 flex flex-col gap-2">
        {conectado ? (
          <button
            type="button"
            onClick={remover}
            disabled={ocupado}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-red-600 px-3 py-2 text-[13px] font-medium text-white transition hover:bg-red-700 disabled:opacity-40"
          >
            {ocupado ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 className="size-4" aria-hidden="true" />
            )}
            Desconectar e remover
          </button>
        ) : (
          !esperandoLeitura && (
            <button
              type="button"
              onClick={() => void reconectar()}
              disabled={ocupado}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-zinc-900 px-3 py-2 text-[13px] font-medium text-white transition hover:bg-zinc-800 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {ocupado ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <QrCode className="size-4" aria-hidden="true" />
              )}
              {ocupado ? "Gerando…" : "Reconectar"}
            </button>
          )
        )}

        {/* Conectou durante a reconexão: o botão de remover volta, mas a
            mensagem verde é o que a pessoa veio ver. */}
        {conectado && conexao && (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-[12px] leading-relaxed text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
            Conectado{conexao.numero ? ` com ${conexao.numero}` : ""}.
          </p>
        )}
      </div>

      {erro && <p className="mt-2 text-[12px] text-red-500">{erro}</p>}
    </div>
  );
}
