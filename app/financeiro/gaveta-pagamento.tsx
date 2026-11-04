"use client";

// A gaveta do pagamento, que abre POR CIMA da folha (2026-11-04, "onde for
// para editar algo ao clicar abre toggle por cima"), no Editar de cada linha e
// no "Adicionar colaborador" do topo. Usa a casca das gavetas do CRM
// (app/components/gaveta.tsx).
//
//   · Adicionar: primeiro a lista de quem está no app de ponto e ainda não tem
//     cadastro na folha; escolhida a pessoa, o formulário. Só entra quem está no
//     app de ponto: a folha se liga pelo id de lá e não guarda nome.
//   · Editar: o formulário direto, em três blocos (quem ele é na folha, como
//     recebe no mês, os lançamentos do mês) e a conta do mês embaixo, que
//     acompanha o que se digita pela mesma `contaDoMes` do servidor.
//
// Salvar grava a foto do mês aberto (mês já lançado também se corrige, com o
// aviso); o padrão do colaborador só muda quando o mês é o corrente ou um
// futuro (`mudaPadrao`, lib/financeiro-pagamentos.ts). Enter salva, Esc fecha.
//
// O DESLOCAMENTO é a taxa diária × os dias presenciais do mês no ponto. Taxa
// vazia = não recebe.
import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { contaDoMes, lerReais, paraCampo, reais, type TipoPagamento } from "@/lib/financeiro-tipos";
import { AlertCircle, Check, Loader2, Lock, Search, X } from "@/app/components/icones";
import { BOTAO_PRIMARIO, BOTAO_SECUNDARIO, BotaoIcone, CascaGaveta, CorpoGaveta } from "@/app/components/gaveta";
import { salvarLinhaDaFolha } from "./acoes";
import { AlternarTipo, CampoReais } from "./campos";
import { endereco, horas } from "./comum";
import type { LinhaFolha } from "./tabela-da-folha";

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

function Bloco({ titulo, nota, children }: { titulo: string; nota?: string; children: ReactNode }) {
  return (
    <div className="border-t border-zinc-100 pt-4 first:border-t-0 first:pt-0 dark:border-zinc-800">
      <p className="text-[11.5px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{titulo}</p>
      {nota && <p className="mt-0.5 text-[11.5px] leading-snug text-zinc-500 dark:text-zinc-400">{nota}</p>}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function LinhaDaConta({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[12.5px] text-zinc-600 dark:text-zinc-400">
        {rotulo}
        {detalhe && <span className="ml-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">{detalhe}</span>}
      </span>
      <span className="text-[13px] tabular-nums text-zinc-800 dark:text-zinc-200">{valor}</span>
    </div>
  );
}

export default function GavetaPagamento({
  mes,
  mesNome,
  linha,
  candidatos,
  setores,
  mudaPadrao,
  aguardando,
  aoFechar,
  aoSalvar,
}: {
  mes: string;
  mesNome: string;
  /** Quem se edita; null = "Adicionar colaborador" (escolher entre os `candidatos`). */
  linha: LinhaFolha | null;
  candidatos: LinhaFolha[];
  setores: string[];
  /** O mês aberto é o corrente ou um futuro: salvar também muda o padrão do colaborador. */
  mudaPadrao: boolean;
  /** Salvou e espera a folha nova do servidor para fechar (./area-da-folha.tsx). */
  aguardando: boolean;
  aoFechar: () => void;
  aoSalvar: (pessoaId: string) => void;
}) {
  const [escolhida, setEscolhida] = useState<LinhaFolha | null>(linha);
  const mesMinusculo = mesNome.toLowerCase();

  // Esc fecha, de qualquer ponto da gaveta.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") aoFechar();
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  return (
    <CascaGaveta rotulo={escolhida ? `Pagamento de ${escolhida.pessoa.nome}` : "Adicionar colaborador"} aoFechar={aoFechar} largura="w-[44rem]">
      <header className="shrink-0 border-b border-zinc-100 px-5 pb-3 pt-4 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <h2 className="truncate text-[15px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{escolhida ? escolhida.pessoa.nome : "Adicionar colaborador"}</h2>
          {escolhida?.daFoto && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              <Lock className="size-2.5" aria-hidden="true" />
              lançado
            </span>
          )}
          <BotaoIcone Icone={X} rotulo="Fechar" onClick={aoFechar} className="-mr-2 ml-auto" />
        </div>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[12px] text-zinc-500 dark:text-zinc-400">
          {escolhida ? (
            <>
              <span>
                Pagamento de {mesMinusculo} · {horas(escolhida.minutos)} no ponto
              </span>
              <Link href={`${endereco(mes, escolhida.pessoa.id)}#ponto`} onClick={aoFechar} className="text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-300">
                Ver o ponto
              </Link>
            </>
          ) : (
            "Quem está no app de ponto e ainda não tem cadastro na folha."
          )}
        </p>
      </header>

      {escolhida ? (
        <FormularioPagamento
          key={escolhida.pessoa.id}
          mes={mes}
          mesMinusculo={mesMinusculo}
          linha={escolhida}
          setores={setores}
          mudaPadrao={mudaPadrao}
          aguardando={aguardando}
          aoCancelar={aoFechar}
          aoSalvar={aoSalvar}
        />
      ) : (
        <EscolherColaborador candidatos={candidatos} aoEscolher={setEscolhida} />
      )}
    </CascaGaveta>
  );
}

/** "Adicionar colaborador": a busca na lista de quem ainda não está na folha. */
function EscolherColaborador({ candidatos, aoEscolher }: { candidatos: LinhaFolha[]; aoEscolher: (l: LinhaFolha) => void }) {
  const [busca, setBusca] = useState("");
  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  const lista = candidatos.filter((c) => !termo || c.pessoa.nome.toLocaleLowerCase("pt-BR").includes(termo));

  return (
    <CorpoGaveta>
      <div className="px-5 pt-4">
        {candidatos.length === 0 ? (
          <p className="text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            Todos do app de ponto já têm cadastro na folha. Gente nova é cadastrada no app de ponto e aparece aqui.
          </p>
        ) : (
          <>
            <label className="relative block">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pelo nome" aria-label="Buscar colaborador" autoFocus className={`${campoTexto} pl-8`} />
            </label>
            <ul className="mt-3 flex flex-col">
              {lista.map((c) => (
                <li key={c.pessoa.id}>
                  <button
                    type="button"
                    onClick={() => aoEscolher(c)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
                  >
                    <span className="truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-100">{c.pessoa.nome}</span>
                    <span className="shrink-0 text-[11.5px] tabular-nums text-zinc-400 dark:text-zinc-500">{c.minutos ? `${horas(c.minutos)} no mês` : "sem ponto no mês"}</span>
                  </button>
                </li>
              ))}
              {lista.length === 0 && <li className="px-2.5 py-2 text-[13px] text-zinc-500 dark:text-zinc-400">Ninguém com esse nome.</li>}
            </ul>
          </>
        )}
      </div>
    </CorpoGaveta>
  );
}

function FormularioPagamento({
  mes,
  mesMinusculo,
  linha,
  setores,
  mudaPadrao,
  aguardando,
  aoCancelar,
  aoSalvar,
}: {
  mes: string;
  mesMinusculo: string;
  linha: LinhaFolha;
  setores: string[];
  mudaPadrao: boolean;
  aguardando: boolean;
  aoCancelar: () => void;
  aoSalvar: (pessoaId: string) => void;
}) {
  const v = linha.valores;
  const [f, setF] = useState({
    setor: linha.setor ?? "",
    atividade: linha.atividade ?? "",
    pix: linha.pix ?? "",
    tipo: (v?.tipo ?? "hora") as TipoPagamento,
    valorHora: paraCampo(v?.valorHora ?? null),
    valorMes: paraCampo(v?.valorMes ?? null),
    taxa: paraCampo(v?.taxaDeslocamento ?? null),
    adicional: linha.adicional ? paraCampo(linha.adicional) : "",
    descontos: linha.descontos ? paraCampo(linha.descontos) : "",
  });
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, iniciar] = useTransition();
  const salvando = enviando || aguardando;
  const muda = (parcial: Partial<typeof f>) => setF((a) => ({ ...a, ...parcial }));

  const vh = lerReais(f.valorHora);
  const vm = lerReais(f.valorMes);
  const tx = lerReais(f.taxa);
  const ad = lerReais(f.adicional);
  const de = lerReais(f.descontos);
  const falta = [vh, vm, tx, ad, de].some((x) => x === undefined)
    ? "Algum valor não é um número em reais (ex.: 1.500,00)."
    : f.tipo === "hora" && vh === null
      ? "Falta o valor hora."
      : f.tipo === "fixo" && vm === null
        ? "Falta o valor mês."
        : null;
  const conta = useMemo(
    () => contaDoMes({ tipo: f.tipo, valorHora: vh ?? null, valorMes: vm ?? null, taxaDeslocamento: tx ?? null }, linha.minutos, linha.presencial, { adicional: ad ?? 0, descontos: de ?? 0 }),
    [f.tipo, vh, vm, tx, ad, de, linha.minutos, linha.presencial],
  );

  function salvar() {
    if (salvando) return;
    if (falta) return setErro(falta);
    setErro(null);
    iniciar(async () => {
      const r = await salvarLinhaDaFolha({
        mes,
        pessoaId: linha.pessoa.id,
        setor: f.setor,
        atividade: f.atividade,
        tipo: f.tipo,
        valorHora: vh,
        valorMes: vm,
        taxaDeslocamento: tx,
        pix: f.pix,
        adicional: ad,
        descontos: de,
      });
      if (!r.ok) return setErro(r.erro);
      aoSalvar(linha.pessoa.id);
    });
  }

  const notaDoMes = linha.daFoto
    ? `Valores gravados em ${mesMinusculo}: mudar outro mês não altera este.`
    : `${mesMinusculo.charAt(0).toUpperCase()}${mesMinusculo.slice(1)} ainda não foi lançado: vale o padrão do colaborador. Ao salvar, os valores ficam gravados neste mês.`;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(e) => {
        // Enter salva; no setor, Enter também escolhe a sugestão da lista, então lá não.
        if (e.key === "Enter" && e.target instanceof HTMLInputElement && !e.target.hasAttribute("list")) salvar();
      }}
    >
      {(linha.daFoto || mudaPadrao) && (
        <div className="flex shrink-0 flex-col gap-1 border-b border-zinc-100 bg-zinc-50/70 px-5 py-2.5 text-[12px] leading-snug dark:border-zinc-800 dark:bg-zinc-900/40">
          {linha.daFoto && (
            <p className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
              <Lock className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
              Você está alterando o lançamento de {mesMinusculo}. Os outros meses não mudam.
            </p>
          )}
          {mudaPadrao && <p className="text-zinc-500 dark:text-zinc-400">Salvar também muda o padrão do colaborador para os meses ainda não lançados.</p>}
        </div>
      )}

      <CorpoGaveta>
        <div className="flex flex-col gap-5 px-5 pt-4">
          <Bloco titulo="Colaborador">
            <Campo rotulo="Setor">
              <input value={f.setor} onChange={(e) => muda({ setor: e.target.value })} list="setores-folha" maxLength={80} placeholder="Ex.: Marketing" className={campoTexto} autoFocus />
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

          <Bloco titulo={`Como recebe em ${mesMinusculo}`} nota={notaDoMes}>
            <div className="sm:col-span-2">
              <AlternarTipo valor={f.tipo} aoMudar={(t) => muda({ tipo: t })} rotulo="Como recebe" />
            </div>
            <Campo rotulo="Valor hora" dica={f.tipo === "hora" ? "Entra na conta: horas do mês × valor hora." : "Guardado, mas fora da conta (recebe fixo)."}>
              <CampoReais valor={f.valorHora} aoMudar={(x) => muda({ valorHora: x })} rotulo="Valor hora" apagado={f.tipo === "fixo"} />
            </Campo>
            <Campo rotulo="Valor mês" dica={f.tipo === "fixo" ? "Entra na conta, trabalhe quanto trabalhar." : "Guardado, mas fora da conta (recebe por hora)."}>
              <CampoReais valor={f.valorMes} aoMudar={(x) => muda({ valorMes: x })} rotulo="Valor mês" apagado={f.tipo === "hora"} />
            </Campo>
            <Campo rotulo="Deslocamento por dia" dica={`Taxa diária × dias presenciais (${linha.presencial} em ${mesMinusculo}). Vazio: não recebe.`}>
              <CampoReais valor={f.taxa} aoMudar={(x) => muda({ taxa: x })} rotulo="Deslocamento por dia" />
            </Campo>
          </Bloco>

          <Bloco titulo={`Lançamentos de ${mesMinusculo}`}>
            <Campo rotulo="Adicional" dica="Ajuda de custo e outros valores do mês.">
              <CampoReais valor={f.adicional} aoMudar={(x) => muda({ adicional: x })} rotulo="Adicional" />
            </Campo>
            <Campo rotulo="Descontos">
              <CampoReais valor={f.descontos} aoMudar={(x) => muda({ descontos: x })} rotulo="Descontos" />
            </Campo>
          </Bloco>

          <div className="flex flex-col gap-2 rounded-xl bg-zinc-50 p-4 dark:bg-zinc-900/60">
            <p className="text-[11.5px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">A conta de {mesMinusculo}</p>
            <LinhaDaConta rotulo="Referência" valor={horas(linha.minutos)} detalhe="horas do mês no ponto" />
            <LinhaDaConta rotulo={f.tipo === "hora" ? "Horas × valor hora" : "Valor fixo do mês"} valor={conta.base === null ? "—" : reais(conta.base)} />
            <LinhaDaConta rotulo="+ Deslocamento" valor={reais(conta.deslocamento)} detalhe={tx ? `${linha.presencial} dias × ${reais(tx)}` : "não recebe"} />
            <LinhaDaConta rotulo="+ Adicional" valor={reais(conta.adicional)} />
            <LinhaDaConta rotulo="− Descontos" valor={reais(conta.descontos)} />
          </div>
        </div>
      </CorpoGaveta>

      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-zinc-100 px-5 py-3 dark:border-zinc-800">
        <div className="min-w-0">
          <p className="text-[11.5px] text-zinc-500 dark:text-zinc-400">Total do profissional</p>
          <p className="text-[18px] font-semibold tabular-nums tracking-tight text-zinc-900 dark:text-zinc-50">{conta.total === null ? "—" : reais(conta.total)}</p>
          {erro && (
            <p role="alert" className="mt-0.5 flex items-start gap-1.5 text-[12px] text-red-600 dark:text-red-400">
              <AlertCircle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
              {erro}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={aoCancelar} disabled={salvando} className={BOTAO_SECUNDARIO}>
            Cancelar
          </button>
          <button type="button" onClick={salvar} disabled={salvando} className={BOTAO_PRIMARIO}>
            {salvando ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : <Check className="size-3" aria-hidden="true" />}
            Salvar
          </button>
        </div>
      </footer>
    </div>
  );
}
