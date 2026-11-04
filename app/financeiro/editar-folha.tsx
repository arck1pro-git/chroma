"use client";

// O pagamento de um colaborador, na ficha dele (?pessoa=<id>), em três blocos:
// quem ele é na folha (setor, atividade, PIX), como recebe no mês aberto (tipo,
// valor hora, valor mês, taxa diária de deslocamento) e os lançamentos do mês
// (adicional e descontos). Ao lado, a conta do mês, que acompanha o que se
// digita pela mesma `contaDoMes` do servidor (lib/financeiro-tipos.ts).
//
// Salva sozinho (./campos.tsx), sem botão (2026-11-04). Grava a foto do mês
// aberto; o padrão do colaborador só muda quando o mês é o corrente ou um
// futuro (lib/financeiro-pagamentos.ts), e o aviso no bloco do meio diz isso.
//
// O DESLOCAMENTO é a taxa diária × os dias presenciais do mês no ponto. Taxa
// vazia = não recebe.
//
// Sem a permissão de editar, os campos ficam só para ler.
import { useMemo, useState, type ReactNode } from "react";
import { contaDoMes, lerReais, paraCampo, reais, type CadastroPagamento, type LancamentoMes, type TipoPagamento, type ValoresPagamento } from "@/lib/financeiro-tipos";
import { salvarLinhaDaFolha } from "./acoes";
import { AlternarTipo, CampoReais, IndicadorSalvamento, useSalvarSozinho } from "./campos";

const campoTexto =
  "w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-4 focus:ring-zinc-900/5 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:placeholder:text-zinc-600 dark:focus:border-zinc-500 dark:focus:ring-white/5";

function Campo({ rotulo, dica, children }: { rotulo: string; dica?: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="mb-1 block text-[12px] font-medium text-zinc-600 dark:text-zinc-400">{rotulo}</span>
      {children}
      {dica && <span className="mt-1 block text-[11px] leading-snug text-zinc-400 dark:text-zinc-500">{dica}</span>}
    </div>
  );
}

function Bloco({ titulo, nota, children }: { titulo: string; nota?: ReactNode; children: ReactNode }) {
  return (
    <div className="border-t border-zinc-100 pt-4 first:border-t-0 first:pt-0 dark:border-zinc-800">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{titulo}</p>
      {nota && <p className="mt-0.5 text-[11.5px] leading-snug text-zinc-500 dark:text-zinc-400">{nota}</p>}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function LinhaDaConta({ rotulo, valor, detalhe, forte = false }: { rotulo: string; valor: string; detalhe?: string; forte?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${forte ? "border-t border-zinc-200 pt-3 dark:border-zinc-800" : ""}`}>
      <span className={forte ? "text-[13px] font-semibold text-zinc-900 dark:text-zinc-50" : "text-[12.5px] text-zinc-600 dark:text-zinc-400"}>
        {rotulo}
        {detalhe && <span className="block text-[11px] font-normal text-zinc-400 dark:text-zinc-500">{detalhe}</span>}
      </span>
      <span className={`tabular-nums ${forte ? "text-[20px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50" : "text-[13px] text-zinc-800 dark:text-zinc-200"}`}>{valor}</span>
    </div>
  );
}

export default function EditarFolha({
  mes,
  mesNome,
  pessoaId,
  minutos,
  horasTexto,
  presencial,
  cadastro,
  valores,
  daFoto,
  lancamento,
  setores,
  podeEditar,
}: {
  mes: string;
  mesNome: string;
  pessoaId: string;
  minutos: number;
  horasTexto: string;
  /** Dias presenciais do mês no ponto: a base do deslocamento. */
  presencial: number;
  cadastro: CadastroPagamento | null;
  /** Os valores que valem no mês (a foto do mês ou o padrão do colaborador). */
  valores: ValoresPagamento | null;
  /** O mês já foi lançado (tem foto). */
  daFoto: boolean;
  lancamento: LancamentoMes;
  setores: string[];
  podeEditar: boolean;
}) {
  const inicial = {
    setor: cadastro?.setor ?? "",
    atividade: cadastro?.atividade ?? "",
    pix: cadastro?.pix ?? "",
    tipo: (valores?.tipo ?? "hora") as TipoPagamento,
    valorHora: paraCampo(valores?.valorHora ?? null),
    valorMes: paraCampo(valores?.valorMes ?? null),
    taxa: paraCampo(valores?.taxaDeslocamento ?? null),
    adicional: lancamento.adicional ? paraCampo(lancamento.adicional) : "",
    descontos: lancamento.descontos ? paraCampo(lancamento.descontos) : "",
  };
  const [f, setF] = useState(inicial);
  const [salvo, setSalvo] = useState(inicial);
  const [lancado, setLancado] = useState(daFoto);
  const muda = (parcial: Partial<typeof inicial>) => setF((a) => ({ ...a, ...parcial }));

  const vh = lerReais(f.valorHora);
  const vm = lerReais(f.valorMes);
  const tx = lerReais(f.taxa);
  const ad = lerReais(f.adicional);
  const de = lerReais(f.descontos);
  const invalido = [vh, vm, tx, ad, de].some((v) => v === undefined);
  const falta = invalido
    ? "Algum valor não é um número em reais (ex.: 1.500,00)."
    : f.tipo === "hora" && vh === null
      ? "Falta o valor hora para salvar."
      : f.tipo === "fixo" && vm === null
        ? "Falta o valor mês para salvar."
        : null;
  const mudou = (Object.keys(f) as Array<keyof typeof f>).some((k) => f[k] !== salvo[k]);
  const conta = useMemo(
    () => contaDoMes({ tipo: f.tipo, valorHora: vh ?? null, valorMes: vm ?? null, taxaDeslocamento: tx ?? null }, minutos, presencial, { adicional: ad ?? 0, descontos: de ?? 0 }),
    [f.tipo, vh, vm, tx, ad, de, minutos, presencial],
  );

  const { estado, erro, agora } = useSalvarSozinho({
    pronto: podeEditar && mudou && !falta,
    assinatura: JSON.stringify(f),
    espera: 1100,
    gravar: async () => {
      const enviado = f;
      const r = await salvarLinhaDaFolha({
        mes,
        pessoaId,
        setor: enviado.setor,
        atividade: enviado.atividade,
        tipo: enviado.tipo,
        valorHora: vh,
        valorMes: vm,
        taxaDeslocamento: tx,
        pix: enviado.pix,
        adicional: ad,
        descontos: de,
      });
      if (r.ok) {
        setSalvo(enviado);
        setLancado(true);
      }
      return r;
    },
  });

  const mesMinusculo = mesNome.toLowerCase();

  return (
    <section
      className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
      onBlur={(e) => {
        if (podeEditar && !e.currentTarget.contains(e.relatedTarget as Node | null)) void agora();
      }}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
        <h2 className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">Pagamento de {mesMinusculo}</h2>
        {podeEditar ? (
          <IndicadorSalvamento estado={estado} erro={erro} falta={mudou ? falta : null} />
        ) : (
          <span className="text-[11px] text-zinc-400 dark:text-zinc-500">só para ver: editar pede a permissão no módulo</span>
        )}
      </header>

      <div className="grid gap-6 p-5 lg:grid-cols-[1fr_300px]">
        <fieldset disabled={!podeEditar} className="flex min-w-0 flex-col gap-5">
          <Bloco titulo="Colaborador">
            <Campo rotulo="Setor">
              <input value={f.setor} onChange={(e) => muda({ setor: e.target.value })} list="setores-folha" maxLength={80} placeholder="Ex.: Marketing" className={campoTexto} />
              <datalist id="setores-folha">
                {setores.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </Campo>
            <Campo rotulo="Atividade principal">
              <input value={f.atividade} onChange={(e) => muda({ atividade: e.target.value })} maxLength={120} placeholder="Ex.: Editor de vídeo" className={campoTexto} />
            </Campo>
            <div className="sm:col-span-2">
              <Campo rotulo="Chave PIX">
                <input value={f.pix} onChange={(e) => muda({ pix: e.target.value })} maxLength={140} placeholder="CPF, e-mail, celular ou chave aleatória" className={campoTexto} />
              </Campo>
            </div>
          </Bloco>

          <Bloco
            titulo={`Como recebe em ${mesMinusculo}`}
            nota={
              lancado
                ? `Valores gravados em ${mesMinusculo}: mudar outro mês não altera este.`
                : `${mesNome} ainda não foi lançado: vale o padrão do colaborador. Ao salvar, os valores ficam gravados neste mês.`
            }
          >
            <div className="sm:col-span-2">
              <AlternarTipo valor={f.tipo} aoMudar={(t) => muda({ tipo: t })} rotulo="Como recebe" />
            </div>
            <Campo rotulo="Valor hora" dica={f.tipo === "hora" ? "Entra na conta: horas do mês × valor hora." : "Guardado, mas fora da conta (recebe fixo)."}>
              <CampoReais valor={f.valorHora} aoMudar={(v) => muda({ valorHora: v })} rotulo="Valor hora" apagado={f.tipo === "fixo"} />
            </Campo>
            <Campo rotulo="Valor mês" dica={f.tipo === "fixo" ? "Entra na conta, trabalhe quanto trabalhar." : "Guardado, mas fora da conta (recebe por hora)."}>
              <CampoReais valor={f.valorMes} aoMudar={(v) => muda({ valorMes: v })} rotulo="Valor mês" apagado={f.tipo === "hora"} />
            </Campo>
            <Campo rotulo="Deslocamento por dia" dica={`Taxa diária × dias presenciais (${presencial} em ${mesMinusculo}). Vazio: não recebe.`}>
              <CampoReais valor={f.taxa} aoMudar={(v) => muda({ taxa: v })} rotulo="Deslocamento por dia" />
            </Campo>
          </Bloco>

          <Bloco titulo={`Lançamentos de ${mesMinusculo}`}>
            <Campo rotulo="Adicional" dica="Ajuda de custo e outros valores do mês.">
              <CampoReais valor={f.adicional} aoMudar={(v) => muda({ adicional: v })} rotulo="Adicional" />
            </Campo>
            <Campo rotulo="Descontos">
              <CampoReais valor={f.descontos} aoMudar={(v) => muda({ descontos: v })} rotulo="Descontos" />
            </Campo>
          </Bloco>
        </fieldset>

        <aside className="flex h-fit flex-col gap-2.5 rounded-xl bg-zinc-50 p-4 lg:sticky lg:top-4 dark:bg-zinc-950/60">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">A conta de {mesMinusculo}</p>
          <LinhaDaConta rotulo="Referência" valor={horasTexto} detalhe="horas do mês no ponto" />
          <LinhaDaConta
            rotulo={f.tipo === "hora" ? "Horas × valor hora" : "Valor fixo do mês"}
            valor={conta.base === null ? "—" : reais(conta.base)}
          />
          <LinhaDaConta
            rotulo="+ Deslocamento"
            valor={reais(conta.deslocamento)}
            detalhe={tx ? `${presencial} dias presenciais × ${reais(tx)}` : "não recebe"}
          />
          <LinhaDaConta rotulo="+ Adicional" valor={reais(conta.adicional)} />
          <LinhaDaConta rotulo="− Descontos" valor={reais(conta.descontos)} />
          <LinhaDaConta rotulo="Total do profissional" valor={conta.total === null ? "—" : reais(conta.total)} forte />
        </aside>
      </div>
    </section>
  );
}
