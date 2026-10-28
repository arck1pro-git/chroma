"use client";

// O bloco "Enviar template": qual template aprovado, o que vai em cada {{n}}
// (um dado do contato, que vira o valor de cada pessoa no disparo, ou um texto
// igual para todos) e o que completa cada botão de link com variável (texto
// fixo; o WhatsApp do contato só no link de vídeo do CRM). A conferência é a
// de lib/templates-whatsapp.ts (problemaNoEnvio e problemaDoLinkVariavel), que
// o painel mostra no topo e o servidor repete.
import type { BlocoCampanha } from "@/lib/campanhas-fluxo";
import {
  DADOS_NA_CAMPANHA,
  LIMITE,
  dadoDoValor,
  ehLinkDeVideoDoCrm,
  linksVariaveisDe,
  marcaDoContato,
  respostasRapidasDe,
  textoParaRevisao,
  valoresIniciais,
  variaveisDoTemplate,
  type ChaveDoContato,
  type TemplateWhatsApp,
  type ValoresDoEnvio,
} from "@/lib/templates-whatsapp";
import { campoAds } from "../pecas";
import { Ajuda, Campo, Grupo } from "./campos";
import { acharTemplate } from "./grafo";

type EnviarTemplate = Extract<BlocoCampanha, { tipo: "enviar_template" }>;
type Lista = "cabecalho" | "corpo" | "botoes";

const chaveDe = (nome: string, idioma: string) => `${nome}::${idioma}`;

export default function EditorTemplate({
  bloco,
  templates,
  mudar,
}: {
  bloco: EnviarTemplate;
  templates: TemplateWhatsApp[];
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
  const respostas = t ? respostasRapidasDe(t) : [];

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
    ...Array.from({ length: n.cabecalho }, (_, i) => ({ lista: "cabecalho" as const, i, rotulo: `Cabeçalho {{${i + 1}}}`, maximo: LIMITE.cabecalho })),
    ...Array.from({ length: n.corpo }, (_, i) => ({ lista: "corpo" as const, i, rotulo: `{{${i + 1}}}`, maximo: LIMITE.valorFixo })),
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
      {!aprovados.length && <Ajuda>Nenhum template aprovado nesta conta. Crie um em Templates e espere a Meta aprovar.</Ajuda>}

      {t && (
        <p className="whitespace-pre-wrap break-words rounded-lg bg-zinc-50 p-3 text-[12px] leading-relaxed text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
          {textoParaRevisao(t, bloco.variaveis)}
        </p>
      )}

      {linhas.length > 0 && (
        <Grupo rotulo="O que vai em cada variável" ajuda="Contato sem o dado escolhido não recebe; a falha fica registrada.">
          <div className="space-y-2.5">
            {linhas.map((l) => (
              <ValorDaVariavel
                key={`${l.lista}${l.i}`}
                rotulo={l.rotulo}
                valor={bloco.variaveis[l.lista][l.i] ?? ""}
                maximo={l.maximo}
                mudar={(v) => alterar(l.lista, l.i, v)}
              />
            ))}
          </div>
        </Grupo>
      )}

      {links.length > 0 && (
        <Grupo rotulo="Botões de link" ajuda="O que completa o fim do link de cada botão.">
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

      {respostas.length > 0 && (
        <Ajuda>
          Os botões {respostas.map((r) => `“${r}”`).join(", ")} viram saídas do “Aguardar resposta” ligado depois deste bloco.
        </Ajuda>
      )}
    </div>
  );
}

/**
 * Uma variável: um dado do contato (só os que podem ir em campanha — e-mail e
 * WhatsApp ficam no chat, onde alguém confere antes) ou um texto fixo.
 */
function ValorDaVariavel({ rotulo, valor, maximo, mudar }: { rotulo: string; valor: string; maximo: number; mudar: (v: string) => void }) {
  const dado = dadoDoValor(valor);
  const escolhido = DADOS_NA_CAMPANHA.some((d) => d.chave === dado) ? dado : null;
  return (
    <div>
      <span className="font-mono text-[11px] text-zinc-400 dark:text-zinc-500">{rotulo}</span>
      <select
        aria-label={`O que vai em ${rotulo}`}
        className={`${campoAds} mt-1`}
        value={escolhido ?? "texto"}
        onChange={(e) => mudar(e.target.value === "texto" ? "" : marcaDoContato(e.target.value as ChaveDoContato))}
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
