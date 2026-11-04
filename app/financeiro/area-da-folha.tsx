"use client";

// O topo do Financeiro (2026-11-04): o cabeçalho da página, com o mês e o
// "Adicionar colaborador", a folha do mês logo abaixo e a gaveta do pagamento,
// que abre por cima no Editar de uma linha ou no Adicionar
// (./gaveta-pagamento.tsx). Mora aqui o estado de qual gaveta está aberta,
// porque o botão do cabeçalho e as linhas da tabela abrem a mesma.
//
// Salvar na gaveta recarrega a página pelo servidor (revalidatePath). A gaveta
// fica em "Salvando…" até a folha nova chegar; aí fecha, e a linha salva mostra
// "Salvo" um instante, já com os números novos.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { UserPlus } from "@/app/components/icones";
import { CabecalhoFinanceiro } from "./comum";
import GavetaPagamento from "./gaveta-pagamento";
import TabelaDaFolha, { type LinhaFolha } from "./tabela-da-folha";

/** A gaveta aberta no "Adicionar colaborador" (as outras levam o id da pessoa). */
const NOVO = "novo";

export default function AreaDaFolha({
  mes,
  mesNome,
  linhas,
  fora,
  setores,
  mudaPadrao,
  podeEditar,
  legenda,
  navegacao,
}: {
  mes: string;
  mesNome: string;
  /** Quem bateu ponto no mês ou tem cadastro na folha. */
  linhas: LinhaFolha[];
  /** Quem está no app de ponto sem ponto no mês e sem cadastro (só aparece no Adicionar). */
  fora: LinhaFolha[];
  setores: string[];
  mudaPadrao: boolean;
  podeEditar: boolean;
  legenda: ReactNode;
  navegacao: ReactNode;
}) {
  const [aberta, setAberta] = useState<string | null>(null);
  const [salva, setSalva] = useState<string | null>(null);
  // A gaveta salvou e espera a folha nova do servidor (revalidatePath), que chega
  // um instante depois da resposta da ação: fechar antes mostrava "Salvo" com o
  // número antigo na linha.
  const [aguardando, setAguardando] = useState<string | null>(null);
  const [linhasVistas, setLinhasVistas] = useState(linhas);
  const fechar = useCallback(() => setAberta(null), []);

  // A folha nova chegou: aí sim fecha a gaveta e marca a linha.
  if (linhas !== linhasVistas) {
    setLinhasVistas(linhas);
    if (aguardando) {
      setAberta(null);
      setSalva(aguardando);
      setAguardando(null);
    }
  }

  // Se a folha nova não vier (rede), fecha assim mesmo.
  useEffect(() => {
    if (!aguardando) return;
    const t = setTimeout(() => {
      setAberta(null);
      setAguardando(null);
    }, 8000);
    return () => clearTimeout(t);
  }, [aguardando]);

  useEffect(() => {
    if (!salva) return;
    const t = setTimeout(() => setSalva(null), 2500);
    return () => clearTimeout(t);
  }, [salva]);

  // No Adicionar: todo mundo do app de ponto que ainda não tem cadastro na folha.
  const candidatos = useMemo(
    () => [...linhas.filter((l) => !l.temCadastro), ...fora].sort((a, b) => a.pessoa.nome.localeCompare(b.pessoa.nome, "pt-BR")),
    [linhas, fora],
  );
  const linhaAberta = aberta && aberta !== NOVO ? (linhas.find((l) => l.pessoa.id === aberta) ?? fora.find((l) => l.pessoa.id === aberta) ?? null) : null;

  return (
    <>
      <CabecalhoFinanceiro
        legenda={legenda}
        navegacao={navegacao}
        acoes={
          podeEditar && (
            <button
              type="button"
              onClick={() => setAberta(NOVO)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-2 text-[13px] font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              <UserPlus className="size-3.5" aria-hidden="true" />
              Adicionar colaborador
            </button>
          )
        }
      />

      <TabelaDaFolha mes={mes} mesNome={mesNome} linhas={linhas} salva={salva} podeEditar={podeEditar} aoEditar={setAberta} />

      {aberta && (aberta === NOVO || linhaAberta) && (
        <GavetaPagamento
          key={aberta}
          mes={mes}
          mesNome={mesNome}
          linha={linhaAberta}
          candidatos={candidatos}
          setores={setores}
          mudaPadrao={mudaPadrao}
          aguardando={aguardando !== null}
          aoFechar={fechar}
          aoSalvar={setAguardando}
        />
      )}
    </>
  );
}
