"use client";

// O vídeo aberto: o link para mandar, os números e quem assistiu.
//
// O LINK tem duas formas, porque o lead recebe de dois jeitos:
//   · pela cadência, com {{numero}} no lugar do WhatsApp — o motor troca pelo
//     número de cada lead no envio (é o mesmo campo da consulta do lead no
//     adaptador do n8n);
//   · na mão, para uma pessoa só: digita o número e copia o link pronto.
//
// "QUANTO VIU" é a cobertura: segundos DIFERENTES do vídeo, somando todas as
// vezes que a pessoa abriu (lib/videos.ts). Reassistir não aumenta; ver metade
// num dia e a outra metade no outro conta o vídeo inteiro.
//
// A tela se atualiza sozinha a cada 30 s com a aba visível: é aqui que se fica
// olhando o lead assistir depois de mandar o link.
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Pencil, Trash2, TriangleAlert, X } from "lucide-react";
import type { EnderecoCrm } from "@/lib/endereco";
import type { PessoaDoVideo, Video } from "@/lib/videos";
import { dataHora } from "../formato";
import { apagarVideo, salvarNome } from "./acoes";

/** "1:05", "12:30", "1:02:03". */
export function duracaoEmTexto(segundos: number) {
  const s = Math.max(0, Math.round(segundos));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const resto = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${resto}` : `${m}:${resto}`;
}

/** "+55 (47) 99934-6074". Fora do padrão BR, só o "+" na frente. */
function telefoneEmTexto(digitos: string) {
  const d = digitos.length === 10 || digitos.length === 11 ? `55${digitos}` : digitos;
  const br = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(d);
  return br ? `+55 (${br[1]}) ${br[2]}-${br[3]}` : `+${d}`;
}

const tamanhoEmTexto = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;

const cartao = "rounded-xl border border-zinc-200 dark:border-zinc-800";
const rotulo = "text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400";
const botaoIcone =
  "rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40 dark:hover:bg-zinc-900 dark:hover:text-zinc-50";

function Copiar({ texto, desabilitado }: { texto: string; desabilitado?: boolean }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      disabled={desabilitado}
      onClick={async () => {
        await navigator.clipboard.writeText(texto);
        setCopiado(true);
        setTimeout(() => setCopiado(false), 1500);
      }}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-[12px] font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:pointer-events-none disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
    >
      {copiado ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
      {copiado ? "Copiado" : "Copiar"}
    </button>
  );
}

function Numero({ titulo, valor, detalhe }: { titulo: string; valor: string; detalhe?: string }) {
  return (
    <div className={`${cartao} px-3.5 py-3`}>
      <p className={rotulo}>{titulo}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight text-zinc-900 dark:text-zinc-50">{valor}</p>
      {detalhe && <p className="mt-0.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400">{detalhe}</p>}
    </div>
  );
}

export default function Detalhe({
  video,
  pessoas,
  base,
}: {
  video: Video;
  pessoas: PessoaDoVideo[];
  base: EnderecoCrm;
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [nome, setNome] = useState<string | null>(null);
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);
  const [numero, setNumero] = useState("");

  useEffect(() => {
    const relogio = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 30_000);
    return () => clearInterval(relogio);
  }, [router]);

  const link = `${base.url}/v/${video.slug}`;
  const linkCadencia = `${link}?w={{numero}}`;
  const digitos = numero.replace(/\D/g, "");
  const linkDoLead = digitos.length >= 10 && digitos.length <= 15 ? `${link}?w=${digitos}` : null;

  const duracao = video.duracao;
  const aberturas = pessoas.reduce((s, p) => s + p.aberturas, 0);
  const fracao = (p: PessoaDoVideo) => (duracao ? Math.min(1, p.cobertura / duracao) : null);
  const media = duracao && pessoas.length ? pessoas.reduce((s, p) => s + (fracao(p) ?? 0), 0) / pessoas.length : null;
  const quaseTudo = duracao ? pessoas.filter((p) => (fracao(p) ?? 0) >= 0.9).length : null;

  function executar(acao: () => Promise<{ ok: boolean; mensagem: string }>, depois?: () => void) {
    iniciar(async () => {
      const r = await acao();
      setAviso({ ok: r.ok, texto: r.mensagem });
      if (r.ok) {
        depois?.();
        router.refresh();
      }
    });
  }

  const proporcao = video.largura && video.altura ? video.largura / video.altura : 16 / 9;

  return (
    <section className="min-w-0 flex-1 overflow-y-auto" aria-label={video.nome}>
      <header className="flex items-start gap-2 border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
        <div className="min-w-0 flex-1">
          {nome === null ? (
            <h2 className="truncate text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{video.nome}</h2>
          ) : (
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                executar(() => salvarNome(video.id, nome), () => setNome(null));
              }}
            >
              <input
                autoFocus
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setNome(null)}
                maxLength={120}
                aria-label="Nome do vídeo"
                className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-2.5 py-1 text-[14px] font-semibold text-zinc-900 outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              />
              <button type="submit" disabled={pendente} className={botaoIcone} aria-label="Salvar nome">
                <Check className="size-4" aria-hidden="true" />
              </button>
              <button type="button" onClick={() => setNome(null)} className={botaoIcone} aria-label="Cancelar">
                <X className="size-4" aria-hidden="true" />
              </button>
            </form>
          )}
          <p className="mt-0.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
            {[
              duracao ? duracaoEmTexto(duracao) : null,
              tamanhoEmTexto(video.tamanho),
              `subido ${video.autor ? `por ${video.autor} ` : ""}em ${dataHora(video.dataCriacao)}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {nome === null && (
          <button type="button" onClick={() => setNome(video.nome)} className={botaoIcone} aria-label="Renomear" title="Renomear">
            <Pencil className="size-4" aria-hidden="true" />
          </button>
        )}
        {confirmarExclusao ? (
          <span className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={pendente}
              onClick={() => executar(() => apagarVideo(video.id), () => router.push("/videos"))}
              className="rounded-lg bg-red-600 px-2.5 py-1.5 text-[12px] font-medium text-white transition hover:bg-red-700 disabled:opacity-40"
            >
              Excluir de vez
            </button>
            <button type="button" onClick={() => setConfirmarExclusao(false)} className={botaoIcone} aria-label="Cancelar exclusão">
              <X className="size-4" aria-hidden="true" />
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirmarExclusao(true)} className={botaoIcone} aria-label="Excluir" title="Excluir">
            <Trash2 className="size-4" aria-hidden="true" />
          </button>
        )}
      </header>

      {confirmarExclusao && (
        <p role="alert" className="border-b border-red-200 bg-red-50 px-6 py-2 text-[12px] text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          Excluir apaga o arquivo e tudo que foi medido dele. O link que já foi mandado passa a dar &quot;não encontrado&quot;.
        </p>
      )}
      {aviso && (
        <p
          role="status"
          className={`border-b px-6 py-2 text-[12px] ${
            aviso.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
              : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
          }`}
        >
          {aviso.texto}
        </p>
      )}

      <div className="space-y-4 p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          {/* A prévia toca pelo mesmo endereço do lead (/v/…/arquivo), mas
              daqui não conta como visualização: quem registra é o player da
              página pública. */}
          {/* Largura pelo formato: 16:9 ocupa 18rem; 9:16 fica estreito e
              alto, no máximo 22rem de altura. */}
          <div className="shrink-0" style={{ width: `min(100%, 18rem, calc(22rem * ${proporcao}))` }}>
            <video
              src={`/v/${video.slug}/arquivo`}
              poster={video.capa ? `/v/${video.slug}/capa` : undefined}
              controls
              playsInline
              preload="metadata"
              className="w-full rounded-xl bg-black object-contain"
              style={{ aspectRatio: String(proporcao) }}
            />
          </div>

          <div className={`${cartao} min-w-0 flex-1 space-y-3 p-4`}>
            <p className={rotulo}>Link para o lead</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-zinc-100 px-2.5 py-1.5 text-[12px] text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                {linkCadencia}
              </code>
              <Copiar texto={linkCadencia} />
            </div>
            <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
              Cole na mensagem da cadência: <code className="text-zinc-700 dark:text-zinc-300">{"{{numero}}"}</code> vira o
              WhatsApp de cada lead no envio, e é por ele que a visualização cai no contato certo.
            </p>

            <div className="border-t border-zinc-100 pt-3 dark:border-zinc-800">
              <label htmlFor="numero-do-lead" className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
                Para mandar a uma pessoa só
              </label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  id="numero-do-lead"
                  value={numero}
                  onChange={(e) => setNumero(e.target.value)}
                  inputMode="tel"
                  placeholder="WhatsApp com DDD, ex.: 47 99934-6074"
                  className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-[13px] text-zinc-900 outline-none placeholder:text-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                />
                <Copiar texto={linkDoLead ?? ""} desabilitado={!linkDoLead} />
              </div>
              {linkDoLead && <p className="mt-1.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400">{linkDoLead}</p>}
            </div>

            {!base.publico && (
              <p className="flex gap-1.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
                <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                Endereço local: este link só abre nesta máquina. Abra o CRM pelo domínio de produção e copie de lá.
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Numero titulo="Pessoas" valor={String(pessoas.length)} detalhe={`${aberturas} ${aberturas === 1 ? "abertura" : "aberturas"}`} />
          <Numero
            titulo="Viram em média"
            valor={media === null ? "—" : `${Math.round(media * 100)}%`}
            detalhe={
              !duracao
                ? "duração ainda desconhecida"
                : media === null
                  ? "ninguém abriu ainda"
                  : `${duracaoEmTexto(media * duracao)} de ${duracaoEmTexto(duracao)}`
            }
          />
          <Numero
            titulo="Viram quase tudo"
            valor={quaseTudo === null ? "—" : String(quaseTudo)}
            detalhe={quaseTudo === null ? undefined : "90% do vídeo ou mais"}
          />
          <Numero
            titulo="Última abertura"
            valor={video.ultimaAbertura ? dataHora(video.ultimaAbertura) : "—"}
          />
        </div>

        <div className={cartao}>
          <p className={`${rotulo} border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800`}>
            Quem assistiu · {pessoas.length}
          </p>
          {pessoas.length === 0 ? (
            <p className="px-4 py-10 text-center text-[12px] text-zinc-400 dark:text-zinc-500">
              Ninguém abriu ainda. Copie o link acima e mande pela cadência ou pelo chat.
            </p>
          ) : (
            <table className="w-full text-left text-[12px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  <th scope="col" className="px-4 py-2 font-medium">Lead</th>
                  <th scope="col" className="px-4 py-2 font-medium">Quanto viu</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Aberturas</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Na página</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Última vez</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {pessoas.map((p) => {
                  const f = fracao(p);
                  return (
                    <tr key={p.chave}>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-zinc-900 dark:text-zinc-50">
                          {p.nome ?? (p.whatsapp ? telefoneEmTexto(p.whatsapp) : "Sem número no link")}
                        </p>
                        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                          {p.nome && p.whatsapp
                            ? telefoneEmTexto(p.whatsapp)
                            : p.whatsapp
                              ? "não é contato do CRM"
                              : "abriu o link sem ?w="}
                        </p>
                      </td>
                      <td className="w-[38%] px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                            <div
                              className="h-full rounded-full bg-zinc-500 dark:bg-zinc-400"
                              style={{ width: `${f === null ? 0 : Math.max(f * 100, p.cobertura > 0 ? 2 : 0)}%` }}
                            />
                          </div>
                          <span className="shrink-0 tabular-nums text-zinc-700 dark:text-zinc-300">
                            {f === null
                              ? duracaoEmTexto(p.cobertura)
                              : `${duracaoEmTexto(p.cobertura)} · ${Math.round(f * 100)}%`}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700 dark:text-zinc-300">{p.aberturas}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700 dark:text-zinc-300">{duracaoEmTexto(p.naPagina)}</td>
                      <td className="px-4 py-2.5 text-right text-zinc-500 dark:text-zinc-400">{dataHora(p.ultima)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}
