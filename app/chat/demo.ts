// O /chat com dados fictícios (app/mock/chat.json), para olhar a tela com
// volume sem gravar nada no banco. Só em desenvolvimento e só com ?demo=1 —
// page.tsx recusa em produção.
//
// Devolve EXATAMENTE o tipo da consulta real (DadosChat): voltar para o banco é
// não passar o parâmetro. As mesmas regras da consulta estão aqui (filtro por
// canal, não lidas, janela de 24h, última mensagem), escritas sobre arrays.
import dadosMock from "../mock/chat.json";
import { tomDaEtapa } from "@/lib/cores-funil";
import type { Contato, Etapa, Oportunidade } from "@/lib/entidades";
import { PERFIS } from "@/lib/social/perfis";
import type { ComentarioInstagram, ComentariosDaConta, PostagemInstagram } from "@/lib/instagram-tipos";
import type { AbaInstagram, CanalChat, ConversaResumo, DadosChat, MensagemChat } from "./tipos";

const fim8 = (n: string | null | undefined) => (n ?? "").replace(/\D/g, "").slice(-8);

export function carregarChatDemo({
  canal,
  atendimentoId,
  usuarioId,
  aba = "direct",
  postagemId = null,
}: {
  canal: string;
  atendimentoId: string | null;
  usuarioId: string;
  aba?: AbaInstagram;
  postagemId?: string | null;
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

  const contatoPorId = new Map<string, Contato>(dadosMock.contatos.map((c) => [c.id, {
    ...c, email: c.email ?? "", cidade: c.cidade ?? "", estado: c.estado ?? "", pais: c.pais ?? "", data_criacao: quando(dadosMock.base)!,
  }]));

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

  // Só os identificadores das contas são públicos; pessoas e conteúdo são inventados.
  const instagramPorConta = new Map<string, ComentariosDaConta>();
  PERFIS.forEach((perfil, indice) => {
    const contaId = perfil.instagramId;
    const postagens: PostagemInstagram[] = [];
    const comentariosPorPostagem = new Map<string, ComentarioInstagram[]>();
    for (let p = 0; p < 3; p++) {
      const midiaId = `9900${indice + 1}00${p + 1}`;
      const quandoDemo = (minutos: number) => new Date(Date.now() - minutos * 60_000).toISOString();
      const comentarios: ComentarioInstagram[] = [];
      for (let pessoa = 0; pessoa < 2; pessoa++) {
        const sufixo = `${indice}-${p}-${pessoa}`;
        const contatoId = `demo-ig-contato-${sufixo}`;
        const atendimentoId = `demo-ig-direct-${sufixo}`;
        const nome = pessoa === 0 ? "Marina Exemplo" : "Rafael Exemplo";
        const texto = pessoa === 0 ? "Gostei do projeto! Como posso conhecer os detalhes?" : "Vocês podem me explicar como funciona?";
        contatoPorId.set(contatoId, {
          id: contatoId, nome, whatsapp: "", email: "", cidade: "", estado: "", pais: "Brasil", data_criacao: quandoDemo(90),
        });
        const recebida: MensagemChat = {
          ...mensagens[0], id: `demo-ig-msg-${sufixo}`, atendimento_id: atendimentoId,
          origem: "contato", autor_id: null, texto: "Olá! Vim da postagem e gostaria de saber mais. (Demonstração)",
          status: "recebido", enviada_por: null, tipo: "texto", data_criacao: quandoDemo(12 + p + pessoa),
        };
        mensagens.push(recebida);
        resumos.push({
          id: atendimentoId, contato_id: contatoId, contato_nome: nome, contato_whatsapp: null,
          responsavel_id: pessoa === 0 ? usuarioId : null, status: pessoa === 0 ? "aberto" : "na_fila",
          canal: "instagram", numero_instancia: contaId, data_criacao: quandoDemo(90), nao_lidas: 1,
          ultima: { texto: recebida.texto, tipo: recebida.tipo, origem: recebida.origem, status: recebida.status, enviada_por: null, data: recebida.data_criacao },
          janela_ate: new Date(Date.parse(recebida.data_criacao) + 24 * 3600_000).toISOString(),
        });
        const comentarioId = `${midiaId}${pessoa + 1}`;
        comentarios.push({
          id: `demo-ig-comentario-${sufixo}`, comentarioId, paiId: null,
          autorUsuario: pessoa === 0 ? "marina.exemplo.demo" : "rafael.exemplo.demo",
          texto, daConta: false, enviadaPor: null, contatoId, atendimentoId, quando: quandoDemo(60 - pessoa * 10), lido: pessoa === 0,
        });
        if (pessoa === 0) comentarios.push({
          id: `demo-ig-resposta-${sufixo}`, comentarioId: `${comentarioId}9`, paiId: comentarioId,
          autorUsuario: perfil.instagram, texto: "Olá, Marina! Vamos conversar pelo direct. Resposta fictícia de demonstração.",
          daConta: true, enviadaPor: p === 0 ? "ia" : p === 1 ? "crm" : "aparelho",
          contatoId: null, atendimentoId: null, quando: quandoDemo(45), lido: true,
        });
      }
      postagens.push({
        id: midiaId, legenda: ["Um novo jeito de viver — postagem fictícia para demonstração.", "Conheça os detalhes deste projeto fictício.", "Bastidores e inspirações — conteúdo de demonstração."][p],
        tipo: p === 1 ? "VIDEO" : "IMAGE", miniatura: null, link: "", quando: quandoDemo((p + 1) * 1440), comentarios: comentarios.length, naoLidos: 1,
      });
      comentariosPorPostagem.set(midiaId, comentarios);
    }
    const selecionada = postagens.some((postagem) => postagem.id === postagemId) ? postagemId : null;
    instagramPorConta.set(contaId, {
      conta: { id: contaId, usuario: perfil.instagram, nome: perfil.nome, paginaId: perfil.paginaId },
      postagens, postagemId: selecionada, comentarios: selecionada ? comentariosPorPostagem.get(selecionada)! : [],
      regras: [
        { contaId, midiaId: null, iaId: "demo-ia-social", ligada: true },
        { contaId, midiaId: postagens[1].id, iaId: "demo-ia-social", ligada: false },
        { contaId, midiaId: postagens[2].id, iaId: "demo-ia-projetos", ligada: true },
      ],
      podeAdministrar: true, podeResponderPublico: true, podeResponderDirect: true, erro: null,
    });
  });

  const contaInstagram = instagramPorConta.get(canal);
  const ordenadas = [...resumos].sort((a, b) =>
    (b.ultima?.data ?? b.data_criacao).localeCompare(a.ultima?.data ?? a.data_criacao),
  );
  const alvo = canal ? fim8(canal) : null;
  const conversas = canal ? ordenadas.filter((c) => contaInstagram
    ? c.canal === "instagram" && c.numero_instancia === canal
    : c.canal !== "instagram" && fim8(c.numero_instancia) === alvo) : ordenadas;

  const canais: CanalChat[] = dadosMock.canais.map((c) => {
    const doCanal = resumos.filter((r) => r.canal !== "instagram" && fim8(r.numero_instancia) === fim8(c.chave) && r.status !== "encerrado");
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

  for (const perfil of PERFIS) {
    const daConta = resumos.filter((r) => r.canal === "instagram" && r.numero_instancia === perfil.instagramId && r.status !== "encerrado");
    canais.push({
      chave: perfil.instagramId, tipo: "instagram", nome: perfil.nome, perfil: perfil.chave,
      numero: `@${perfil.instagram}`, foto: null, estado: "conectado",
      naoLidas: daConta.filter((r) => r.nao_lidas > 0).length,
      naFila: daConta.filter((r) => r.status === "na_fila").length,
      comentariosNaoLidos: instagramPorConta.get(perfil.instagramId)!.postagens.reduce((total, postagem) => total + postagem.naoLidos, 0),
    });
  }

  const resumoAberto = atendimentoId ? resumos.find((r) => r.id === atendimentoId) : undefined;
  const aberta = resumoAberto
    ? {
        id: resumoAberto.id,
        resumo: resumoAberto,
        ia: { valor: null, iaId: null, etapas: null, iaDaEtapa: null },
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
    ias: [{ id: "demo-ia-social", nome: "Assistente social (demo)" }, { id: "demo-ia-projetos", nome: "Assistente de projetos (demo)" }],
    aba: contaInstagram ? aba : "direct",
    instagram: contaInstagram && aba === "comentarios" ? contaInstagram : null,
    demo: true,
  };
}
