// O CSV da folha do mês (pedido dele, 2026-11-04: "um botão para exportar [...]
// um csv bem formatado com nomes, horas, adicional e valor total que a pessoa vai
// receber"). Montado no navegador com as MESMAS linhas, a mesma ordem por setor
// e a mesma conta da tabela (lib/financeiro-tipos.ts): sem rota nova, e o que
// sai no arquivo é o que a tela mostra.
//
// Uma linha por pessoa: nome, setor, tipo, horas do ponto, dias presenciais,
// deslocamento, adicional, descontos e o total a receber. Embaixo, a linha do
// total, somada como no resumo da folha (só quem tem valor).
//
// FEITO PARA O EXCEL E O GOOGLE PLANILHAS EM PORTUGUÊS: separador ";", valores
// com vírgula decimal e sem "R$" nem ponto de milhar (abrem como número e se
// somam), UTF-8 com BOM (acento certo ao abrir com dois cliques) e fim de linha
// CRLF. As horas vão como na tela ("152h30"). Sem cadastro, o total fica vazio;
// sem ponto, as horas e os dias também.
//
// INJEÇÃO DE CSV: o nome e o setor são digitados por gente. Texto que começa com
// = + - @ ganharia vida de fórmula na planilha, então leva um apóstrofo na frente.
import { contaDoMes } from "@/lib/financeiro-tipos";
import { horas } from "./comum";
import { agruparPorSetor, type LinhaFolha } from "./tabela-da-folha";

const SEPARADOR = ";";
const FIM_DE_LINHA = "\r\n";
const BOM = String.fromCharCode(0xfeff);

const CABECALHO = ["Nome", "Setor", "Tipo", "Horas", "Dias presenciais", "Deslocamento", "Adicional", "Descontos", "Total a receber"];

/** Célula de texto: sem cara de fórmula, entre aspas quando tem separador, aspas ou quebra de linha. */
function texto(v: string): string {
  const seguro = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[";\r\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

/** 1234.5 → "1234,50"; null → vazio. */
function valor(v: number | null): string {
  return v === null ? "" : v.toFixed(2).replace(".", ",");
}

function tipoDe(l: LinhaFolha): string {
  return !l.valores ? "Sem cadastro" : l.valores.tipo === "hora" ? "Por hora" : "Fixo";
}

/** O conteúdo do CSV (sem o BOM), na ordem da folha. */
export function csvDaFolha(linhas: LinhaFolha[]): string {
  const corpo: string[][] = [];
  const soma = { minutos: 0, deslocamento: 0, adicional: 0, descontos: 0, total: 0 };
  for (const [, doSetor] of agruparPorSetor(linhas)) {
    for (const l of doSetor) {
      const conta = contaDoMes(l.valores, l.minutos, l.presencial, l);
      const semPonto = l.origem !== "ponto";
      corpo.push([
        texto(l.pessoa.nome),
        texto(l.setor ?? ""),
        tipoDe(l),
        semPonto ? "" : horas(l.minutos),
        semPonto ? "" : String(l.presencial),
        valor(conta.deslocamento),
        valor(conta.adicional),
        valor(conta.descontos),
        valor(conta.total),
      ]);
      if (!semPonto) soma.minutos += l.minutos;
      if (conta.total !== null) {
        soma.deslocamento += conta.deslocamento;
        soma.adicional += conta.adicional;
        soma.descontos += conta.descontos;
        soma.total += conta.total;
      }
    }
  }
  const centavos = (v: number) => Math.round(v * 100) / 100;
  const total = ["Total", "", "", horas(soma.minutos), "", valor(centavos(soma.deslocamento)), valor(centavos(soma.adicional)), valor(centavos(soma.descontos)), valor(centavos(soma.total))];
  return [CABECALHO, ...corpo, total].map((c) => c.join(SEPARADOR)).join(FIM_DE_LINHA) + FIM_DE_LINHA;
}

/** Baixa "folha-AAAA-MM.csv" com a folha do mês. */
export function baixarCsvDaFolha(linhas: LinhaFolha[], mes: string): void {
  const arquivo = new Blob([BOM + csvDaFolha(linhas)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(arquivo);
  const link = document.createElement("a");
  link.href = url;
  link.download = `folha-${mes}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revogar na hora pode cortar o download em alguns navegadores.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
