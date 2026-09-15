"use client";

// O gráfico da aba Métricas. Mesma anatomia dos gráficos das Automações
// (app/automacoes/graficos.tsx): legenda sempre presente, leitura do dia sob o
// cursor no canto, grade em hairline e tabela sr-only com os números.
//
// BARRA EMPILHADA, e não linha como lá: a pergunta aqui é "quantos entraram
// neste dia", uma contagem discreta e quase sempre pequena — a altura total da
// barra responde isso direto. Linha entre 0 e 3 leads insinua uma tendência
// contínua que não existe.
//
// DUAS SÉRIES, não três. 'recusado' e 'erro' viram uma faixa só ("não entrou")
// porque o par azul/vermelho de --serie-* é o que já passou nos testes de
// daltonismo (ver globals.css); uma terceira cor exigiria revalidar o conjunto
// para separar dois estados que, no gráfico, respondem a mesma coisa. Qual dos
// dois foi está nos totais acima e no log abaixo.
import { useState } from "react";
import type { RecebimentoNoDia } from "./dados";
import { vazio } from "./estilos";

function diaCurto(iso: string) {
  return iso.slice(8, 10);
}

function mesCurto(iso: string) {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

// Teto do eixo em número limpo E divisível por 2 — o gráfico mostra o tick do
// meio, então um teto de 25 daria "12,5" no eixo. Arredondar para 30 dá 15.
function tetoLimpo(max: number) {
  if (max <= 4) return 4; // meio = 2
  if (max <= 10) return 10; // meio = 5
  return Math.ceil(max / 10) * 10; // meio sempre múltiplo de 5
}

export function RecebimentosPorDia({ dados }: { dados: RecebimentoNoDia[] }) {
  const [ativo, setAtivo] = useState<number | null>(null);

  const teto = tetoLimpo(Math.max(...dados.map((d) => d.ok + d.falha), 0));
  const total = dados.reduce((s, d) => s + d.ok + d.falha, 0);

  if (total === 0) {
    return <p className={vazio}>Nenhum recebimento nos últimos 14 dias</p>;
  }

  const emFoco = ativo !== null ? dados[ativo] : null;

  return (
    <div className="viz">
      {/* Legenda sempre presente com 2 séries: identidade nunca depende só da
          cor. O texto usa token de tinta; quem carrega a identidade é o bloco
          colorido ao lado. */}
      <div className="mb-3 flex items-center gap-4">
        <span className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
          <span
            className="size-2 rounded-[2px]"
            style={{ background: "var(--serie-ok)" }}
            aria-hidden="true"
          />
          Virou lead
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
          <span
            className="size-2 rounded-[2px]"
            style={{ background: "var(--serie-erro)" }}
            aria-hidden="true"
          />
          Não entrou
        </span>
        <span className="ml-auto text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">
          {emFoco
            ? `${mesCurto(emFoco.dia)} · ${emFoco.ok} lead${emFoco.ok === 1 ? "" : "s"}${
                emFoco.falha > 0 ? ` · ${emFoco.falha} sem entrar` : ""
              }`
            : `${total} em 14 dias`}
        </span>
      </div>

      <div className="flex gap-2">
        <div className="flex h-32 w-7 shrink-0 flex-col justify-between text-right text-[10px] tabular-nums text-zinc-400 dark:text-zinc-500">
          <span>{teto}</span>
          <span>{teto / 2}</span>
          <span>0</span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="relative h-32">
            {/* Grade em hairline sólido, recessiva */}
            <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-px w-full bg-zinc-200 dark:bg-zinc-800" />
              ))}
            </div>

            {/* A coluna inteira é o alvo do cursor, não só a barra: alvo de
                hover bem maior que a marca, e o dia de altura zero também
                responde. */}
            <div className="absolute inset-0 flex items-end">
              {dados.map((d, i) => {
                const altura = ((d.ok + d.falha) / teto) * 100;
                return (
                  <button
                    key={d.dia}
                    type="button"
                    onMouseEnter={() => setAtivo(i)}
                    onMouseLeave={() => setAtivo(null)}
                    onFocus={() => setAtivo(i)}
                    onBlur={() => setAtivo(null)}
                    aria-label={`${mesCurto(d.dia)}: ${d.ok} virou lead, ${d.falha} não entrou`}
                    className={`flex h-full min-w-0 flex-1 cursor-default flex-col justify-end rounded-sm outline-none transition-colors ${
                      ativo === i ? "bg-zinc-900/[0.04] dark:bg-zinc-100/[0.06]" : ""
                    }`}
                  >
                    {/* max-w-6 (24px) é o teto da marca: a sobra da faixa vira
                        ar, que é o que separa uma barra da vizinha — nada de
                        contorno. Dentro da pilha, `flex` proporcional em vez de
                        altura em %, senão o vão de 2px entre as faixas somaria
                        à altura e a barra passaria do valor. */}
                    <span
                      className="mx-auto flex w-full max-w-6 flex-col gap-[2px]"
                      style={{ height: `${altura}%` }}
                      aria-hidden="true"
                    >
                      {d.falha > 0 && (
                        <span
                          className="min-h-[3px] rounded-t-[4px]"
                          style={{
                            flex: `${d.falha} 1 0`,
                            background: "var(--serie-erro)",
                          }}
                        />
                      )}
                      {d.ok > 0 && (
                        <span
                          className={`min-h-[3px] ${d.falha > 0 ? "" : "rounded-t-[4px]"}`}
                          style={{
                            flex: `${d.ok} 1 0`,
                            background: "var(--serie-ok)",
                          }}
                        />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-1 flex">
            {dados.map((d) => (
              <span
                key={d.dia}
                className="min-w-0 flex-1 text-center text-[9px] tabular-nums text-zinc-400 dark:text-zinc-500"
              >
                {diaCurto(d.dia)}
              </span>
            ))}
          </div>
        </div>
      </div>

      <table className="sr-only">
        <caption>Recebimentos por dia</caption>
        <thead>
          <tr>
            <th scope="col">Dia</th>
            <th scope="col">Virou lead</th>
            <th scope="col">Não entrou</th>
          </tr>
        </thead>
        <tbody>
          {dados.map((d) => (
            <tr key={d.dia}>
              <th scope="row">{mesCurto(d.dia)}</th>
              <td>{d.ok}</td>
              <td>{d.falha}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
