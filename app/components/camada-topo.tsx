"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

// Camada de cima: o que precisa ficar SOBRE a tela inteira — a gaveta de
// contatos e a ficha da oportunidade — sai da árvore da página e vai direto
// para o <body>.
//
// POR QUE PORTAL, e não só um z-index maior: dentro da árvore da página, a
// camada de uma gaveta depende de cada ancestral dela. Qualquer ancestral que
// vire contexto de empilhamento (transform, opacidade animada, filtro) prende o
// z-index lá dentro — foi o que aconteceu quando as animações de entrada
// seguravam o estado final (`fill: both`, ver .surge em app/globals.css), e a
// gaveta passou a dividir camada com os cartões de fundo. No <body> ela não tem
// ancestral nenhum para herdar esse problema, e fica acima do painel de
// subetapas (z-[200]) e do chat da cadência (z-[210]), que moram na página.
//
// Escala das camadas no <body> (acima de tudo que existe nas telas, cujo teto
// é o z-[210] do chat da cadência):
//   z-[300]  véu das gavetas
//   z-[310]  gaveta
//   z-[320]  modal aberto DE DENTRO de uma gaveta (FormContato)
//
// Sem `document` no servidor: o snapshot do servidor é false e o portal só
// monta depois da hidratação. Assim a ficha aberta por ?op= não quebra o SSR
// nem gera divergência de hidratação.
const semAssinatura = () => () => {};

export default function CamadaTopo({ children }: { children: React.ReactNode }) {
  const noCliente = useSyncExternalStore(
    semAssinatura,
    () => true,
    () => false,
  );
  return noCliente ? createPortal(children, document.body) : null;
}
