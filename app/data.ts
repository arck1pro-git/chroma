// Mock espelhando schema.sql: mesmas tabelas, mesmos nomes de coluna, mesmas
// chaves. Quando o banco entrar, cada array destes vira um SELECT e o resto da
// tela não muda.
//
// Campos marcados com ⚠ NÃO existem no schema — a tela precisa deles e o banco
// ainda não tem coluna pra guardar.

export type Contato = {
  id: string;
  nome: string;
  whatsapp: string;
  email: string;
  cidade: string;
  estado: string;
  pais: string;
  data_criacao: string;
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
  dias_na_etapa: number; // ⚠ sem coluna: exigiria registrar quando entrou na etapa
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
  autor_id: string;
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

export type ContatoSegmento = { contato_id: string; segmento_id: string };
export type ContatoTag = { contato_id: string; tag_id: string };

// ⚠ Tabela inteira ausente do schema: responsavel_id é uuid solto, sem FK,
// então não existe de onde tirar nome nem iniciais.
export type Usuario = { id: string; nome: string; iniciais: string };

// Quem está logado. Sem auth de verdade, é uma constante — "meus atendimentos"
// é o que aponta pra cá. Bate com o rodapé da sidebar (Fabrício · FA).
export const USUARIO_ATUAL = "u-fa";

// Espelham as tabelas atendimentos e mensagens do schema.sql.
// nao_lidas continua ⚠ derivado: no banco é count das mensagens do contato mais
// novas que atendimentos.lido_em, não uma coluna. A tela consome o número já
// calculado, então mantenho aqui pra ela não mudar quando o banco entrar.
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
  oportunidade_id: string | null; // atendimento anexado a esta oportunidade
  data_criacao: string;
  nao_lidas: number; // ⚠ derivado de lido_em
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
  midia_estado: EstadoMidia;
  midia_mime: string | null;
  midia_nome: string | null;
  midia_tamanho: number | null;
  midia_duracao: number | null;
  midia_erro: string | null;
};

// ⚠ Tabela inteira ausente do schema — nenhuma coluna destas existe no banco.
// Modelei pelo que a tela do módulo precisa mostrar e nada além disso; a
// modelagem de verdade (quem envia, pra quem, quando, o que aconteceu com cada
// envio) é sua. Os buracos que já vejo daqui:
//   · não há envio: isto guarda o e-mail escrito, não o disparo. Destinatário,
//     data de envio, abertura e clique não têm onde morar.
//   · `status` aqui é só rascunho/pronto. Se um dia enviar, vira máquina de
//     estados e provavelmente tabela própria de envios.
//   · html é o corpo inteiro em text. Funciona, mas não dá pra buscar dentro.
export type Email = {
  id: string;
  nome: string; // rótulo interno, não sai no e-mail
  assunto: string;
  remetente: string;
  html: string;
  status: "rascunho" | "pronto";
  autor_id: string;
  data_criacao: string;
  data_atualizacao: string | null;
};

// "Hoje" fixo (2026-07-15) mudou-se para filtros-comuns.ts: era o único import
// de valor que este arquivo exportava para código client, e trazia o mock
// inteiro junto para o bundle. Os arrays abaixo continuam aqui.

export const usuarios: Usuario[] = [
  { id: "u-fa", nome: "Fabrício", iniciais: "FA" },
  { id: "u-rs", nome: "Renan Sampaio", iniciais: "RS" },
  { id: "u-cl", nome: "Carla Lemos", iniciais: "CL" },
  { id: "u-am", nome: "Alice Moura", iniciais: "AM" },
  { id: "u-jp", nome: "João Pedro Rocha", iniciais: "JP" },
  { id: "u-mk", nome: "Marina Klein", iniciais: "MK" },
  { id: "u-tl", nome: "Thiago Lins", iniciais: "TL" },
  { id: "u-dn", nome: "Daniela Nunes", iniciais: "DN" },
];

export const segmentos: Segmento[] = [
  { id: "s-vip", nome: "Clientes VIP", data_criacao: "2026-01-10" },
  { id: "s-reengajar", nome: "Reengajar", data_criacao: "2026-01-10" },
  { id: "s-indicacao", nome: "Veio por indicação", data_criacao: "2026-02-02" },
  { id: "s-evento", nome: "Evento Construir 2026", data_criacao: "2026-03-18" },
  { id: "s-enterprise", nome: "Enterprise", data_criacao: "2026-01-10" },
];

export const tags: Tag[] = [
  { id: "t-urgente", nome: "Urgente", data_criacao: "2026-01-05" },
  { id: "t-sem-resposta", nome: "Sem resposta", data_criacao: "2026-01-05" },
  { id: "t-proposta", nome: "Proposta enviada", data_criacao: "2026-01-05" },
  { id: "t-renovacao", nome: "Renovação", data_criacao: "2026-02-14" },
  { id: "t-alto-ticket", nome: "Alto ticket", data_criacao: "2026-02-14" },
  { id: "t-decisor", nome: "Falou com decisor", data_criacao: "2026-04-01" },
];

export const contatos: Contato[] = [
  { id: "c-mariana", nome: "Mariana Alves", whatsapp: "+55 11 98812-4471", email: "mariana.alves@construtoravega.com.br", cidade: "São Paulo", estado: "SP", pais: "Brasil", data_criacao: "2026-07-13" },
  { id: "c-diego", nome: "Diego Peixoto", whatsapp: "+55 21 99145-2093", email: "diego@grupoaurora.com.br", cidade: "Rio de Janeiro", estado: "RJ", pais: "Brasil", data_criacao: "2026-07-10" },
  { id: "c-tania", nome: "Tânia Moreira", whatsapp: "+55 31 98330-7712", email: "tania.moreira@metalurgicaipe.com.br", cidade: "Belo Horizonte", estado: "MG", pais: "Brasil", data_criacao: "2026-07-06" },
  { id: "c-otavio", nome: "Otávio Prado", whatsapp: "+55 51 99671-3388", email: "otavio.prado@redemalbec.com.br", cidade: "Porto Alegre", estado: "RS", pais: "Brasil", data_criacao: "2026-07-12" },
  { id: "c-beatriz", nome: "Beatriz Nunes", whatsapp: "+55 41 98204-5510", email: "bnunes@logeco.com.br", cidade: "Curitiba", estado: "PR", pais: "Brasil", data_criacao: "2026-07-08" },
  { id: "c-fabio", nome: "Fábio Rocha", whatsapp: "+55 71 99880-1264", email: "dr.fabio@santalia.com.br", cidade: "Salvador", estado: "BA", pais: "Brasil", data_criacao: "2026-07-11" },
  { id: "c-helena", nome: "Helena Castro", whatsapp: "+55 62 98117-9925", email: "helena.castro@agroverde.com.br", cidade: "Goiânia", estado: "GO", pais: "Brasil", data_criacao: "2026-07-03" },
  { id: "c-paulo", nome: "Paulo Menezes", whatsapp: "+55 81 99432-0087", email: "paulo@ferragensuniao.com.br", cidade: "Recife", estado: "PE", pais: "Brasil", data_criacao: "2026-06-27" },
  { id: "c-renata", nome: "Renata Lisboa", whatsapp: "+55 11 97744-6612", email: "renata.lisboa@bancomeridiano.com.br", cidade: "São Paulo", estado: "SP", pais: "Brasil", data_criacao: "2026-07-09" },
  { id: "c-sergio", nome: "Sérgio Duarte", whatsapp: "+55 85 98865-3390", email: "sduarte@textilbonfim.com.br", cidade: "Fortaleza", estado: "CE", pais: "Brasil", data_criacao: "2026-07-04" },
  { id: "c-luciana", nome: "Luciana Berg", whatsapp: "+55 47 99128-4406", email: "luciana.berg@kraftsul.com.br", cidade: "Joinville", estado: "SC", pais: "Brasil", data_criacao: "2026-07-14" },
  { id: "c-marcos", nome: "Marcos Vinícius", whatsapp: "+55 79 98551-7723", email: "marcos@cimentosaracaju.com.br", cidade: "Aracaju", estado: "SE", pais: "Brasil", data_criacao: "2026-07-12" },
  { id: "c-camila", nome: "Camila Fontes", whatsapp: "+55 11 98003-1195", email: "camila.fontes@gmail.com", cidade: "Campinas", estado: "SP", pais: "Brasil", data_criacao: "2026-07-14" },
  { id: "c-rodrigo", nome: "Rodrigo Salles", whatsapp: "+55 21 99562-8840", email: "rodrigo.salles@outlook.com", cidade: "Niterói", estado: "RJ", pais: "Brasil", data_criacao: "2026-07-13" },
  { id: "c-anabeatriz", nome: "Ana Beatriz Lima", whatsapp: "+55 61 98274-3319", email: "anabeatriz.lima@gmail.com", cidade: "Brasília", estado: "DF", pais: "Brasil", data_criacao: "2026-07-09" },
  { id: "c-vitor", nome: "Vitor Hugo Reis", whatsapp: "+55 27 99630-2258", email: "vitorhugo.reis@gmail.com", cidade: "Vitória", estado: "ES", pais: "Brasil", data_criacao: "2026-07-12" },
  { id: "c-isabela", nome: "Isabela Franco", whatsapp: "+55 11 97318-5504", email: "isa@studionortedesign.com.br", cidade: "São Paulo", estado: "SP", pais: "Brasil", data_criacao: "2026-07-13" },
  { id: "c-gustavo", nome: "Gustavo Teles", whatsapp: "+55 31 98442-6671", email: "gustavo@oficinapontocerto.com.br", cidade: "Contagem", estado: "MG", pais: "Brasil", data_criacao: "2026-07-07" },
  { id: "c-paula", nome: "Paula Amaral", whatsapp: "+55 51 99385-1102", email: "dra.paula@clinicavitalis.com.br", cidade: "Porto Alegre", estado: "RS", pais: "Brasil", data_criacao: "2026-07-11" },
  { id: "c-ricardo", nome: "Ricardo Bastos", whatsapp: "+55 41 98716-4433", email: "ricardo.bastos@escolahorizonte.com.br", cidade: "Curitiba", estado: "PR", pais: "Brasil", data_criacao: "2026-07-06" },
  { id: "c-elaine", nome: "Elaine Souza", whatsapp: "+55 11 99027-8816", email: "elaine@graofino.com.br", cidade: "Santo André", estado: "SP", pais: "Brasil", data_criacao: "2026-07-13" },
  { id: "c-priscila", nome: "Priscila Andrade", whatsapp: "+55 71 98190-2247", email: "priscila@vitrinemodas.com.br", cidade: "Salvador", estado: "BA", pais: "Brasil", data_criacao: "2026-06-20" },
  { id: "c-bruno", nome: "Bruno Carvalho", whatsapp: "+55 21 98853-6674", email: "bruno@sonoraaudio.com.br", cidade: "Rio de Janeiro", estado: "RJ", pais: "Brasil", data_criacao: "2026-06-15" },
  { id: "c-juliana", nome: "Juliana Tavares", whatsapp: "+55 91 99205-3341", email: "juliana@redefarmabem.com.br", cidade: "Belém", estado: "PA", pais: "Brasil", data_criacao: "2026-05-28" },
  { id: "c-anderson", nome: "Anderson Muniz", whatsapp: "+55 48 98337-9960", email: "anderson@transporteslitoral.com.br", cidade: "Florianópolis", estado: "SC", pais: "Brasil", data_criacao: "2026-05-11" },
  { id: "c-larissa", nome: "Larissa Pinto", whatsapp: "+55 54 99461-2278", email: "larissa@cafeserrano.com.br", cidade: "Caxias do Sul", estado: "RS", pais: "Brasil", data_criacao: "2026-04-22" },
  { id: "c-fernando", nome: "Fernando Krieger", whatsapp: "+55 47 98624-5583", email: "fernando@autopecaskrieger.com.br", cidade: "Blumenau", estado: "SC", pais: "Brasil", data_criacao: "2026-03-30" },
  { id: "c-sofia", nome: "Sofia Marques", whatsapp: "+351 91 234-5678", email: "sofia.marques@editoralumen.pt", cidade: "Lisboa", estado: "Lisboa", pais: "Portugal", data_criacao: "2026-03-12" },
];

export const contatoSegmentos: ContatoSegmento[] = [
  { contato_id: "c-mariana", segmento_id: "s-evento" },
  { contato_id: "c-mariana", segmento_id: "s-enterprise" },
  { contato_id: "c-otavio", segmento_id: "s-enterprise" },
  { contato_id: "c-fabio", segmento_id: "s-enterprise" },
  { contato_id: "c-fabio", segmento_id: "s-vip" },
  { contato_id: "c-renata", segmento_id: "s-enterprise" },
  { contato_id: "c-renata", segmento_id: "s-vip" },
  { contato_id: "c-diego", segmento_id: "s-indicacao" },
  { contato_id: "c-tania", segmento_id: "s-reengajar" },
  { contato_id: "c-paulo", segmento_id: "s-reengajar" },
  { contato_id: "c-helena", segmento_id: "s-evento" },
  { contato_id: "c-luciana", segmento_id: "s-vip" },
  { contato_id: "c-marcos", segmento_id: "s-evento" },
  { contato_id: "c-camila", segmento_id: "s-evento" },
  { contato_id: "c-anabeatriz", segmento_id: "s-reengajar" },
  { contato_id: "c-gustavo", segmento_id: "s-reengajar" },
  { contato_id: "c-isabela", segmento_id: "s-indicacao" },
  { contato_id: "c-paula", segmento_id: "s-indicacao" },
  { contato_id: "c-priscila", segmento_id: "s-vip" },
  { contato_id: "c-juliana", segmento_id: "s-enterprise" },
  { contato_id: "c-anderson", segmento_id: "s-vip" },
  { contato_id: "c-anderson", segmento_id: "s-enterprise" },
  { contato_id: "c-fernando", segmento_id: "s-vip" },
  { contato_id: "c-sofia", segmento_id: "s-reengajar" },
  { contato_id: "c-larissa", segmento_id: "s-indicacao" },
];

export const contatoTags: ContatoTag[] = [
  { contato_id: "c-mariana", tag_id: "t-urgente" },
  { contato_id: "c-mariana", tag_id: "t-decisor" },
  { contato_id: "c-tania", tag_id: "t-sem-resposta" },
  { contato_id: "c-otavio", tag_id: "t-alto-ticket" },
  { contato_id: "c-otavio", tag_id: "t-decisor" },
  { contato_id: "c-beatriz", tag_id: "t-proposta" },
  { contato_id: "c-fabio", tag_id: "t-alto-ticket" },
  { contato_id: "c-fabio", tag_id: "t-proposta" },
  { contato_id: "c-fabio", tag_id: "t-decisor" },
  { contato_id: "c-helena", tag_id: "t-proposta" },
  { contato_id: "c-paulo", tag_id: "t-sem-resposta" },
  { contato_id: "c-renata", tag_id: "t-alto-ticket" },
  { contato_id: "c-renata", tag_id: "t-decisor" },
  { contato_id: "c-sergio", tag_id: "t-proposta" },
  { contato_id: "c-luciana", tag_id: "t-alto-ticket" },
  { contato_id: "c-marcos", tag_id: "t-decisor" },
  { contato_id: "c-anabeatriz", tag_id: "t-sem-resposta" },
  { contato_id: "c-rodrigo", tag_id: "t-urgente" },
  { contato_id: "c-gustavo", tag_id: "t-sem-resposta" },
  { contato_id: "c-paula", tag_id: "t-urgente" },
  { contato_id: "c-ricardo", tag_id: "t-proposta" },
  { contato_id: "c-priscila", tag_id: "t-renovacao" },
  { contato_id: "c-bruno", tag_id: "t-renovacao" },
  { contato_id: "c-juliana", tag_id: "t-renovacao" },
  { contato_id: "c-anderson", tag_id: "t-alto-ticket" },
  { contato_id: "c-anderson", tag_id: "t-renovacao" },
  { contato_id: "c-fernando", tag_id: "t-renovacao" },
  { contato_id: "c-sofia", tag_id: "t-sem-resposta" },
];

export const funis: Funil[] = [
  { id: "b2b", nome: "Vendas B2B", descricao: "Ciclo comercial para contas corporativas", cor: "blue", data_criacao: "2026-01-05" },
  { id: "inbound", nome: "Inbound Marketing", descricao: "Leads captados por conteúdo e campanhas", cor: "blue", data_criacao: "2026-01-05" },
  { id: "expansao", nome: "Pós-venda & Expansão", descricao: "Upsell e renovação da base ativa", cor: "blue", data_criacao: "2026-02-01" },
];

export const etapas: Etapa[] = [
  { id: "b2b-novo", nome: "Novo lead", funil_id: "b2b", ordem: 1, cor: "bg-sky-500", data_criacao: "2026-01-05" },
  { id: "b2b-qualificacao", nome: "Qualificação", funil_id: "b2b", ordem: 2, cor: "bg-indigo-500", data_criacao: "2026-01-05" },
  { id: "b2b-proposta", nome: "Proposta", funil_id: "b2b", ordem: 3, cor: "bg-violet-500", data_criacao: "2026-01-05" },
  { id: "b2b-negociacao", nome: "Negociação", funil_id: "b2b", ordem: 4, cor: "bg-amber-500", data_criacao: "2026-01-05" },
  { id: "b2b-ganho", nome: "Ganho", funil_id: "b2b", ordem: 5, cor: "bg-emerald-500", data_criacao: "2026-01-05" },

  { id: "in-captura", nome: "Captura", funil_id: "inbound", ordem: 1, cor: "bg-sky-500", data_criacao: "2026-01-05" },
  { id: "in-contato", nome: "Primeiro contato", funil_id: "inbound", ordem: 2, cor: "bg-indigo-500", data_criacao: "2026-01-05" },
  { id: "in-demo", nome: "Demonstração", funil_id: "inbound", ordem: 3, cor: "bg-violet-500", data_criacao: "2026-01-05" },
  { id: "in-fechamento", nome: "Fechamento", funil_id: "inbound", ordem: 4, cor: "bg-emerald-500", data_criacao: "2026-01-05" },

  { id: "ex-onboarding", nome: "Onboarding", funil_id: "expansao", ordem: 1, cor: "bg-sky-500", data_criacao: "2026-02-01" },
  { id: "ex-adocao", nome: "Adoção", funil_id: "expansao", ordem: 2, cor: "bg-indigo-500", data_criacao: "2026-02-01" },
  { id: "ex-upsell", nome: "Upsell", funil_id: "expansao", ordem: 3, cor: "bg-amber-500", data_criacao: "2026-02-01" },
  { id: "ex-renovacao", nome: "Renovação", funil_id: "expansao", ordem: 4, cor: "bg-emerald-500", data_criacao: "2026-02-01" },
];

export const oportunidades: Oportunidade[] = [
  { id: "b2b-1", nome: "Construtora Vega", contato_id: "c-mariana", valor: 48000, responsavel_id: "u-rs", status: "aberta", funil_id: "b2b", etapa_id: "b2b-novo", data_criacao: "2026-07-13", dias_na_etapa: 2 },
  { id: "b2b-2", nome: "Grupo Aurora", contato_id: "c-diego", valor: 22500, responsavel_id: "u-cl", status: "aberta", funil_id: "b2b", etapa_id: "b2b-novo", data_criacao: "2026-07-10", dias_na_etapa: 5 },
  { id: "b2b-3", nome: "Metalúrgica Ipê", contato_id: "c-tania", valor: 15200, responsavel_id: "u-rs", status: "aberta", funil_id: "b2b", etapa_id: "b2b-novo", data_criacao: "2026-07-06", dias_na_etapa: 9 },
  { id: "b2b-4", nome: "Rede Malbec", contato_id: "c-otavio", valor: 76000, responsavel_id: "u-am", status: "aberta", funil_id: "b2b", etapa_id: "b2b-qualificacao", data_criacao: "2026-07-12", dias_na_etapa: 3 },
  { id: "b2b-5", nome: "Log&Co Transportes", contato_id: "c-beatriz", valor: 31000, responsavel_id: "u-cl", status: "aberta", funil_id: "b2b", etapa_id: "b2b-qualificacao", data_criacao: "2026-07-08", dias_na_etapa: 7 },
  { id: "b2b-6", nome: "Hospital Santa Lía", contato_id: "c-fabio", valor: 128000, responsavel_id: "u-am", status: "aberta", funil_id: "b2b", etapa_id: "b2b-proposta", data_criacao: "2026-07-11", dias_na_etapa: 4 },
  { id: "b2b-7", nome: "AgroVerde S.A.", contato_id: "c-helena", valor: 54000, responsavel_id: "u-rs", status: "aberta", funil_id: "b2b", etapa_id: "b2b-proposta", data_criacao: "2026-07-03", dias_na_etapa: 12 },
  { id: "b2b-8", nome: "Ferragens União", contato_id: "c-paulo", valor: 19800, responsavel_id: "u-cl", status: "aberta", funil_id: "b2b", etapa_id: "b2b-proposta", data_criacao: "2026-06-27", dias_na_etapa: 18 },
  { id: "b2b-9", nome: "Banco Meridiano", contato_id: "c-renata", valor: 210000, responsavel_id: "u-am", status: "aberta", funil_id: "b2b", etapa_id: "b2b-negociacao", data_criacao: "2026-07-09", dias_na_etapa: 6 },
  { id: "b2b-10", nome: "Têxtil Bonfim", contato_id: "c-sergio", valor: 43000, responsavel_id: "u-rs", status: "aberta", funil_id: "b2b", etapa_id: "b2b-negociacao", data_criacao: "2026-07-04", dias_na_etapa: 11 },
  { id: "b2b-11", nome: "Indústria Kraft Sul", contato_id: "c-luciana", valor: 96000, responsavel_id: "u-cl", status: "ganha", funil_id: "b2b", etapa_id: "b2b-ganho", data_criacao: "2026-07-14", dias_na_etapa: 1 },
  { id: "b2b-12", nome: "Cimentos Aracaju", contato_id: "c-marcos", valor: 67500, responsavel_id: "u-am", status: "ganha", funil_id: "b2b", etapa_id: "b2b-ganho", data_criacao: "2026-07-12", dias_na_etapa: 3 },

  { id: "in-1", nome: "E-book · Gestão de obras", contato_id: "c-camila", valor: 3200, responsavel_id: "u-jp", status: "aberta", funil_id: "inbound", etapa_id: "in-captura", data_criacao: "2026-07-14", dias_na_etapa: 1 },
  { id: "in-2", nome: "Webinar · Automação", contato_id: "c-rodrigo", valor: 4800, responsavel_id: "u-jp", status: "aberta", funil_id: "inbound", etapa_id: "in-captura", data_criacao: "2026-07-13", dias_na_etapa: 2 },
  { id: "in-3", nome: "Landing · Trial 14 dias", contato_id: "c-anabeatriz", valor: 2400, responsavel_id: "u-mk", status: "aberta", funil_id: "inbound", etapa_id: "in-captura", data_criacao: "2026-07-09", dias_na_etapa: 6 },
  { id: "in-4", nome: "Formulário · Preços", contato_id: "c-vitor", valor: 5600, responsavel_id: "u-mk", status: "aberta", funil_id: "inbound", etapa_id: "in-captura", data_criacao: "2026-07-12", dias_na_etapa: 3 },
  { id: "in-5", nome: "Studio Norte Design", contato_id: "c-isabela", valor: 8900, responsavel_id: "u-jp", status: "aberta", funil_id: "inbound", etapa_id: "in-contato", data_criacao: "2026-07-13", dias_na_etapa: 2 },
  { id: "in-6", nome: "Oficina Ponto Certo", contato_id: "c-gustavo", valor: 6100, responsavel_id: "u-mk", status: "aberta", funil_id: "inbound", etapa_id: "in-contato", data_criacao: "2026-07-07", dias_na_etapa: 8 },
  { id: "in-7", nome: "Clínica Vitalis", contato_id: "c-paula", valor: 14500, responsavel_id: "u-jp", status: "aberta", funil_id: "inbound", etapa_id: "in-demo", data_criacao: "2026-07-11", dias_na_etapa: 4 },
  { id: "in-8", nome: "Escola Horizonte", contato_id: "c-ricardo", valor: 11200, responsavel_id: "u-mk", status: "aberta", funil_id: "inbound", etapa_id: "in-demo", data_criacao: "2026-07-06", dias_na_etapa: 9 },
  { id: "in-9", nome: "Padaria Grão Fino", contato_id: "c-elaine", valor: 7400, responsavel_id: "u-jp", status: "ganha", funil_id: "inbound", etapa_id: "in-fechamento", data_criacao: "2026-07-13", dias_na_etapa: 2 },

  { id: "ex-1", nome: "Vitrine Modas · Setup", contato_id: "c-priscila", valor: 12000, responsavel_id: "u-tl", status: "aberta", funil_id: "expansao", etapa_id: "ex-onboarding", data_criacao: "2026-06-20", dias_na_etapa: 3 },
  { id: "ex-2", nome: "Sonora Áudio · Setup", contato_id: "c-bruno", valor: 9500, responsavel_id: "u-tl", status: "aberta", funil_id: "expansao", etapa_id: "ex-onboarding", data_criacao: "2026-06-15", dias_na_etapa: 5 },
  { id: "ex-3", nome: "Rede Farma Bem", contato_id: "c-juliana", valor: 26000, responsavel_id: "u-dn", status: "aberta", funil_id: "expansao", etapa_id: "ex-adocao", data_criacao: "2026-05-28", dias_na_etapa: 14 },
  { id: "ex-4", nome: "Transportes Litoral · Plano Pro", contato_id: "c-anderson", valor: 38000, responsavel_id: "u-dn", status: "aberta", funil_id: "expansao", etapa_id: "ex-upsell", data_criacao: "2026-05-11", dias_na_etapa: 4 },
  { id: "ex-5", nome: "Café Serrano · Multiloja", contato_id: "c-larissa", valor: 17600, responsavel_id: "u-tl", status: "aberta", funil_id: "expansao", etapa_id: "ex-upsell", data_criacao: "2026-04-22", dias_na_etapa: 10 },
  { id: "ex-6", nome: "Auto Peças Krieger", contato_id: "c-fernando", valor: 45000, responsavel_id: "u-dn", status: "aberta", funil_id: "expansao", etapa_id: "ex-renovacao", data_criacao: "2026-03-30", dias_na_etapa: 7 },
  { id: "ex-7", nome: "Editora Lumen", contato_id: "c-sofia", valor: 21000, responsavel_id: "u-tl", status: "aberta", funil_id: "expansao", etapa_id: "ex-renovacao", data_criacao: "2026-03-12", dias_na_etapa: 21 },
];

// Nem todo contato tem histórico ou anotação — a ficha precisa aguentar o vazio,
// que é o estado de um lead recém-criado.
export const historico: Historico[] = [
  { id: "h-1", contato_id: "c-mariana", oportunidade_id: "b2b-1", descricao: "Oportunidade “Construtora Vega” criada em Novo lead", autor_id: "u-rs", data_criacao: "2026-07-13T09:12:00Z" },
  { id: "h-2", contato_id: "c-mariana", oportunidade_id: null, descricao: "Contato criado a partir do formulário do Evento Construir 2026", autor_id: "u-rs", data_criacao: "2026-07-13T09:10:00Z" },
  { id: "h-3", contato_id: "c-mariana", oportunidade_id: null, descricao: "Tag “Urgente” adicionada", autor_id: "u-cl", data_criacao: "2026-07-14T16:40:00Z" },

  { id: "h-4", contato_id: "c-fabio", oportunidade_id: "b2b-6", descricao: "Movida de Qualificação para Proposta", autor_id: "u-am", data_criacao: "2026-07-11T14:05:00Z" },
  { id: "h-5", contato_id: "c-fabio", oportunidade_id: "b2b-6", descricao: "Valor alterado de R$ 96.000 para R$ 128.000", autor_id: "u-am", data_criacao: "2026-07-11T14:02:00Z" },
  { id: "h-6", contato_id: "c-fabio", oportunidade_id: null, descricao: "WhatsApp alterado", autor_id: "u-am", data_criacao: "2026-07-02T10:30:00Z" },
  { id: "h-7", contato_id: "c-fabio", oportunidade_id: null, descricao: "Contato criado", autor_id: "u-am", data_criacao: "2026-06-30T08:00:00Z" },

  { id: "h-8", contato_id: "c-renata", oportunidade_id: "b2b-9", descricao: "Movida de Proposta para Negociação", autor_id: "u-am", data_criacao: "2026-07-09T11:20:00Z" },
  { id: "h-9", contato_id: "c-renata", oportunidade_id: null, descricao: "Segmento “Clientes VIP” adicionado", autor_id: "u-cl", data_criacao: "2026-07-05T15:00:00Z" },

  { id: "h-10", contato_id: "c-luciana", oportunidade_id: "b2b-11", descricao: "Oportunidade marcada como ganha", autor_id: "u-cl", data_criacao: "2026-07-14T17:45:00Z" },
  { id: "h-11", contato_id: "c-luciana", oportunidade_id: "b2b-11", descricao: "Movida de Negociação para Ganho", autor_id: "u-cl", data_criacao: "2026-07-14T17:44:00Z" },

  { id: "h-12", contato_id: "c-tania", oportunidade_id: null, descricao: "Tag “Sem resposta” adicionada", autor_id: "u-rs", data_criacao: "2026-07-12T09:00:00Z" },
  { id: "h-13", contato_id: "c-tania", oportunidade_id: "b2b-3", descricao: "Oportunidade “Metalúrgica Ipê” criada em Novo lead", autor_id: "u-rs", data_criacao: "2026-07-06T13:30:00Z" },

  { id: "h-14", contato_id: "c-sofia", oportunidade_id: "ex-7", descricao: "Renovação adiada para o próximo trimestre", autor_id: "u-tl", data_criacao: "2026-06-24T11:00:00Z" },
  { id: "h-15", contato_id: "c-anderson", oportunidade_id: "ex-4", descricao: "Movida de Adoção para Upsell", autor_id: "u-dn", data_criacao: "2026-07-11T10:15:00Z" },
  { id: "h-16", contato_id: "c-priscila", oportunidade_id: null, descricao: "E-mail alterado", autor_id: "u-tl", data_criacao: "2026-06-22T14:20:00Z" },
];

export const anotacoes: Anotacao[] = [
  { id: "a-1", contato_id: "c-mariana", texto: "Decisora confirmada. Pediu proposta com prazo de obra de 8 meses e cronograma por etapa.", autor_id: "u-rs", data_criacao: "2026-07-14T10:20:00Z", data_atualizacao: null },
  { id: "a-2", contato_id: "c-mariana", texto: "Só atende depois das 18h — evitar ligar de manhã.", autor_id: "u-cl", data_criacao: "2026-07-13T18:05:00Z", data_atualizacao: "2026-07-14T09:00:00Z" },
  { id: "a-3", contato_id: "c-fabio", texto: "Compra passa pelo comitê clínico. Janela de decisão é a primeira semana do mês.", autor_id: "u-am", data_criacao: "2026-07-11T15:30:00Z", data_atualizacao: null },
  { id: "a-4", contato_id: "c-renata", texto: "Jurídico do banco exige cláusula de SLA. Já enviei para o nosso jurídico revisar.", autor_id: "u-am", data_criacao: "2026-07-10T09:45:00Z", data_atualizacao: null },
  { id: "a-5", contato_id: "c-tania", texto: "Três tentativas sem retorno. Vou tentar pelo LinkedIn antes de esfriar de vez.", autor_id: "u-rs", data_criacao: "2026-07-12T09:10:00Z", data_atualizacao: null },
  { id: "a-6", contato_id: "c-sofia", texto: "Orçamento congelado até setembro. Retomar contato no fim de agosto.", autor_id: "u-tl", data_criacao: "2026-06-24T11:15:00Z", data_atualizacao: null },
  { id: "a-7", contato_id: "c-otavio", texto: "Quer piloto em duas lojas antes de fechar a rede toda.", autor_id: "u-am", data_criacao: "2026-07-12T16:00:00Z", data_atualizacao: null },
  { id: "a-8", contato_id: "c-anderson", texto: "Já é cliente desde 2025. Upsell do Plano Pro depende de aprovação do sócio.", autor_id: "u-dn", data_criacao: "2026-07-11T10:30:00Z", data_atualizacao: null },
];

// HTML de e-mail é feio por obrigação: tabela, style inline e largura fixa. É o
// que Gmail e Outlook renderizam igual — flex e <style> no topo, não.
export const emails: Email[] = [
  {
    id: "e-boas-vindas",
    nome: "Boas-vindas · trial",
    assunto: "Bem-vindo à Chroma, {{nome}}",
    remetente: "Chroma <ola@chroma.com.br>",
    status: "pronto",
    autor_id: "u-mk",
    data_criacao: "2026-06-02T10:00:00Z",
    data_atualizacao: "2026-07-08T14:30:00Z",
    html: `<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;font-family:Helvetica,Arial,sans-serif">
  <tr>
    <td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden">
        <tr>
          <td style="padding:32px 40px 0">
            <h1 style="margin:0;font-size:24px;color:#18181b">Bem-vindo à Chroma</h1>
            <p style="margin:16px 0 0;font-size:15px;line-height:24px;color:#52525b">
              Olá {{nome}}, sua conta está no ar. Você tem 14 dias para testar tudo —
              funil, contatos e automações — sem cartão.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 40px 40px">
            <a href="https://app.chroma.com.br/funil"
               style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;
                      padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600">
              Abrir meu funil
            </a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`,
  },
  {
    id: "e-proposta",
    nome: "Follow-up de proposta",
    assunto: "Sobre a proposta que enviamos",
    remetente: "Renan Sampaio <renan@chroma.com.br>",
    status: "pronto",
    autor_id: "u-rs",
    data_criacao: "2026-06-19T09:20:00Z",
    data_atualizacao: null,
    html: `<table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;font-family:Helvetica,Arial,sans-serif">
  <tr>
    <td align="center">
      <table width="600" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding:0 40px">
            <p style="margin:0;font-size:15px;line-height:24px;color:#3f3f46">
              Oi {{nome}}, tudo bem?
            </p>
            <p style="margin:16px 0 0;font-size:15px;line-height:24px;color:#3f3f46">
              Passando para saber se a proposta chegou e se ficou alguma dúvida sobre
              prazo ou escopo. Qualquer ajuste, é só responder este e-mail.
            </p>
            <hr style="border:0;border-top:1px solid #e4e4e7;margin:28px 0" />
            <p style="margin:0;font-size:13px;color:#a1a1aa">
              Renan Sampaio · Chroma
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`,
  },
  {
    id: "e-evento",
    nome: "Convite · Construir 2026",
    assunto: "Te esperamos no Construir 2026 (estande 42)",
    remetente: "Chroma Eventos <eventos@chroma.com.br>",
    status: "rascunho",
    autor_id: "u-jp",
    data_criacao: "2026-07-05T16:45:00Z",
    data_atualizacao: "2026-07-14T11:10:00Z",
    html: `<table width="100%" cellpadding="0" cellspacing="0" style="background:#18181b;padding:40px 0;font-family:Helvetica,Arial,sans-serif">
  <tr>
    <td align="center">
      <table width="600" cellpadding="0" cellspacing="0">
        <tr>
          <td align="center" style="padding:0 40px">
            <h1 style="margin:0;font-size:32px;color:#fafafa;letter-spacing:-0.5px">
              Construir 2026
            </h1>
            <p style="margin:12px 0 0;font-size:15px;line-height:24px;color:#a1a1aa">
              18 a 20 de agosto · São Paulo Expo · Estande 42
            </p>
            <a href="https://chroma.com.br/construir"
               style="display:inline-block;margin-top:28px;background:#fafafa;color:#18181b;
                      text-decoration:none;padding:12px 28px;border-radius:999px;
                      font-size:14px;font-weight:600">
              Garantir meu ingresso
            </a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`,
  },
  {
    id: "e-reengajar",
    nome: "Reengajamento · 60 dias",
    assunto: "Faz um tempo que a gente não se fala",
    remetente: "Carla Lemos <carla@chroma.com.br>",
    status: "rascunho",
    autor_id: "u-cl",
    data_criacao: "2026-07-11T08:15:00Z",
    data_atualizacao: null,
    html: `<table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;font-family:Helvetica,Arial,sans-serif">
  <tr>
    <td align="center">
      <table width="600" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding:0 40px">
            <p style="margin:0;font-size:15px;line-height:24px;color:#3f3f46">
              Oi {{nome}}, aqui é a Carla.
            </p>
            <p style="margin:16px 0 0;font-size:15px;line-height:24px;color:#3f3f46">
              Vi que sua última conversa com a gente foi há um tempo. Mudou bastante
              coisa por aqui desde então — se fizer sentido retomar, me diz um horário
              e eu te mostro em 15 minutos.
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`,
  },
];

// Índices prontos. No banco isto vira JOIN; aqui, Map.
export const contatoPorId = new Map(contatos.map((c) => [c.id, c]));
export const usuarioPorId = new Map(usuarios.map((u) => [u.id, u]));

function agrupar<T extends { contato_id: string }, V>(
  vinculos: T[],
  chave: (v: T) => string,
  fonte: { id: string; nome: string; data_criacao: string }[],
) {
  const mapa = new Map<string, V[]>();
  for (const vinculo of vinculos) {
    const item = fonte.find((f) => f.id === chave(vinculo));
    if (!item) continue;
    const atual = mapa.get(vinculo.contato_id) ?? [];
    atual.push(item as V);
    mapa.set(vinculo.contato_id, atual);
  }
  return mapa;
}

export const segmentosDoContato = agrupar<ContatoSegmento, Segmento>(
  contatoSegmentos,
  (v) => v.segmento_id,
  segmentos,
);

export const tagsDoContato = agrupar<ContatoTag, Tag>(
  contatoTags,
  (v) => v.tag_id,
  tags,
);

export function etapasDoFunil(funilId: string) {
  return etapas
    .filter((e) => e.funil_id === funilId)
    .sort((a, b) => a.ordem - b.ordem);
}

export const etapaPorId = new Map(etapas.map((e) => [e.id, e]));
export const funilPorId = new Map(funis.map((f) => [f.id, f]));

function agruparPorContato<T extends { contato_id: string }>(linhas: T[]) {
  const mapa = new Map<string, T[]>();
  for (const linha of linhas) {
    mapa.set(linha.contato_id, [...(mapa.get(linha.contato_id) ?? []), linha]);
  }
  return mapa;
}

export const oportunidadesDoContato = agruparPorContato(oportunidades);

// Mais recente primeiro, como os índices do schema (data_criacao DESC).
const recenteAntes = <T extends { data_criacao: string }>(a: T, b: T) =>
  b.data_criacao.localeCompare(a.data_criacao);

export const historicoDoContato = agruparPorContato(
  [...historico].sort(recenteAntes),
);
export const anotacoesDoContato = agruparPorContato(
  [...anotacoes].sort(recenteAntes),
);
