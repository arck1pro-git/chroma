"use client";

import { CalendarDays, Tag as TagIcon, Users } from "lucide-react";
import {
  CampoBusca,
  Chip,
  Menu,
  MenuLocalizacao,
  Paginacao,
  ResumoFiltros,
  SeletorMenu,
} from "../components/filtros-ui";
import { type Contato, type Segmento, type Tag } from "../data";
import { periodos } from "../filtros-comuns";
import { contarFiltrosAtivos, filtrosVazios, type Filtros } from "./filtros";

export default function BarraFiltros({
  contatos,
  segmentos,
  tags,
  filtros,
  aoMudarFiltros,
  visiveis,
  total,
  tamanhoPagina,
  aoMudarTamanhoPagina,
  pagina,
  totalPaginas,
  aoMudarPagina,
}: {
  // Vem por prop, não do import: registrar um contato adiciona no estado da
  // lista, e o filtro de localização precisa enxergar a cidade nova também.
  contatos: Contato[];
  // Segmentos/tags disponíveis para os menus de filtro (todos, do banco).
  segmentos: Segmento[];
  tags: Tag[];
  filtros: Filtros;
  aoMudarFiltros: (f: Filtros) => void;
  visiveis: number;
  total: number;
  tamanhoPagina: number;
  aoMudarTamanhoPagina: (n: number) => void;
  pagina: number;
  totalPaginas: number;
  aoMudarPagina: (p: number) => void;
}) {
  function alternar(lista: string[], id: string) {
    return lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id];
  }

  return (
    <div className="border-b border-zinc-200 px-6 py-3 xl:px-16 dark:border-zinc-800">
      <div className="flex max-w-[1600px] flex-wrap items-center gap-2">
        <Paginacao
          tamanho={tamanhoPagina}
          aoMudarTamanho={aoMudarTamanhoPagina}
          pagina={pagina}
          totalPaginas={totalPaginas}
          aoMudarPagina={aoMudarPagina}
          unidade="contatos"
        />

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
          singular="contato"
          plural="contatos"
        />
      </div>
    </div>
  );
}
