"use client";

import { useCallback, useEffect, useState } from "react";

export async function consultar<T>(url: string, init?: RequestInit): Promise<T> {
  const resposta = await fetch(url, { cache: "no-store", ...init });
  const dados = await resposta.json();
  if (!resposta.ok) throw new Error(dados.erro || "Não foi possível carregar os dados.");
  return dados as T;
}

/**
 * GET com estado de carregamento. `manter`: enquanto a URL nova carrega, segue
 * devolvendo os dados da anterior — trocar o período não apaga a tela; os
 * números antigos ficam até os novos chegarem (quem chama mostra que está
 * carregando).
 */
export function useConsulta<T>(url: string | null, opcoes: { manter?: boolean } = {}) {
  const [estado, setEstado] = useState<{ url: string | null; dados: T | null; erro: string; carregando: boolean }>({ url, dados: null, erro: "", carregando: Boolean(url) });
  const [versao, setVersao] = useState(0);
  const atualizar = useCallback(async () => { setEstado(e => ({ ...e, carregando: true, erro: "" })); setVersao(v => v + 1); }, []);
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    consultar<T>(url, { signal: controller.signal }).then(
      dados => { if (!controller.signal.aborted) setEstado({ url, dados, erro: "", carregando: false }); },
      erro => { if (!controller.signal.aborted) setEstado(e => ({ url, dados: opcoes.manter ? e.dados : null, erro: erro instanceof Error ? erro.message : "Falha na consulta.", carregando: false })); },
    );
    return () => controller.abort();
  }, [url, versao, opcoes.manter]);
  const daUrl = estado.url === url;
  return {
    dados: daUrl || opcoes.manter ? estado.dados : null,
    erro: daUrl ? estado.erro : "",
    carregando: Boolean(url) && (!daUrl || estado.carregando),
    atualizar,
  };
}
