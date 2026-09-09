"use client";

import { useState } from "react";
import type { ExecucaoNoDia } from "./dados";

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

function n1(v: number) {
  return Math.round(v * 10) / 10;
}

// ── Execuções por dia: duas linhas num eixo só ──────────────────────────────
// Um eixo, nunca dois: erro é ordem de grandeza menor que sucesso, e é isso
// mesmo que a linha colada na base deve comunicar. Segundo eixo mentiria sobre
// a proporção entre as séries.

export function ExecucoesPorDia({ dados }: { dados: ExecucaoNoDia[] }) {
  const [ativo, setAtivo] = useState<number | null>(null);

  const teto = tetoLimpo(Math.max(...dados.map((d) => d.sucesso + d.erro), 0));
  const total = dados.reduce((s, d) => s + d.sucesso + d.erro, 0);

  if (total === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-200 px-3 py-8 text-center text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
        Nenhuma execução no período
      </p>
    );
  }

  const passo = dados.length > 1 ? 100 / (dados.length - 1) : 0;
  const x = (i: number) => n1(i * passo);
  const y = (v: number) => n1(100 - (v / teto) * 100);
  const linha = (chave: "sucesso" | "erro") =>
    dados.map((d, i) => `${x(i)},${y(d[chave])}`).join(" ");

  const emFoco = ativo !== null ? dados[ativo] : null;

  return (
    <div className="viz">
      {/* Legenda sempre presente com 2 séries: identidade nunca depende só da
          cor. O texto usa token de tinta; quem carrega a identidade é o traço
          colorido ao lado. */}
      <div className="mb-3 flex items-center gap-4">
        <span className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
          <span
            className="h-0.5 w-3 rounded-full"
            style={{ background: "var(--serie-ok)" }}
            aria-hidden="true"
          />
          Sucesso
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
          <span
            className="h-0.5 w-3 rounded-full"
            style={{ background: "var(--serie-erro)" }}
            aria-hidden="true"
          />
          Erro
        </span>
        <span className="ml-auto text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">
          {emFoco
            ? `${mesCurto(emFoco.dia)} · ${emFoco.sucesso} ok${emFoco.erro > 0 ? ` · ${emFoco.erro} erro` : ""}`
            : `${total} execuções em 14 dias`}
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

            {/* preserveAspectRatio none deforma a geometria de propósito (o
                gráfico estica na largura); non-scaling-stroke mantém o traço em
                2px reais em qualquer largura. */}
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="absolute inset-0 size-full overflow-visible"
              aria-hidden="true"
            >
              <polyline
                points={linha("sucesso")}
                fill="none"
                stroke="var(--serie-ok)"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              <polyline
                points={linha("erro")}
                fill="none"
                stroke="var(--serie-erro)"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>

            {/* Crosshair + pontos do dia sob o cursor. Em HTML e não no SVG
                para o ponto não virar elipse com o preserveAspectRatio none. */}
            {emFoco && ativo !== null && (
              <>
                <div
                  className="pointer-events-none absolute top-0 h-full w-px bg-zinc-300 dark:bg-zinc-600"
                  style={{ left: `${x(ativo)}%` }}
                  aria-hidden="true"
                />
                {(["sucesso", "erro"] as const).map((k) => (
                  <div
                    key={k}
                    className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white dark:ring-zinc-950"
                    style={{
                      left: `${x(ativo)}%`,
                      top: `${y(emFoco[k])}%`,
                      background:
                        k === "sucesso" ? "var(--serie-ok)" : "var(--serie-erro)",
                    }}
                    aria-hidden="true"
                  />
                ))}
              </>
            )}

            {/* Faixas de captura: alvo de hover bem maior que a marca. */}
            <div className="absolute inset-0 flex">
              {dados.map((d, i) => (
                <button
                  key={d.dia}
                  type="button"
                  onMouseEnter={() => setAtivo(i)}
                  onMouseLeave={() => setAtivo(null)}
                  onFocus={() => setAtivo(i)}
                  onBlur={() => setAtivo(null)}
                  aria-label={`${mesCurto(d.dia)}: ${d.sucesso} com sucesso, ${d.erro} com erro`}
                  className="h-full min-w-0 flex-1 cursor-default outline-none focus-visible:bg-zinc-900/5 dark:focus-visible:bg-zinc-100/5"
                />
              ))}
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
        <caption>Execuções por dia</caption>
        <thead>
          <tr>
            <th scope="col">Dia</th>
            <th scope="col">Sucesso</th>
            <th scope="col">Erro</th>
          </tr>
        </thead>
        <tbody>
          {dados.map((d) => (
            <tr key={d.dia}>
              <th scope="row">{mesCurto(d.dia)}</th>
              <td>{d.sucesso}</td>
              <td>{d.erro}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
