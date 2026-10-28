"use client";

// O "Montar com IA" do construtor de campanhas de WhatsApp (pedido dele,
// 2026-10-28: "falo o nome do template e a IA monta como quero, via chat").
// Mora dentro do editor (fluxo/editor-campanha.tsx), na campanha nova e na
// pausada ou rascunho em edição. A IA não grava nada: devolve o fluxo inteiro
// num evento (EVENTO_DESENHO, lib/campanhas-fluxo.ts), e quem aplica no
// canvas, com Desfazer, é o editor. Até 2026-10-28 este chat ficava na lista e
// gravava um rascunho no banco.
//
// `proprio`: também para o TI, que tem o painel fixo (app/components/
// ia-global.tsx). O fixo fala com /api/ia e não conhece o desenho; este fala
// com /api/ia/campanhas e leva o fluxo aberto. Sem o botão flutuante, que
// dividiria o canto com o do fixo: abre e fecha pelo botão da barra do editor.
//
// Coluna à esquerda do canvas, no lugar da paleta (lateral + compacto), e não
// flutuando por cima: flutuando, cobria justamente o desenho que a IA acabou
// de fazer (conferido em 1024x768, 2026-10-28). Enquanto se conversa, a
// paleta não tem uso.
import { respostasRapidasDe, type TemplateWhatsApp } from "@/lib/templates-whatsapp";
import ChatIa from "../components/chat-ia";

/** Os exemplos de pedido, com os templates aprovados da conta quando há. */
function sugestoesPara(templates: TemplateWhatsApp[]): string[] {
  const aprovados = templates.filter((t) => t.status === "APPROVED");
  const comBotao = aprovados.find((t) => respostasRapidasDe(t).length > 0);
  const primeiro = comBotao ?? aprovados[0];
  if (!primeiro)
    return ["Use o template X, espere 1 dia; quem clicar em “Quero saber mais” vira oportunidade e avise a equipe; quem não responder recebe o template Y"];
  const botao = comBotao ? respostasRapidasDe(comBotao)[0] : null;
  const outro = aprovados.find((t) => t.nome !== primeiro.nome);
  return [
    `Use o template ${primeiro.nome}, espere 1 dia; ${botao ? `quem clicar em “${botao}”` : "quem responder"} vira oportunidade e avise a equipe${
      outro ? `; quem não responder recebe o template ${outro.nome}` : ""
    }`,
    `Com o template ${primeiro.nome}: quem responder conta como conversão; quem não responder em 2 dias ganha uma tag`,
  ];
}

export default function IaCampanhas({
  campanhaId,
  aberta,
  mudarAberta,
  contexto,
  extra,
  templates,
  aoEvento,
}: {
  /** A campanha salva em edição; null na nova. Separa as conversas guardadas por campanha. */
  campanhaId: string | null;
  aberta: boolean;
  mudarAberta: (aberta: boolean) => void;
  contexto: string;
  /** O contrato com /api/ia/campanhas: construtor, fluxo (sem posições), waba e campanha. */
  extra: Record<string, string>;
  templates: TemplateWhatsApp[];
  aoEvento: (t: string, v: unknown) => void;
}) {
  return (
    <ChatIa
      proprio
      endpoint="/api/ia/campanhas"
      // Uma lista de conversas por campanha: o que foi dito sobre outra
      // campanha não vira histórico desta. A nova não tem id ainda.
      escopo={campanhaId ? `campanhas-construtor:${campanhaId}` : "campanhas-construtor"}
      titulo="Montar com IA"
      rotulo="Montar campanha com IA"
      dica="Diga o template, quanto esperar e o que fazer com cada resposta. A IA desenha no canvas; nada sai antes de você revisar e ativar."
      sugestoes={sugestoesPara(templates)}
      // Curto: a coluna tem 320px e o campo nasce numa linha.
      campo="Diga o template e o que fazer…"
      contexto={contexto}
      extra={extra}
      aoEvento={aoEvento}
      modo="lateral"
      compacto
      sugestoesNoCompacto
      botaoFlutuante={false}
      aberto={aberta}
      aoAbrirOuFechar={mudarAberta}
    />
  );
}
