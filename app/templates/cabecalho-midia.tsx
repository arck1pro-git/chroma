"use client";

// O formato do cabeçalho no editor de template e, no de imagem, vídeo ou PDF,
// o arquivo de EXEMPLO da biblioteca de Documentos (2026-10-28, pedido dele:
// "criar eles com uma imagem dentro ou vídeo"). O exemplo é só para a análise
// da Meta: no envio, o chat e a campanha escolhem o arquivo de cada disparo. A
// lista traz só o que serve de exemplo (problemaDoExemploDoCabecalho), e a rota
// confere de novo. Sem o módulo Documentos não há biblioteca: os formatos de
// mídia ficam apagados e o cabeçalho segue no texto.
import { useState } from "react";
import type { Documento } from "@/lib/documentos";
import {
  problemaDoExemploDoCabecalho,
  type FormatoDoCabecalho,
  type MidiaDoCabecalho,
} from "@/lib/templates-whatsapp";
import { FileText, Image as ImagemIcone, Type, Video, type TipoIcone } from "@/app/components/icones";
import { ListaDaBiblioteca } from "@/app/chat/compositor";

const FORMATOS: Array<{ valor: FormatoDoCabecalho; rotulo: string; Icone: TipoIcone; midia: boolean }> = [
  { valor: "TEXT", rotulo: "Texto", Icone: Type, midia: false },
  { valor: "IMAGE", rotulo: "Imagem", Icone: ImagemIcone, midia: true },
  { valor: "VIDEO", rotulo: "Vídeo", Icone: Video, midia: true },
  { valor: "DOCUMENT", rotulo: "PDF", Icone: FileText, midia: true },
];

const EXEMPLO: Record<MidiaDoCabecalho, { Icone: TipoIcone; vazio: string }> = {
  imagem: { Icone: ImagemIcone, vazio: "Nenhuma imagem JPG ou PNG de até 5 MB na biblioteca. Suba em Documentos." },
  video: { Icone: Video, vazio: "Nenhum vídeo MP4 de até 16 MB na biblioteca. Suba em Documentos." },
  documento: { Icone: FileText, vazio: "Nenhum PDF de até 100 MB na biblioteca. Suba em Documentos." },
};

/** Texto, imagem, vídeo ou PDF. `documentos` null = sem a biblioteca no acesso. */
export function FormatosDoCabecalho({
  formato,
  documentos,
  aoMudar,
}: {
  formato: FormatoDoCabecalho;
  documentos: Documento[] | null;
  aoMudar: (f: FormatoDoCabecalho) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Formato do cabeçalho" className="mb-2 inline-flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-900">
      {FORMATOS.map((f) => {
        const marcado = formato === f.valor;
        const semBiblioteca = f.midia && documentos === null;
        return (
          <button
            key={f.valor}
            type="button"
            role="radio"
            aria-checked={marcado}
            disabled={semBiblioteca && !marcado}
            title={semBiblioteca ? "O arquivo de exemplo vem da biblioteca, e seu acesso não inclui Documentos." : undefined}
            onClick={() => aoMudar(f.valor)}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition disabled:pointer-events-none disabled:opacity-35 ${
              marcado
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            }`}
          >
            <f.Icone className="size-3" aria-hidden="true" />
            {f.rotulo}
          </button>
        );
      })}
    </div>
  );
}

/** O arquivo de exemplo, escolhido na biblioteca entre os que servem para `pede`. */
export function ArquivoDeExemplo({
  pede,
  escolhido,
  documentos,
  aoEscolher,
}: {
  pede: MidiaDoCabecalho;
  escolhido: string;
  documentos: Documento[] | null;
  aoEscolher: (id: string) => void;
}) {
  const [aberta, setAberta] = useState(false);
  const { Icone, vazio } = EXEMPLO[pede];
  if (documentos === null) {
    return (
      <p className="text-[12px] leading-snug text-zinc-500 dark:text-zinc-400">
        O arquivo de exemplo vem da biblioteca de Documentos, que seu acesso não inclui. Volte para Texto ou peça o acesso.
      </p>
    );
  }
  const servem = documentos.filter((d) => problemaDoExemploDoCabecalho(pede, d) === null);
  const doc = servem.find((d) => d.id === escolhido);
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setAberta((v) => !v)}
        aria-expanded={aberta}
        className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left outline-none transition hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800 dark:focus-visible:ring-zinc-600"
      >
        <Icone className="size-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
        <span className={`min-w-0 flex-1 truncate text-[13px] ${doc ? "text-zinc-900 dark:text-zinc-50" : "text-zinc-400 dark:text-zinc-500"}`}>
          {doc ? doc.nome : "Escolher da biblioteca"}
        </span>
        {doc && <span className="max-w-[40%] shrink-0 truncate text-[10.5px] text-zinc-400">{doc.arquivoNome}</span>}
      </button>
      {aberta && (
        <ListaDaBiblioteca
          documentos={servem}
          vazio={vazio}
          aoEscolher={(d) => {
            aoEscolher(d.id);
            setAberta(false);
          }}
          aoFechar={() => setAberta(false)}
        />
      )}
    </div>
  );
}
