import { type Contato } from "../data";
import { corteDoPeriodo, normalizar } from "../filtros-comuns";

// Vínculos por contato vêm do banco (via props), não mais de mapas globais.
// Só preciso dos ids pra checar interseção, então o tipo é o mínimo.
type PorContato = Map<string, { id: string }[]>;

// Sem responsável nem funil: responsavel_id vive na oportunidade, e um contato
// pode ter oportunidades de vários responsáveis — ou nenhuma.
export type Filtros = {
  termo: string;
  periodo: string; // "todos" | "7" | "30" | "90"
  segmentoIds: string[];
  tagIds: string[];
  pais: string;
  estado: string;
  cidade: string;
};

export const filtrosVazios: Filtros = {
  termo: "",
  periodo: "todos",
  segmentoIds: [],
  tagIds: [],
  pais: "",
  estado: "",
  cidade: "",
};

export function contarFiltrosAtivos(f: Filtros) {
  return (
    (f.termo.trim() ? 1 : 0) +
    (f.periodo !== "todos" ? 1 : 0) +
    f.segmentoIds.length +
    f.tagIds.length +
    (f.pais ? 1 : 0) +
    (f.estado ? 1 : 0) +
    (f.cidade ? 1 : 0)
  );
}

// Texto normalizado por contato. `normalizar` é o passo caro do filtro (NFD +
// regex unicode) e o texto do contato não muda enquanto o usuário digita —
// então roda uma vez por lista, não uma vez por contato por tecla.
export type IndiceBusca = Map<string, string>;

export function indexarContatos(contatos: Contato[]): IndiceBusca {
  const indice: IndiceBusca = new Map();
  for (const c of contatos) {
    indice.set(
      c.id,
      normalizar(`${c.nome} ${c.email} ${c.whatsapp} ${c.cidade}`),
    );
  }
  return indice;
}

// Tudo que depende só dos filtros sai do laço: termo normalizado, corte de data
// pronto e os ids em Set (antes era um `.map` + `.includes` por contato, O(n·m)
// com alocação em cada linha).
export type Recorte = {
  termo: string;
  corte: string | null;
  segmentoIds: Set<string>;
  tagIds: Set<string>;
  pais: string;
  estado: string;
  cidade: string;
  indice: IndiceBusca;
  segmentosDoContato: PorContato;
  tagsDoContato: PorContato;
};

export function prepararRecorte(
  f: Filtros,
  indice: IndiceBusca,
  segmentosDoContato: PorContato,
  tagsDoContato: PorContato,
): Recorte {
  return {
    termo: normalizar(f.termo.trim()),
    corte: corteDoPeriodo(f.periodo),
    segmentoIds: new Set(f.segmentoIds),
    tagIds: new Set(f.tagIds),
    pais: f.pais,
    estado: f.estado,
    cidade: f.cidade,
    indice,
    segmentosDoContato,
    tagsDoContato,
  };
}

// Mesma regra do funil: E entre filtros diferentes, OU dentro de segmento/tag.
export function passaNoFiltro(c: Contato, r: Recorte) {
  if (r.termo && !(r.indice.get(c.id) ?? "").includes(r.termo)) return false;

  if (r.corte && c.data_criacao < r.corte) return false;

  if (r.pais && c.pais !== r.pais) return false;
  if (r.estado && c.estado !== r.estado) return false;
  if (r.cidade && c.cidade !== r.cidade) return false;

  if (r.segmentoIds.size) {
    const dele = r.segmentosDoContato.get(c.id);
    if (!dele?.some((s) => r.segmentoIds.has(s.id))) return false;
  }

  if (r.tagIds.size) {
    const dele = r.tagsDoContato.get(c.id);
    if (!dele?.some((t) => r.tagIds.has(t.id))) return false;
  }

  return true;
}
