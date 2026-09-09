"use client";

import { CalendarDays, Layers, Tag as TagIcon, User, Users, X } from "lucide-react";
import {
  CampoBusca,
  Chip,
  Menu,
  MenuLocalizacao,
  ResumoFiltros,
  SeletorMenu,
} from "../components/filtros-ui";
import type { Contato, Funil, Segmento, Tag, Usuario } from "../data";
import { periodos } from "../filtros-comuns";
import { contarFiltrosAtivos, filtrosVazios, type Filtros } from "./filtros";

export default function BarraFiltros({
  funis,
  usuarios,
  segmentos,
  tags,
  contatos,
  funilId,
  aoTrocarFunil,
  filtros,
  aoMudarFiltros,
  visiveis,
  total,
  // A raiz já tem o seletor de funil na barra do topo; repetir aqui daria dois
  // controles para a mesma coisa, um do lado do outro.
  mostrarFunil = true,
  // Recuo/fundo do invólucro. A raiz precisa do mesmo alinhamento do quadro
  // (folga só à esquerda, sem largura máxima), e o quadro encosta na direita.
  moldura = "bg-white px-6 py-3 xl:px-16 dark:bg-zinc-950",
  linha = "flex max-w-[1600px] flex-wrap items-center gap-2",
}: {
  funis: Funil[];
  usuarios: Usuario[];
  segmentos: Segmento[];
  tags: Tag[];
  contatos: Contato[];
  funilId: string;
  aoTrocarFunil: (id: string) => void;
  filtros: Filtros;
  aoMudarFiltros: (f: Filtros) => void;
  visiveis: number;
  total: number;
  mostrarFunil?: boolean;
  moldura?: string;
  linha?: string;
}) {
  function alternar(lista: string[], id: string) {
    return lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id];
  }

  return (
    <div className={moldura}>
      <div className={linha}>
        {mostrarFunil && (
          <>
            <SeletorMenu
              Icone={Layers}
              rotulo="Funil"
              valor={funilId}
              opcoes={funis.map((f) => ({ valor: f.id, rotulo: f.nome }))}
              aoMudar={aoTrocarFunil}
              botao="w-56"
            />

            <span
              className="mx-1 hidden h-6 w-px bg-zinc-200 sm:block dark:bg-zinc-800"
              aria-hidden="true"
            />
          </>
        )}

        <button
          type="button"
          onClick={() => aoMudarFiltros(filtrosVazios)}
          disabled={contarFiltrosAtivos(filtros) === 0}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-[13px] text-zinc-600 outline-none transition hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-zinc-900/10 disabled:pointer-events-none disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:focus-visible:ring-zinc-100/10"
        >
          <X className="size-3.5 shrink-0" aria-hidden="true" />
          Limpar filtros
        </button>

        <CampoBusca
          valor={filtros.termo}
          aoMudar={(v) => aoMudarFiltros({ ...filtros, termo: v })}
          placeholder="Nome, e-mail, WhatsApp…"
        />

        <SeletorMenu
          Icone={CalendarDays}
          rotulo="Período de criação"
          valor={filtros.periodo}
          opcoes={periodos.map((p) => ({ valor: p.valor, rotulo: p.rotulo }))}
          aoMudar={(v) => aoMudarFiltros({ ...filtros, periodo: v })}
          botao="w-44"
          ativo={filtros.periodo !== "todos"}
        />

        <SeletorMenu
          Icone={User}
          rotulo="Responsável"
          valor={filtros.responsavelId}
          opcoes={[
            { valor: "", rotulo: "Qualquer responsável" },
            ...usuarios.map((u) => ({ valor: u.id, rotulo: u.nome })),
          ]}
          aoMudar={(v) => aoMudarFiltros({ ...filtros, responsavelId: v })}
          botao="w-52"
          ativo={filtros.responsavelId !== ""}
        />

        <Menu
          Icone={Users}
          rotulo="Segmentos"
          contagem={filtros.segmentoIds.length}
          botao="w-36"
          largura="w-72"
        >
          <div className="flex flex-wrap gap-1.5">
            {segmentos.map((s) => (
              <Chip
                key={s.id}
                rotulo={s.nome}
                ativo={filtros.segmentoIds.includes(s.id)}
                aoClicar={() =>
                  aoMudarFiltros({
                    ...filtros,
                    segmentoIds: alternar(filtros.segmentoIds, s.id),
                  })
                }
              />
            ))}
          </div>
        </Menu>

        <Menu
          Icone={TagIcon}
          rotulo="Tags"
          contagem={filtros.tagIds.length}
          botao="w-28"
          largura="w-72"
        >
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <Chip
                key={t.id}
                rotulo={t.nome}
                ativo={filtros.tagIds.includes(t.id)}
                aoClicar={() =>
                  aoMudarFiltros({ ...filtros, tagIds: alternar(filtros.tagIds, t.id) })
                }
              />
            ))}
          </div>
        </Menu>

        <MenuLocalizacao
          valor={{ pais: filtros.pais, estado: filtros.estado, cidade: filtros.cidade }}
          aoMudar={(loc) => aoMudarFiltros({ ...filtros, ...loc })}
          contatos={contatos}
        />

        <ResumoFiltros
          visiveis={visiveis}
          total={total}
          ativos={contarFiltrosAtivos(filtros)}
          aoLimpar={() => aoMudarFiltros(filtrosVazios)}
          singular="oportunidade"
          plural="oportunidades"
          semLimpar
        />
      </div>
    </div>
  );
}
