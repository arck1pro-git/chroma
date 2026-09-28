// O /chat com dados fictícios (app/mock/chat.json), para olhar a tela com
// volume sem gravar nada no banco. Só em desenvolvimento e só com ?demo=1 —
// page.tsx recusa em produção.
//
// Devolve EXATAMENTE o tipo da consulta real (DadosChat): voltar para o banco é
// não passar o parâmetro. As mesmas regras da consulta estão aqui (filtro por
// canal, não lidas, janela de 24h, última mensagem), escritas sobre arrays.
import dadosMock from "../mock/chat.json";
import { tomDaEtapa } from "@/lib/cores-funil";
import type { Contato, Etapa, Oportunidade } from "../data";
import type { CanalChat, ConversaResumo, DadosChat, MensagemChat } from "./tipos";

const fim8 = (n: string | null | undefined) => (n ?? "").replace(/\D/g, "").slice(-8);

export function carregarChatDemo({
  canal,
  atendimentoId,
  usuarioId,
}: {
  canal: string;
  atendimentoId: string | null;
  usuarioId: string;
}): DadosChat {
  // Desloca todas as datas para a mais recente cair em "agora".
  const deslocamento = Date.now() - Date.parse(dadosMock.base) - 2 * 60_000;
  const quando = (iso: string | null) =>
    iso ? new Date(Date.parse(iso) + deslocamento).toISOString().replace(/\.\d{3}Z$/, "Z") : null;
  const dono = (id: string | null) => (id === "EU" ? usuarioId : id);

  const mensagens: MensagemChat[] = dadosMock.mensagens.map((m) => ({
    id: m.id,
    atendimento_id: m.atendimento_id,
    origem: m.origem as MensagemChat["origem"],
    autor_id: dono(m.autor_id),
    texto: m.texto,
    status: m.status as MensagemChat["status"],
    erro: ("erro" in m ? (m.erro as string) : null) ?? null,
    enviada_por: (m.enviada_por ?? null) as MensagemChat["enviada_por"],
    id_externo: null,
    data_criacao: quando(m.data_criacao)!,
    tipo: m.tipo as MensagemChat["tipo"],
    documento_id: null,
    midia_estado: "ausente",
    midia_mime: null,
    midia_nome: null,
    midia_tamanho: null,
    midia_duracao: null,
    midia_erro: null,
  }));

  const contatoPorId = new Map(dadosMock.contatos.map((c) => [c.id, c]));

  const resumos: ConversaResumo[] = dadosMock.atendimentos.map((a) => {
    const daConversa = mensagens.filter((m) => m.atendimento_id === a.id);
    const ultima = daConversa.at(-1) ?? null;
    const lidoEm = quando(a.lido_em);
    const doContato = daConversa.filter((m) => m.origem === "contato");
    const ultimaEntrada = doContato.at(-1)?.data_criacao ?? null;
    const contato = contatoPorId.get(a.contato_id);
    return {
      id: a.id,
      contato_id: a.contato_id,
      contato_nome: contato?.nome ?? "?",
      contato_whatsapp: contato?.whatsapp ?? null,
      responsavel_id: dono(a.responsavel_id),
      status: a.status as ConversaResumo["status"],
      canal: a.canal as ConversaResumo["canal"],
      numero_instancia: a.numero_instancia,
      data_criacao: quando(a.data_criacao)!,
      nao_lidas: doContato.filter((m) => !lidoEm || m.data_criacao > lidoEm).length,
      ultima: ultima
        ? {
            texto: ultima.texto,
            tipo: ultima.tipo,
            origem: ultima.origem,
            status: ultima.status,
            enviada_por: ultima.enviada_por,
            data: ultima.data_criacao,
          }
        : null,
      janela_ate: ultimaEntrada
        ? new Date(Date.parse(ultimaEntrada) + 24 * 3600_000).toISOString().replace(/\.\d{3}Z$/, "Z")
        : null,
    };
  });

  const ordenadas = [...resumos].sort((a, b) =>
    (b.ultima?.data ?? b.data_criacao).localeCompare(a.ultima?.data ?? a.data_criacao),
  );
  const alvo = canal ? fim8(canal) : null;
  const conversas = alvo ? ordenadas.filter((c) => fim8(c.numero_instancia) === alvo) : ordenadas;

  const canais: CanalChat[] = dadosMock.canais.map((c) => {
    const doCanal = resumos.filter((r) => fim8(r.numero_instancia) === fim8(c.chave) && r.status !== "encerrado");
    return {
      chave: c.chave,
      tipo: c.tipo as CanalChat["tipo"],
      nome: c.nome,
      perfil: c.perfil,
      numero: c.chave,
      foto: null,
      estado: c.estado as CanalChat["estado"],
      naoLidas: doCanal.filter((r) => r.nao_lidas > 0).length,
      naFila: doCanal.filter((r) => r.status === "na_fila").length,
    };
  });

  const resumoAberto = atendimentoId ? resumos.find((r) => r.id === atendimentoId) : undefined;
  const aberta = resumoAberto
    ? {
        id: resumoAberto.id,
        resumo: resumoAberto,
        contato: contatoPorId.get(resumoAberto.contato_id) as unknown as Contato,
        mensagens: mensagens.filter((m) => m.atendimento_id === resumoAberto.id),
        oportunidades: dadosMock.oportunidades
          .filter((o) => o.contato_id === resumoAberto.contato_id)
          .map((o) => ({ ...o, responsavel_id: dono(o.responsavel_id) })) as unknown as Oportunidade[],
        outras: dadosMock.atendimentos
          .filter((a) => a.contato_id === resumoAberto.contato_id && a.id !== resumoAberto.id)
          .map((a) => ({
            id: a.id,
            numero_instancia: a.numero_instancia,
            canal: a.canal as ConversaResumo["canal"],
            status: a.status as ConversaResumo["status"],
          })),
      }
    : null;

  const total = dadosMock.etapas.length;
  const etapas = dadosMock.etapas.map((e, i) => ({
    ...e,
    data_criacao: dadosMock.base,
    cor: tomDaEtapa(dadosMock.funis[0].cor, i, total),
  })) as Etapa[];

  return {
    canais,
    canal,
    conversas,
    aberta,
    usuarios: [...dadosMock.usuarios, { id: usuarioId, nome: "Você", iniciais: "VC" }],
    funis: dadosMock.funis.map((f) => ({ ...f, data_criacao: dadosMock.base, descricao: "" })),
    etapas,
    documentos: [],
    demo: true,
  };
}
