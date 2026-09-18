"use client";

// Tela da biblioteca: subir, procurar, renomear, arquivar.
//
// UMA LISTA E NÃO UMA GRADE DE MINIATURAS. A grade é bonita com fotos e inútil
// com o que de fato mora aqui — PDF, planilha, contrato —, onde toda miniatura
// é o mesmo retângulo cinza. A lista mostra o que diferencia: nome, tipo,
// tamanho, quem subiu, quando.
//
// O UPLOAD VAI PARA UMA ROTA, não para uma server action: corpo de server action
// topa 1 MB (ver app/api/documentos/route.ts). É por isso que esta tela tem
// `fetch` em vez do `useTransition` que o resto do CRM usa para mutação.
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Download,
  Eye,
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
  Music,
  Paperclip,
  Pencil,
  Search,
  Trash2,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Documento, TipoDocumento } from "@/lib/documentos";
import { dataCurta } from "../formato";
import {
  alternarArquivado,
  removerDocumento,
  salvarDocumento,
} from "./acoes";

const ICONE: Record<TipoDocumento, LucideIcon> = {
  imagem: ImageIcon,
  video: Film,
  audio: Music,
  documento: FileText,
};

const ROTULO_TIPO: Record<TipoDocumento, string> = {
  imagem: "Imagem",
  video: "Vídeo",
  audio: "Áudio",
  documento: "Documento",
};

const campoTexto =
  "w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus-visible:ring-zinc-100/10";

const botaoBase =
  "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition disabled:pointer-events-none disabled:opacity-40";
const botaoClaro = `${botaoBase} border border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900`;
const botaoEscuro = `${botaoBase} bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white`;

/** "1,4 MB". Base 1024 porque é o que o sistema operacional mostra. */
export function tamanhoEmTexto(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1).replace(".", ",")} MB`;
}

export default function PainelDocumentos({
  documentos,
  faltaMigration,
}: {
  documentos: Documento[];
  faltaMigration: boolean;
}) {
  const router = useRouter();
  const [busca, setBusca] = useState("");
  const [verArquivados, setVerArquivados] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [subindo, setSubindo] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return documentos.filter((d) => {
      if (d.arquivado !== verArquivados) return false;
      if (!termo) return true;
      // Busca também no nome do arquivo: quem subiu "proposta_v3.pdf" e chamou
      // de "Modelo de proposta" procura pelos dois.
      return (
        d.nome.toLowerCase().includes(termo) ||
        d.arquivoNome.toLowerCase().includes(termo) ||
        (d.descricao ?? "").toLowerCase().includes(termo)
      );
    });
  }, [documentos, busca, verArquivados]);

  const arquivados = documentos.filter((d) => d.arquivado).length;

  /**
   * Sobe os arquivos escolhidos, UM POR REQUISIÇÃO.
   *
   * Em série e não em paralelo: dez arquivos de 20 MB disparados juntos põem
   * 200 MB na memória do servidor ao mesmo tempo. Em série, cada um termina
   * antes do próximo começar, e o que falha não leva os outros junto — o aviso
   * no fim diz quantos entraram e quantos não.
   */
  async function subir(arquivos: FileList | null) {
    if (!arquivos?.length) return;
    setSubindo(true);
    setAviso(null);

    let entraram = 0;
    const erros: string[] = [];

    for (const arquivo of Array.from(arquivos)) {
      const form = new FormData();
      form.append("arquivo", arquivo);
      try {
        const res = await fetch("/api/documentos", { method: "POST", body: form });
        const dados = await res.json().catch(() => ({}));
        if (res.ok) entraram++;
        else erros.push(`${arquivo.name}: ${dados?.erro ?? `erro ${res.status}`}`);
      } catch {
        erros.push(`${arquivo.name}: falhou no envio`);
      }
    }

    setSubindo(false);
    // Limpa o input, senão escolher o MESMO arquivo de novo não dispara
    // onChange (o valor não mudou) e parece que a tela travou.
    if (inputRef.current) inputRef.current.value = "";

    setAviso({
      ok: erros.length === 0,
      texto: erros.length
        ? `${entraram} enviado(s). Falhou: ${erros.join(" · ")}`
        : `${entraram} ${entraram === 1 ? "documento enviado" : "documentos enviados"}.`,
    });
    router.refresh();
  }

  function comResultado(p: Promise<{ ok: boolean; mensagem: string }>) {
    iniciar(async () => {
      const r = await p;
      setAviso({ ok: r.ok, texto: r.mensagem });
      if (r.ok) {
        setEditando(null);
        router.refresh();
      }
    });
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-conteudo">
      <header className="shrink-0 border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            <Paperclip className="size-4" aria-hidden="true" />
            Documentos
          </h1>

          <div className="relative min-w-52 flex-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400"
              aria-hidden="true"
            />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Procurar por nome ou arquivo"
              className={`${campoTexto} pl-8`}
            />
          </div>

          {/* O input real fica escondido: `file` não aceita estilo, e o botão
              precisa parecer com os outros do CRM. */}
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => void subir(e.target.files)}
          />
          <button
            type="button"
            disabled={subindo || faltaMigration}
            onClick={() => inputRef.current?.click()}
            className={botaoEscuro}
          >
            {subindo ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Upload className="size-3.5" aria-hidden="true" />
            )}
            {subindo ? "Enviando…" : "Subir arquivo"}
          </button>
        </div>

        <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          PDF, imagem, vídeo, áudio — o que for. O que está aqui pode ser anexado
          na mensagem de uma cadência e enviado no chat, sem subir o arquivo de
          novo a cada atendimento.
        </p>

        {arquivados > 0 && (
          <button
            type="button"
            onClick={() => setVerArquivados((v) => !v)}
            className="mt-2 text-[11px] font-medium text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
          >
            {verArquivados
              ? "← Voltar à biblioteca"
              : `Ver ${arquivados} arquivado${arquivados === 1 ? "" : "s"}`}
          </button>
        )}
      </header>

      {aviso && (
        <div
          role="status"
          className={`shrink-0 border-b px-5 py-2 text-[12px] ${
            aviso.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
              : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
          }`}
        >
          {aviso.texto}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {faltaMigration ? (
          <p className="mx-auto max-w-lg rounded-xl border border-amber-200 bg-amber-50 p-4 text-[12px] leading-relaxed text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            A tabela <code>documentos</code> ainda não existe no banco. Rode{" "}
            <code>migration-documentos.sql</code> e recarregue — é ela que cria a
            biblioteca e a coluna que liga um documento à mensagem enviada.
          </p>
        ) : visiveis.length === 0 ? (
          <p className="py-16 text-center text-[12px] text-zinc-400 dark:text-zinc-500">
            {busca.trim()
              ? "Nenhum documento com esse nome."
              : verArquivados
                ? "Nada arquivado."
                : "Biblioteca vazia. Suba o primeiro arquivo no botão acima."}
          </p>
        ) : (
          <ul className="mx-auto flex max-w-4xl flex-col gap-1.5">
            {visiveis.map((d) => (
              <Linha
                key={d.id}
                documento={d}
                editando={editando === d.id}
                pendente={pendente}
                aoEditar={() => setEditando(d.id)}
                aoCancelar={() => setEditando(null)}
                aoSalvar={(nome, descricao) =>
                  comResultado(salvarDocumento({ id: d.id, nome, descricao }))
                }
                aoArquivar={() => comResultado(alternarArquivado(d.id, !d.arquivado))}
                aoExcluir={() => comResultado(removerDocumento(d.id))}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Uma linha da lista ──────────────────────────────────────────────────────
function Linha({
  documento: d,
  editando,
  pendente,
  aoEditar,
  aoCancelar,
  aoSalvar,
  aoArquivar,
  aoExcluir,
}: {
  documento: Documento;
  editando: boolean;
  pendente: boolean;
  aoEditar: () => void;
  aoCancelar: () => void;
  aoSalvar: (nome: string, descricao: string) => void;
  aoArquivar: () => void;
  aoExcluir: () => void;
}) {
  const [nome, setNome] = useState(d.nome);
  const [descricao, setDescricao] = useState(d.descricao ?? "");
  // Segundo clique no lixo é que exclui. Sem isso, um clique errado apaga um
  // arquivo que ninguém tem mais — a biblioteca é a única cópia.
  const [confirmando, setConfirmando] = useState(false);
  const Icone = ICONE[d.tipo];

  if (editando) {
    return (
      <li className="rounded-xl border border-zinc-300 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (nome.trim()) aoSalvar(nome, descricao);
          }}
          className="flex flex-col gap-2"
        >
          <input
            autoFocus
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Nome do documento"
            className={campoTexto}
          />
          <input
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Descrição (opcional) — para que serve, quando usar"
            className={campoTexto}
          />
          <p className="text-[10px] text-zinc-400 dark:text-zinc-500">
            O arquivo em si não muda: {d.arquivoNome} é o nome que o lead vê no
            WhatsApp. Para trocar o conteúdo, suba outro documento.
          </p>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={!nome.trim() || pendente}
              className={`${botaoEscuro} justify-center`}
            >
              <Check className="size-3.5" aria-hidden="true" />
              Salvar
            </button>
            <button type="button" onClick={aoCancelar} className={botaoClaro}>
              Cancelar
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li
      className={`group flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 transition hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 ${
        d.arquivado ? "opacity-60" : ""
      }`}
    >
      <Icone className="size-4 shrink-0 text-zinc-400" aria-hidden="true" />

      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50">
          {d.nome}
        </p>
        <p className="truncate text-[11px] text-zinc-400 dark:text-zinc-500">
          {ROTULO_TIPO[d.tipo]} · {tamanhoEmTexto(d.tamanho)} · {d.arquivoNome}
          {d.autor ? ` · ${d.autor}` : ""} · {dataCurta(d.dataCriacao)}
        </p>
        {d.descricao && (
          <p className="mt-0.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
            {d.descricao}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <a
          href={`/api/documentos/${d.id}`}
          target="_blank"
          rel="noreferrer"
          title="Abrir"
          className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          <Eye className="size-3.5" aria-hidden="true" />
        </a>
        <a
          href={`/api/documentos/${d.id}?baixar=1`}
          title="Baixar"
          className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          <Download className="size-3.5" aria-hidden="true" />
        </a>
        <button
          type="button"
          onClick={aoEditar}
          title="Renomear"
          className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          <Pencil className="size-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={aoArquivar}
          disabled={pendente}
          title={d.arquivado ? "Voltar à biblioteca" : "Arquivar"}
          className="rounded-lg px-2 py-1.5 text-[11px] font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          {d.arquivado ? "Desarquivar" : "Arquivar"}
        </button>
        <button
          type="button"
          disabled={pendente}
          onClick={() => {
            if (confirmando) aoExcluir();
            else setConfirmando(true);
          }}
          onBlur={() => setConfirmando(false)}
          title={confirmando ? "Clique de novo para excluir" : "Excluir"}
          className={`rounded-lg p-1.5 transition disabled:opacity-40 ${
            confirmando
              ? "bg-red-600 text-white"
              : "text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
          }`}
        >
          {confirmando ? (
            <X className="size-3.5" aria-hidden="true" />
          ) : (
            <Trash2 className="size-3.5" aria-hidden="true" />
          )}
        </button>
      </div>
    </li>
  );
}
