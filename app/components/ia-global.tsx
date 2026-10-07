"use client";

// O PAINEL FIXO de IA do TI: um botão só, no mesmo canto, em TODAS as telas.
//
// Pedido de 2026-10-06 ("no TI o botão de IA fica sempre ali sem sair"), logo
// depois do modo completo (lib/ia/completa.ts): se a IA do TI faz tudo de
// qualquer tela, ela tem que ESTAR em qualquer tela — inclusive nas que não
// tinham IA (Chat, Agenda, Vídeos…) — e não pode fechar ao trocar de aba.
//
// Por que mora no layout raiz: o layout não remonta na navegação, então o
// painel, a conversa aberta e uma resposta chegando atravessam a troca de tela.
// Um painel por página (como era) desmonta a cada clique na barra.
//
// As telas que já tinham IA continuam renderizando o <ChatIa> delas; para o TI
// ele não se desenha e só REGISTRA aqui o que está na tela (a frase, o fluxo
// aberto, o que recarregar) — ver chat-ia.tsx. Vale o último registrado: a
// cadência aberta por cima do dashboard ganha do dashboard, e ao fechar volta.
//
// Para quem não é o TI, este provedor não faz nada: devolve as telas como
// estão, e cada uma tem o painel dela como sempre.
import { Suspense, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MODULOS } from "@/lib/auth/modulos";
import { PainelIa } from "./chat-ia";
import { IaFixa, type CanalIaFixa, type RegistroIa } from "./ia-global-contexto";

/** "Vídeos", "Dashboard"… — o módulo da rota, para a frase de contexto. */
function nomeDaTela(caminho: string) {
  const modulo =
    caminho === "/"
      ? MODULOS.find((m) => m.href === "/")
      : MODULOS.filter((m) => m.href !== "/" && caminho.startsWith(m.href)).sort(
          (a, b) => b.href.length - a.href.length,
        )[0];
  return modulo?.rotulo ?? caminho;
}

export default function ProvedorIaGlobal({
  ativa,
  children,
}: {
  ativa: boolean;
  children: React.ReactNode;
}) {
  // Map e não lista: atualizar um registro (a frase da tela mudou) mantém a
  // posição dele — quem abriu por último continua por último.
  const [registros, setRegistros] = useState<Map<string, RegistroIa>>(() => new Map());
  const canal = useMemo<CanalIaFixa>(
    () => ({
      registrar: (id, registro) => setRegistros((atual) => new Map(atual).set(id, registro)),
      remover: (id) =>
        setRegistros((atual) => {
          if (!atual.has(id)) return atual;
          const novo = new Map(atual);
          novo.delete(id);
          return novo;
        }),
    }),
    [],
  );

  if (!ativa) return <>{children}</>;

  const topo = [...registros.values()].at(-1) ?? null;
  return (
    <IaFixa.Provider value={canal}>
      {children}
      {/* useSearchParams (o ?ia= da barra) pede fronteira de Suspense nas rotas
          estáticas — o mesmo motivo da barra lateral no layout. */}
      <Suspense fallback={null}>
        <PainelFixo topo={topo} />
      </Suspense>
    </IaFixa.Provider>
  );
}

function PainelFixo({ topo }: { topo: RegistroIa | null }) {
  const caminho = usePathname();
  const router = useRouter();
  const conversaPedida = useSearchParams().get("ia");

  // A página do vídeo é do LEAD (app/v): lá não há nada do CRM.
  if (caminho.startsWith("/v/") || caminho === "/login") return null;

  return (
    <PainelIa
      global
      endpoint="/api/ia"
      // Conversa nova do painel fixo: escopo próprio. A barra mostra como
      // "CRM" (lib/ia/navegacao.ts) e, para o TI, reabre aqui mesmo.
      escopo="geral"
      titulo="IA do Chroma"
      rotulo="Conversar com a IA"
      dica="Analisa os dados, monta cadência e automação, campanha e captação — de qualquer tela. A conversa continua aberta quando você troca de aba."
      sugestoes={[
        "Resuma o funil em 3 linhas",
        "Crie a cadência da primeira etapa com 3 mensagens",
        "Quais captações receberam lead esta semana?",
      ]}
      campo="Peça uma análise, uma cadência, uma automação…"
      contexto={topo?.contexto ?? `tela ${nomeDaTela(caminho)}`}
      extra={topo?.extra}
      aoAplicar={topo?.aoAplicar ?? (() => router.refresh())}
      conversaInicial={conversaPedida}
      // Acima do painel de cadência (z-200/201), abaixo das fichas e gavetas
      // (z-300): com um modal de verdade aberto, o véu dele cobre o botão.
      camada="z-[210]"
      usaContextos
      // Sem painel: só os balões sobre a página, como a IA do dashboard era
      // antes do fixo (pedido dele, 2026-10-06). As conversas antigas e a nova
      // ficam na barra lateral (?ia= e o "+", que chegam aqui).
      compacto
    />
  );
}
