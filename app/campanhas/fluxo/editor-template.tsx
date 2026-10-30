"use client";

// O bloco "Enviar template": qual template aprovado, o que vai em cada {{n}}
// (um dado do contato, que vira o valor de cada pessoa no disparo, ou um texto
// igual para todos) e o que completa cada botão de link com variável (texto
// fixo; o WhatsApp do contato só no link de vídeo do CRM). A conferência é a
// de lib/templates-whatsapp.ts (problemaNoEnvio e problemaDoLinkVariavel), que
// a lista de pendências mostra e o servidor repete. As regras que importam vão
// num "?" ao lado do rótulo (2026-10-28), sem parágrafo embaixo.
//
// O texto fixo começa com o que foi escrito na variável ao criar o template
// (2026-10-30, valoresIniciais e textoFixoDoExemplo).
//
// CABEÇALHO COM MÍDIA (2026-10-28, pedido dele: "templates aprovados com vídeo
// e fotos"): template com imagem, vídeo ou documento no cabeçalho
// (midiaDoCabecalho) pede o arquivo da biblioteca de Documentos, do mesmo
// tipo, gravado em variaveis.midia (o id). A pendência sem arquivo vem de
// lib/. A prévia mostra o nome do arquivo; miniatura não, porque o bucket é
// privado e a tela não tem o link.
import type { BlocoCampanha } from "@/lib/campanhas-fluxo";
import {
  DADOS_NA_CAMPANHA,
  LIMITE,
  dadoDoValor,
  ehLinkDeVideoDoCrm,
  linksVariaveisDe,
  marcaDoContato,
  midiaDoCabecalho,
  textoFixoDoExemplo,
  textoParaRevisao,
  valoresIniciais,
  variaveisDoTemplate,
  type ChaveDoContato,
  type TemplateWhatsApp,
  type ValoresDoEnvio,
} from "@/lib/templates-whatsapp";
import { FileText, Image as ImagemIcone, Video, type TipoIcone } from "@/app/components/icones";
import { campoAds } from "../pecas";
import { Ajuda, Campo, Escolha, Grupo } from "./campos";
import { acharTemplate, type OpcoesFluxo } from "./grafo";

type EnviarTemplate = Extract<BlocoCampanha, { tipo: "enviar_template" }>;
type Lista = "cabecalho" | "corpo" | "botoes";

const chaveDe = (nome: string, idioma: string) => `${nome}::${idioma}`;

/**
 * A mídia do cabeçalho (midiaDoCabecalho) e o tipo do arquivo da biblioteca
 * que serve (tipoDoArquivoDaCampanha, lib/campanhas-fluxo-envios.ts: o
 * documento do WhatsApp é PDF).
 */
const MIDIA: Record<"imagem" | "video" | "documento", { arquivo: string; rotulo: string; vazio: string; nenhum: string; Icone: TipoIcone }> = {
  imagem: { arquivo: "imagem", rotulo: "Imagem do cabeçalho", vazio: "Escolha a imagem", nenhum: "Nenhuma imagem", Icone: ImagemIcone },
  video: { arquivo: "video", rotulo: "Vídeo do cabeçalho", vazio: "Escolha o vídeo", nenhum: "Nenhum vídeo", Icone: Video },
  documento: { arquivo: "pdf", rotulo: "PDF do cabeçalho", vazio: "Escolha o PDF", nenhum: "Nenhum PDF", Icone: FileText },
};

export default function EditorTemplate({
  bloco,
  templates,
  documentos,
  mudar,
}: {
  bloco: EnviarTemplate;
  templates: TemplateWhatsApp[];
  /** A biblioteca de Documentos, para o cabeçalho com mídia. */
  documentos: OpcoesFluxo["documentos"];
  mudar: (b: EnviarTemplate) => void;
}) {
  const aprovados = templates.filter((t) => t.status === "APPROVED");
  const t = acharTemplate(templates, bloco.template_nome, bloco.template_idioma);
  const escolhido = bloco.template_nome ? chaveDe(bloco.template_nome, bloco.template_idioma) : "";
  const foraDaLista = escolhido && !aprovados.some((x) => chaveDe(x.nome, x.idioma) === escolhido);
  // Sem o template na conta, a quantidade sai dos valores guardados: o que foi
  // configurado continua à vista.
  const n = t ? variaveisDoTemplate(t) : { cabecalho: bloco.variaveis.cabecalho.length, corpo: bloco.variaveis.corpo.length };
  const links = t ? linksVariaveisDe(t) : [];
  const tipoDaMidia = t ? midiaDoCabecalho(t) : null;
  const midia = tipoDaMidia ? MIDIA[tipoDaMidia] : null;
  const arquivos = midia ? documentos.filter((d) => d.tipo === midia.arquivo) : [];
  const arquivoEscolhido = bloco.variaveis.midia ? documentos.find((d) => d.id === bloco.variaveis.midia) : undefined;

  function trocar(chave: string) {
    const novo = aprovados.find((x) => chaveDe(x.nome, x.idioma) === chave);
    mudar(
      novo
        ? { ...bloco, template_nome: novo.nome, template_idioma: novo.idioma, variaveis: valoresIniciais(novo) }
        : { ...bloco, template_nome: "", variaveis: { cabecalho: [], corpo: [] } },
    );
  }

  function alterar(lista: Lista, i: number, valor: string) {
    const v = bloco.variaveis;
    const nova = [...(v[lista] ?? [])];
    while (nova.length <= i) nova.push("");
    nova[i] = valor;
    const variaveis: ValoresDoEnvio =
      lista === "cabecalho" ? { ...v, cabecalho: nova } : lista === "corpo" ? { ...v, corpo: nova } : { ...v, botoes: nova };
    mudar({ ...bloco, variaveis });
  }

  const linhas = [
    ...Array.from({ length: n.cabecalho }, (_, i) => ({
      lista: "cabecalho" as const,
      i,
      rotulo: `Cabeçalho {{${i + 1}}}`,
      maximo: LIMITE.cabecalho,
      exemplo: textoFixoDoExemplo(t?.exemplosCabecalho[i]),
    })),
    ...Array.from({ length: n.corpo }, (_, i) => ({
      lista: "corpo" as const,
      i,
      rotulo: `{{${i + 1}}}`,
      maximo: LIMITE.valorFixo,
      exemplo: textoFixoDoExemplo(t?.exemplosCorpo[i]),
    })),
  ];

  return (
    <div className="space-y-4">
      <Campo rotulo="Template aprovado">
        <select className={campoAds} value={escolhido} onChange={(e) => trocar(e.target.value)}>
          <option value="">Escolha o template</option>
          {foraDaLista && (
            <option value={escolhido} disabled>
              {bloco.template_nome} · {bloco.template_idioma} (não aprovado)
            </option>
          )}
          {aprovados.map((x) => (
            <option key={x.id} value={chaveDe(x.nome, x.idioma)}>
              {x.nome} · {x.idioma}
            </option>
          ))}
        </select>
      </Campo>
      {!aprovados.length && <Ajuda>Nenhum template aprovado. Crie em Templates.</Ajuda>}

      {midia && (
        <div>
          <Escolha
            rotulo={midia.rotulo}
            valor={bloco.variaveis.midia ?? ""}
            opcoes={arquivos}
            vazio={midia.vazio}
            mudar={(id) => mudar({ ...bloco, variaveis: { ...bloco.variaveis, midia: id || null } })}
          />
          {!arquivos.length && <Ajuda>{midia.nenhum}. Suba em Documentos.</Ajuda>}
        </div>
      )}

      {t && (
        <div className="rounded-lg bg-zinc-50 p-3 text-[12px] leading-relaxed text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
          {midia && (
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
              <midia.Icone className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{arquivoEscolhido?.nome ?? midia.vazio}</span>
            </p>
          )}
          <p className="whitespace-pre-wrap break-words">{textoParaRevisao(t, bloco.variaveis)}</p>
        </div>
      )}

      {linhas.length > 0 && (
        <Grupo rotulo="Variáveis" dica="Contato sem o dado escolhido não recebe; a falha fica registrada.">
          <div className="space-y-2.5">
            {linhas.map((l) => (
              <ValorDaVariavel
                key={`${l.lista}${l.i}`}
                rotulo={l.rotulo}
                valor={bloco.variaveis[l.lista][l.i] ?? ""}
                maximo={l.maximo}
                exemplo={l.exemplo}
                mudar={(v) => alterar(l.lista, l.i, v)}
              />
            ))}
          </div>
        </Grupo>
      )}

      {links.length > 0 && (
        <Grupo rotulo="Botões de link" dica="O que completa o fim do link de cada botão.">
          <div className="space-y-2.5">
            {links.map((l) => {
              const valor = bloco.variaveis.botoes?.[l.indice] ?? "";
              const doContato = dadoDoValor(valor) === "numero";
              // O WhatsApp do contato só cabe no link de vídeo do CRM (…/v/<código>?w={{1}}).
              const aceitaNumero = ehLinkDeVideoDoCrm(l.url);
              return (
                <div key={l.indice}>
                  <p className="truncate text-[11px] text-zinc-600 dark:text-zinc-300" title={l.url}>
                    “{l.texto}” · <span className="text-zinc-400 dark:text-zinc-500">{l.url}</span>
                  </p>
                  {(aceitaNumero || doContato) && (
                    <select
                      aria-label={`O que completa o link do botão “${l.texto}”`}
                      className={`${campoAds} mt-1`}
                      value={doContato ? "numero" : "texto"}
                      onChange={(e) => alterar("botoes", l.indice, e.target.value === "numero" ? marcaDoContato("numero") : "")}
                    >
                      <option value="numero">WhatsApp do contato</option>
                      <option value="texto">Texto fixo</option>
                    </select>
                  )}
                  {!doContato && (
                    <input
                      aria-label={`Texto que completa o link do botão “${l.texto}”`}
                      className={`${campoAds} mt-1`}
                      value={valor}
                      maxLength={LIMITE.valorLink}
                      onChange={(e) => alterar("botoes", l.indice, e.target.value)}
                      placeholder="Igual para todos"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </Grupo>
      )}
    </div>
  );
}

/**
 * Uma variável: um dado do contato (só os que podem ir em campanha — e-mail e
 * WhatsApp ficam no chat, onde alguém confere antes) ou um texto fixo, que
 * começa com o texto escrito no template (textoFixoDoExemplo).
 */
function ValorDaVariavel({
  rotulo,
  valor,
  maximo,
  exemplo,
  mudar,
}: {
  rotulo: string;
  valor: string;
  maximo: number;
  exemplo: string;
  mudar: (v: string) => void;
}) {
  const dado = dadoDoValor(valor);
  const escolhido = DADOS_NA_CAMPANHA.some((d) => d.chave === dado) ? dado : null;
  return (
    <div>
      <span className="font-mono text-[11px] text-zinc-400 dark:text-zinc-500">{rotulo}</span>
      <select
        aria-label={`O que vai em ${rotulo}`}
        className={`${campoAds} mt-1`}
        value={escolhido ?? "texto"}
        onChange={(e) => mudar(e.target.value === "texto" ? exemplo : marcaDoContato(e.target.value as ChaveDoContato))}
      >
        {DADOS_NA_CAMPANHA.map((d) => (
          <option key={d.chave} value={d.chave}>
            {d.rotulo} do contato
          </option>
        ))}
        <option value="texto">Texto fixo</option>
      </select>
      {!escolhido && (
        <input
          aria-label={`Texto de ${rotulo}`}
          className={`${campoAds} mt-1`}
          value={valor}
          maxLength={maximo}
          onChange={(e) => mudar(e.target.value)}
          placeholder="Igual para todos"
        />
      )}
    </div>
  );
}
