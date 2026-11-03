// O que o módulo Infra (app/infra) mostra de cada serviço: um cartão com o
// estado, as medidas (uso contra o limite, quando há limite) e os avisos do que
// pede ação. Sem `server-only`: a tela só lê os tipos e a regra do estado.

export type EstadoInfra = "ok" | "atencao" | "critico" | "desconhecido";

export type MedidaInfra = {
  rotulo: string;
  /** O valor já escrito ("51,7 MB", "22 ativos", "RED"). */
  valor: string;
  /** "de 5 GB", "por dia": o que fica ao lado do valor. */
  limite?: string;
  /** 0 a 1, quando há limite: desenha a barra. */
  uso?: number;
  estado?: EstadoInfra;
};

export type CartaoInfra = {
  chave: string;
  titulo: string;
  /** O serviço e o que ele faz no CRM ("Neon · o banco de dados"). */
  subtitulo: string;
  estado: EstadoInfra;
  medidas: MedidaInfra[];
  /** O que pede ação, numa frase cada. */
  avisos: string[];
  /** Quando os dados foram lidos (os de chamada paga ficam guardados uns minutos). */
  lidoEm: string;
};

// A partir de quanto do limite o cartão avisa: 75% já pede atenção, 90% é crítico.
const ATENCAO = 0.75;
const CRITICO = 0.9;

export function estadoPorUso(uso: number): EstadoInfra {
  if (uso >= CRITICO) return "critico";
  if (uso >= ATENCAO) return "atencao";
  return "ok";
}

const PESO: Record<EstadoInfra, number> = { ok: 0, desconhecido: 1, atencao: 2, critico: 3 };

/** O pior estado entre os dados: é o do cartão. */
export function piorEstado(...estados: (EstadoInfra | undefined)[]): EstadoInfra {
  return estados.reduce<EstadoInfra>((pior, e) => (e && PESO[e] > PESO[pior] ? e : pior), "ok");
}
