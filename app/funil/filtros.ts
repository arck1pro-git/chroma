import { type Contato, type Oportunidade } from "../data";
import { dentroDoPeriodo, normalizar } from "../filtros-comuns";

// Lookups vêm do banco (via props), não mais de mapas globais.
type PorContato = Map<string, { id: string }[]>;

export type Filtros = {
  termo: string;
  periodo: string; // "todos" | "7" | "30" | "90"
  responsavelId: string;
  segmentoIds: string[];
  tagIds: string[];
  pais: string;
  estado: string;
  cidade: string;
};

export const filtrosVazios: Filtros = {
  termo: "",
  periodo: "todos",
  responsavelId: "",
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
    (f.responsavelId ? 1 : 0) +
    f.segmentoIds.length +
    f.tagIds.length +
    (f.pais ? 1 : 0) +
    (f.estado ? 1 : 0) +
    (f.cidade ? 1 : 0)
  );
}

// Entre filtros diferentes é E ("de SP" E "tag Urgente").
// Dentro de segmento/tag é OU ("tag Urgente OU Sem resposta") — marcar duas tags
// e receber zero resultado é o comportamento que ninguém espera.
export function passaNoFiltro(
  o: Oportunidade,
  f: Filtros,
  contatoPorId: Map<string, Contato>,
  segmentosDoContato: PorContato,
  tagsDoContato: PorContato,
) {
  const contato = contatoPorId.get(o.contato_id);
  if (!contato) return false;

  if (f.termo.trim()) {
    const termo = normalizar(f.termo.trim());
    const alvo = normalizar(
      [o.nome, contato.nome, contato.email, contato.whatsapp, contato.cidade].join(" "),
    );
    if (!alvo.includes(termo)) return false;
  }

  // o período aqui é o da oportunidade, não o do contato
  if (!dentroDoPeriodo(o.data_criacao, f.periodo)) return false;

  if (f.responsavelId && o.responsavel_id !== f.responsavelId) return false;
  if (f.pais && contato.pais !== f.pais) return false;
  if (f.estado && contato.estado !== f.estado) return false;
  if (f.cidade && contato.cidade !== f.cidade) return false;

  if (f.segmentoIds.length) {
    const doContato = (segmentosDoContato.get(contato.id) ?? []).map((s) => s.id);
    if (!f.segmentoIds.some((id) => doContato.includes(id))) return false;
  }

  if (f.tagIds.length) {
    const doContato = (tagsDoContato.get(contato.id) ?? []).map((t) => t.id);
    if (!f.tagIds.some((id) => doContato.includes(id))) return false;
  }

  return true;
}
