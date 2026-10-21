// As entidades do CRM como as telas e o servidor as enxergam: uma linha de
// tabela (schema.sql e as migration-*.sql), às vezes com campos derivados na
// leitura. Só tipos, sem dado e sem `server-only`: tela, ação, rota e IA
// importam daqui.
//
// MORAVA EM app/data.ts até 2026-10-21, junto de um mock da época em que o
// banco ainda não existia. O mock saiu (só o de e-mails sobrou, em
// app/emails/mock.ts) e os tipos vieram para lib/, que é onde código de
// servidor pode importar sem depender de uma pasta de tela.
//
// Campo marcado "derivado" não é coluna: é calculado na consulta que carrega.

export type Contato = {
  id: string;
  origem_campos?: ValoresPersonalizados;
  nome: string;
  whatsapp: string;
  email: string;
  cidade: string;
  estado: string;
  pais: string;
  data_criacao: string;
  // Atendimento por IA (migration-ia-atendimento.sql): null segue a etapa,
  // true = ligado à mão, false = removido. Opcional: só o quadro carrega.
  ia?: boolean | null;
  // A IA escolhida quando ligado à mão (migration-ias.sql); null nos outros casos.
  ia_id?: string | null;
};

export type Funil = {
  id: string;
  nome: string;
  data_criacao: string;
  descricao: string;
  // Nome da cor no Tailwind ('blue'), não a classe pronta. É o funil que tem
  // cor; a etapa recebe um TOM dela conforme a posição — ver lib/cores-funil.ts
  // e migration-cor-no-funil.sql.
  cor: string;
};

export type Etapa = {
  id: string;
  nome: string;
  funil_id: string;
  data_criacao: string;
  ordem: number;
  // DERIVADA, não lida do banco: a classe Tailwind sai de (cor do funil,
  // posição, total de etapas) em carregarFunil. A coluna `etapas.cor` ainda
  // existe no banco e não é mais lida.
  cor: string;
  // Evento da Meta enviado quando uma oportunidade ENTRA na etapa (NULL = não
  // envia). Opcional no tipo porque só Configurações → Funis o carrega; o
  // quadro e as outras telas não precisam dele.
  meta_evento?: string | null;
  // A IA que responde no WhatsApp quem tem oportunidade aberta aqui
  // (migration-ias.sql); null = nenhuma.
  ia_id?: string | null;
  // Os cards desta etapa ficam escondidos no quadro (o olho do cabeçalho da
  // coluna; migration-etapa-ocultar-leads.sql). A coluna segue com contagem e
  // valor; desmarcar o olho mostra de novo.
  ocultar_leads?: boolean;
  // A cor do FUNIL (o nome do tom, 'blue'), para o robô dos cards sair nela.
  // Derivada no carregamento, como `cor`.
  tom_funil?: string;
};

export type Oportunidade = {
  id: string;
  nome: string;
  contato_id: string;
  valor: number;
  responsavel_id: string;
  status: string;
  funil_id: string;
  etapa_id: string;
  data_criacao: string;
  // Derivado: aproximado por hoje − data_criacao, porque não há registro de
  // quando a oportunidade entrou na etapa atual.
  dias_na_etapa: number;
  // Valores dos campos personalizados, indexados pela `chave` da definição
  // (ver migration-campos-personalizados.sql). OPCIONAL porque nem toda
  // Oportunidade nasce do banco: as derivadas (subetapas) não carregam o jsonb.
  campos?: ValoresPersonalizados;
};

// A definição de um campo personalizado (a linha de campos_personalizados). Os
// VALORES ficam no jsonb `campos` do contato/oportunidade, indexados por
// `chave` — daí o rename do rótulo não perder dado.
export type CampoPersonalizado = {
  id: string;
  entidade: "contato" | "oportunidade";
  chave: string;
  rotulo: string;
  tipo: "texto" | "numero" | "data" | "opcao";
  opcoes: string[];
  ordem: number;
};

export type ValoresPersonalizados = Record<string, string>;

export type Segmento = { id: string; nome: string; data_criacao: string };
export type Tag = { id: string; nome: string; data_criacao: string };

// Fato: o que aconteceu. Não se edita nem se apaga (ver schema.sql).
// oportunidade_id preenchido = a mudança foi num negócio do contato.
export type Historico = {
  id: string;
  contato_id: string;
  oportunidade_id: string | null;
  descricao: string;
  /**
   * NULO quando quem registrou foi o sistema — que é o caso de tudo o que
   * lib/historico.ts grava (mudança de etapa, entrada e saída de automação).
   * A coluna sempre aceitou nulo; o tipo é que dizia o contrário. A ficha
   * mostra "Sistema" nesses.
   */
  autor_id: string | null;
  data_criacao: string;
};

// Opinião: o que alguém escreveu. Esta se edita e apaga.
export type Anotacao = {
  id: string;
  contato_id: string;
  texto: string;
  autor_id: string;
  data_criacao: string;
  data_atualizacao: string | null;
};

// O resumo de uma linha de `usuarios` que as telas mostram (responsável,
// autor, avatar). Quem está logado, com departamento e módulos, é outro tipo:
// `UsuarioLogado`, em lib/auth/dal.ts.
export type Usuario = { id: string; nome: string; iniciais: string };

// Espelham as tabelas atendimentos e mensagens do schema.sql.
export type Atendimento = {
  id: string;
  contato_id: string;
  responsavel_id: string | null; // null = na fila, sem dono
  status: "aberto" | "na_fila" | "encerrado";
  // whatsapp = conexão não-oficial (uazapi/WhatsApp Web); whatsapp_oficial =
  // Cloud API. São canais com regras diferentes — a oficial tem janela de 24h
  // e exige template fora dela —, por isso não são o mesmo valor.
  canal: "whatsapp" | "whatsapp_oficial" | "instagram" | "email";
  numero_instancia: string | null; // qual número nosso recebeu (whatsapp)
  data_criacao: string;
  // Derivado: quantas mensagens do contato chegaram depois de
  // atendimentos.lido_em (app/chat/dados.ts).
  nao_lidas: number;
};

// status acompanha o envio pela uazapi: 'pendente' assim que grava, 'enviado' /
// 'entregue' / 'lido' conforme os webhooks, 'erro' se a uazapi recusar.
// 'recebido' é o que chega do contato. id_externo = id na uazapi (null até
// enviar/receber).
export type StatusMensagem =
  | "pendente"
  | "enviado"
  | "entregue"
  | "lido"
  | "erro"
  | "recebido";

export type TipoMensagem =
  | "texto"
  | "imagem"
  | "audio"
  | "video"
  | "documento"
  | "sticker"
  | "localizacao"
  | "contato"
  | "desconhecido";

// 'ausente' = mensagem de texto, não há arquivo. 'pendente'/'erro' = há, e
// ainda não está no nosso disco — a tela mostra os dois de formas diferentes.
export type EstadoMidia = "ausente" | "pendente" | "salva" | "erro";

export type Mensagem = {
  id: string;
  atendimento_id: string;
  origem: "contato" | "agente";
  autor_id: string | null; // usuario, quando origem = agente
  // Em mensagem de mídia, é a LEGENDA (pode ser ""). O anexo em si está nos
  // campos midia_* abaixo.
  texto: string;
  status: StatusMensagem;
  id_externo: string | null;
  data_criacao: string;

  // ── Anexo ────────────────────────────────────────────────────────────────
  // O caminho no disco NÃO vem para o cliente de propósito: a tela pede o
  // arquivo por /api/midia/<id da mensagem>, e onde ele está guardado é
  // assunto do servidor (ver app/api/midia/[id]/route.ts).
  tipo: TipoMensagem;
  // Anexo que saiu da BIBLIOTECA (app/documentos), em vez de ter chegado pelo
  // WhatsApp. Quando preenchido, o arquivo está em `documentos` e não na fila
  // de mídia — quem concilia isso é /api/midia/[id], então a tela continua
  // pedindo o anexo pelo id da mensagem e não precisa saber a diferença.
  documento_id: string | null;
  midia_estado: EstadoMidia;
  midia_mime: string | null;
  midia_nome: string | null;
  midia_tamanho: number | null;
  midia_duracao: number | null;
  midia_erro: string | null;
};
