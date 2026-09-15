"use server";

// Mutações das Configurações — de funil e etapa a instância de WhatsApp.
//
// Revalida /configuracoes e / (a raiz, onde o quadro mora). O "layout" no
// revalidatePath das Configurações é obrigatório desde que cada seção virou
// uma rota (/configuracoes/funis, /configuracoes/whatsapp, …): sem ele, o
// caminho literal invalidaria só a tela índice, que hoje nem existe mais.
import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { corValida } from "@/lib/cores-funil";

export async function criarFunil(
  nome: string,
  descricao: string,
  cor: string,
): Promise<string> {
  const n = nome.trim();
  if (!n) throw new Error("Nome do funil é obrigatório");

  const [f] = await sql`
    INSERT INTO funis (nome, descricao, cor)
    VALUES (${n}, ${descricao.trim()}, ${corValida(cor)})
    RETURNING id`;

  revalidatePath("/configuracoes", "layout");
  revalidatePath("/");
  return f.id;
}

/**
 * Troca o tom do funil — e, com ele, o de TODAS as etapas dele: os tons são
 * derivados na leitura (lib/cores-funil.ts), não gravados por etapa.
 *
 * corValida peneira antes do banco. O CHECK da coluna recusaria um valor solto
 * de qualquer jeito, mas com um 500 cru em vez de silenciosamente cair no
 * padrão, que é o comportamento útil aqui.
 */
export async function editarCorDoFunil(id: string, cor: string): Promise<void> {
  await sql`UPDATE funis SET cor = ${corValida(cor)} WHERE id = ${id}`;
  revalidatePath("/configuracoes", "layout");
  revalidatePath("/");
}

// A etapa NÃO recebe mais cor: ela herda um tom do funil conforme a posição
// (migration-cor-no-funil.sql). `etapas.cor` continua na tabela com o DEFAULT
// antigo preenchendo — e ninguém lê.
export async function criarEtapa(
  funilId: string,
  nome: string,
): Promise<string> {
  const n = nome.trim();
  if (!n) throw new Error("Nome da etapa é obrigatório");

  // ordem = próxima na sequência do funil (a coluna nasce no fim do quadro).
  // Nascer no fim significa nascer com o tom MAIS ESCURO, e empurrar a etapa
  // que era a última um degrau para cima — o gradiente se refaz sozinho.
  const [e] = await sql`
    INSERT INTO etapas (nome, funil_id, ordem)
    VALUES (
      ${n}, ${funilId},
      (SELECT COALESCE(MAX(ordem), 0) + 1 FROM etapas WHERE funil_id = ${funilId})
    )
    RETURNING id`;

  revalidatePath("/configuracoes", "layout");
  revalidatePath("/");
  return e.id;
}

export async function editarEtapa(id: string, nome: string): Promise<void> {
  const n = nome.trim();
  if (!n) throw new Error("Nome da etapa é obrigatório");
  await sql`UPDATE etapas SET nome = ${n} WHERE id = ${id}`;
  revalidatePath("/configuracoes", "layout");
  revalidatePath("/");
}

// Recebe os ids na ordem final (é o que o drag-and-drop já resolveu na tela)
// e regrava 1..N. Em transação: uma reordenação pela metade deixaria duas
// etapas com o mesmo `ordem` e o quadro empilharia colunas.
export async function reordenarEtapas(etapaIds: string[]): Promise<void> {
  await sql.begin(async (tx: typeof sql) => {
    for (let i = 0; i < etapaIds.length; i++) {
      await tx`UPDATE etapas SET ordem = ${i + 1} WHERE id = ${etapaIds[i]}`;
    }
  });
  revalidatePath("/configuracoes", "layout");
  revalidatePath("/");
}

// ── Tags ─────────────────────────────────────────────────────────────────────
// nome é UNIQUE no schema — nome repetido vira erro amigável (não 500 cru).
function ehDuplicado(e: unknown) {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";
}

function revalidarTags() {
  revalidatePath("/configuracoes", "layout");
  revalidatePath("/");
}

export async function criarTag(nome: string): Promise<string> {
  const n = nome.trim();
  if (!n) throw new Error("Nome da tag é obrigatório");
  try {
    const [t] = await sql`INSERT INTO tags (nome) VALUES (${n}) RETURNING id`;
    revalidarTags();
    return t.id;
  } catch (e) {
    if (ehDuplicado(e)) throw new Error("Já existe uma tag com esse nome");
    throw e;
  }
}

export async function editarTag(id: string, nome: string): Promise<void> {
  const n = nome.trim();
  if (!n) throw new Error("Nome da tag é obrigatório");
  try {
    await sql`UPDATE tags SET nome = ${n} WHERE id = ${id}`;
    revalidarTags();
  } catch (e) {
    if (ehDuplicado(e)) throw new Error("Já existe uma tag com esse nome");
    throw e;
  }
}

// CASCADE em contato_tags: apagar a tag tira ela de todos os contatos.
export async function deletarTag(id: string): Promise<void> {
  await sql`DELETE FROM tags WHERE id = ${id}`;
  revalidarTags();
}

// ── Segmentos ────────────────────────────────────────────────────────────────
// Mesma modelagem de tags: nome UNIQUE, CASCADE em contato_segmentos.
function revalidarSegmentos() {
  revalidatePath("/configuracoes", "layout");
  revalidatePath("/");
}

export async function criarSegmento(nome: string): Promise<string> {
  const n = nome.trim();
  if (!n) throw new Error("Nome do segmento é obrigatório");
  try {
    const [s] = await sql`INSERT INTO segmentos (nome) VALUES (${n}) RETURNING id`;
    revalidarSegmentos();
    return s.id;
  } catch (e) {
    if (ehDuplicado(e)) throw new Error("Já existe um segmento com esse nome");
    throw e;
  }
}

export async function editarSegmento(id: string, nome: string): Promise<void> {
  const n = nome.trim();
  if (!n) throw new Error("Nome do segmento é obrigatório");
  try {
    await sql`UPDATE segmentos SET nome = ${n} WHERE id = ${id}`;
    revalidarSegmentos();
  } catch (e) {
    if (ehDuplicado(e)) throw new Error("Já existe um segmento com esse nome");
    throw e;
  }
}

export async function deletarSegmento(id: string): Promise<void> {
  await sql`DELETE FROM segmentos WHERE id = ${id}`;
  revalidarSegmentos();
}

// ── Usuários ─────────────────────────────────────────────────────────────────
// Iniciais: usa as informadas ou deriva do nome (1ª letra das 2 primeiras palavras).
function iniciaisDe(nome: string) {
  const p = nome.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase();
}

function revalidarUsuarios() {
  revalidatePath("/configuracoes", "layout");
  revalidatePath("/chat");
  revalidatePath("/");
}

export async function criarUsuario(
  nome: string,
  iniciais: string,
): Promise<string> {
  const n = nome.trim();
  if (!n) throw new Error("Nome é obrigatório");
  const ini = (iniciais.trim() || iniciaisDe(n)).slice(0, 4).toUpperCase();
  const [u] = await sql`
    INSERT INTO usuarios (nome, iniciais) VALUES (${n}, ${ini}) RETURNING id`;
  revalidarUsuarios();
  return u.id;
}

export async function editarUsuario(
  id: string,
  nome: string,
  iniciais: string,
): Promise<void> {
  const n = nome.trim();
  if (!n) throw new Error("Nome é obrigatório");
  const ini = (iniciais.trim() || iniciaisDe(n)).slice(0, 4).toUpperCase();
  await sql`UPDATE usuarios SET nome = ${n}, iniciais = ${ini} WHERE id = ${id}`;
  revalidarUsuarios();
}

// ── Campos personalizados ────────────────────────────────────────────────────
// A `chave` é derivada do rótulo e NUNCA muda depois de criada: é ela que
// indexa o valor dentro do jsonb de contatos/oportunidades. Renomear a chave
// órfãnaria todo valor já gravado — por isso só o rótulo é editável.
function chaveDe(rotulo: string) {
  return rotulo
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function revalidarCampos() {
  revalidatePath("/configuracoes", "layout");
  revalidatePath("/");
  revalidatePath("/chat");
}

// "um, dois , três" -> "um,dois,três". O string_to_array do Postgres não apara
// espaço, e sem isso a opção guardada vira " dois", que nunca casa com o que a
// tela mostra.
function listaDeOpcoes(bruto: string) {
  return bruto
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean)
    .join(",");
}

// Vem da tela como "a, b, c"; no banco é text[]. string_to_array faz a
// conversão no servidor — passar array JS por parâmetro não é confiável aqui
// (fetch_types:false desliga a inferência de tipo do driver).
export async function criarCampoPersonalizado(
  entidade: "contato" | "oportunidade",
  rotulo: string,
  tipo: string,
  opcoes: string,
): Promise<string> {
  const r = rotulo.trim();
  if (!r) throw new Error("Rótulo é obrigatório");
  const chave = chaveDe(r);
  if (!chave) throw new Error("Rótulo precisa ter ao menos uma letra ou número");

  try {
    const [c] = await sql`
      INSERT INTO campos_personalizados (entidade, chave, rotulo, tipo, opcoes, ordem)
      VALUES (
        ${entidade}, ${chave}, ${r}, ${tipo},
        ${tipo === "opcao" && listaDeOpcoes(opcoes)
          ? sql`string_to_array(${listaDeOpcoes(opcoes)}, ',')`
          : sql`NULL`},
        (SELECT COALESCE(MAX(ordem), 0) + 1 FROM campos_personalizados WHERE entidade = ${entidade})
      )
      RETURNING id`;
    revalidarCampos();
    return c.id;
  } catch (e) {
    if (ehDuplicado(e)) throw new Error("Já existe um campo com esse nome nesta ficha");
    throw e;
  }
}

export async function editarCampoPersonalizado(
  id: string,
  rotulo: string,
  tipo: string,
  opcoes: string,
): Promise<void> {
  const r = rotulo.trim();
  if (!r) throw new Error("Rótulo é obrigatório");
  await sql`
    UPDATE campos_personalizados
    SET rotulo = ${r},
        tipo = ${tipo},
        opcoes = ${tipo === "opcao" && listaDeOpcoes(opcoes)
          ? sql`string_to_array(${listaDeOpcoes(opcoes)}, ',')`
          : sql`NULL`}
    WHERE id = ${id}`;
  revalidarCampos();
}

// Só apaga a DEFINIÇÃO. Os valores já gravados continuam no jsonb de cada
// contato/oportunidade — somem da tela, mas voltam se o campo for recriado com
// a mesma chave. Apagar 17 mil valores num clique de tela de configuração é
// estrago grande demais pra ser irreversível.
export async function excluirCampoPersonalizado(id: string): Promise<void> {
  await sql`DELETE FROM campos_personalizados WHERE id = ${id}`;
  revalidarCampos();
}

// ── Instâncias uazapi ────────────────────────────────────────────────────────
// Aqui mora TODO o contato do CRM com a uazapi que não é envio de mensagem:
// cadastrar a instância, gerar o QR Code, acompanhar o pareamento e desligar.
//
// A regra que vale para tudo abaixo: o TOKEN nunca sai do servidor. A tela
// manda o id da linha, nós buscamos a credencial no banco e falamos com a
// uazapi daqui. Por isso nenhuma action abaixo recebe token vindo do navegador
// — só `conectarInstancia`, no cadastro, e ela grava e esquece.
//
// Contrato confirmado contra o OpenAPI da uazapiGO 2.1.1:
//   GET  {base}/instance/status      header token  → { instance, status }
//   POST {base}/instance/connect     header token  → { instance, connected, … }
//        body {} gera QR Code; body { phone } gera código de pareamento
//   POST {base}/instance/disconnect  header token
function revalidarInstancias() {
  // "layout": as Configurações viraram várias rotas (/configuracoes/funis,
  // /configuracoes/whatsapp, …) e o caminho literal só invalidaria uma delas.
  revalidatePath("/configuracoes", "layout");
}

/** Estados da uazapi. `hibernated` = sessão pausada, credencial preservada. */
export type EstadoConexao = "disconnected" | "connecting" | "connected" | "hibernated";

// O que a tela do WhatsApp recebe a cada consulta. Repare no que NÃO está
// aqui: token e base_url. Desenhar um QR Code não precisa deles.
export type ConexaoUazapi = {
  estado: EstadoConexao;
  // Pronto para entrar num <img src>: a uazapi ora devolve o base64 cru, ora
  // já com o prefixo data:. Normalizado em `conexaoDaResposta`.
  qrcode: string | null;
  // Alternativa ao QR: código que se digita no celular.
  paircode: string | null;
  numero: string | null;
  perfil: string | null;
};

async function credencial(id: string) {
  const [linha] = await sql`
    SELECT base_url, token FROM instancias_uazapi WHERE id = ${id}`;
  if (!linha) throw new Error("Essa instância não existe mais em Configurações");
  return { baseUrl: linha.base_url as string, token: linha.token as string };
}

// Toda chamada à uazapi passa por aqui: mesmo tratamento de rede, mesmo
// tratamento de 401 e o mesmo teto de tempo. Sem o teto, uma instância
// pendurada segura a action até o timeout do servidor — e esta é uma tela que
// fica consultando em laço.
async function chamarUazapi(
  baseUrl: string,
  token: string,
  caminho: string,
  corpo?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${caminho}`, {
      method: corpo === undefined ? "GET" : "POST",
      headers:
        corpo === undefined
          ? { token }
          : { token, "Content-Type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error("Não consegui alcançar essa URL — confira o endereço");
  }
  if (!res.ok) {
    const erro = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(
      res.status === 401 || res.status === 403
        ? "Token inválido para essa instância"
        : erro?.error ?? `A uazapi respondeu ${res.status} — confira URL e token`,
    );
  }
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

/**
 * O número pareado, a partir da resposta da uazapi.
 *
 * `status.jid` chega nas DUAS formas e é por isso que há dois caminhos aqui:
 * o OpenAPI 2.1.1 declara um objeto ({ user, agent, device, server }), mas a
 * arckwpp, conferida ao vivo, devolve o texto "554788060306:11@s.whatsapp.net".
 * Só o caminho do texto existia antes, e ele funciona nessa instância — o do
 * objeto é para não quebrar num servidor que siga a especificação à risca.
 * `instance.owner`, o último recurso, é sempre texto.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function numeroDaResposta(data: any): string | null {
  const jid = data?.status?.jid;
  if (jid && typeof jid === "object" && typeof jid.user === "string") {
    return jid.user.replace(/\D/g, "") || null;
  }
  const texto = (typeof jid === "string" ? jid : null) ?? data?.instance?.owner;
  if (typeof texto !== "string" || !texto) return null;
  // Descarta sufixo de dispositivo e domínio; o que sobra tem que ser número.
  const so = texto.split(":")[0].split("@")[0].replace(/\D/g, "");
  return so || null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function conexaoDaResposta(data: any): ConexaoUazapi {
  const inst = data?.instance ?? {};
  const qr = typeof inst.qrcode === "string" ? inst.qrcode.trim() : "";
  return {
    estado: (inst.status as EstadoConexao) ?? "disconnected",
    // Base64 cru vira data URI; o que já veio prefixado passa direto.
    qrcode: qr ? (qr.startsWith("data:") ? qr : `data:image/png;base64,${qr}`) : null,
    paircode: (typeof inst.paircode === "string" && inst.paircode.trim()) || null,
    numero: numeroDaResposta(data),
    perfil: (typeof inst.profileName === "string" && inst.profileName.trim()) || null,
  };
}

// O número descoberto na uazapi é gravado na nossa linha — é ele que faz o
// /chat responder PELO MESMO número em que a conversa entrou
// (instanciaPorNumero, em lib/uazapi.ts) e que carimba
// atendimentos.numero_instancia. Sem gravar, parear pelo QR aqui não teria
// efeito nenhum no resto do CRM.
async function gravarNumero(id: string, numero: string | null) {
  if (!numero) return;
  await sql`
    UPDATE instancias_uazapi SET numero = ${numero}
    WHERE id = ${id} AND numero IS DISTINCT FROM ${numero}`;
}

async function statusDaInstancia(baseUrl: string, token: string) {
  const data = await chamarUazapi(baseUrl, token, "/instance/status");
  return {
    numero: numeroDaResposta(data),
    instanciaId:
      ((data as { instance?: { id?: string } })?.instance?.id as string | undefined) ??
      null,
  };
}

// "Conectar" testa a credencial de verdade antes de gravar — não é só salvar
// texto num formulário. Sem isso, um token errado só apareceria como erro
// silencioso lá na frente, no primeiro webhook ou no primeiro envio.
export async function conectarInstancia(
  nome: string,
  baseUrl: string,
  token: string,
): Promise<string> {
  const n = nome.trim();
  const url = baseUrl.trim().replace(/\/+$/, "");
  const tok = token.trim();
  if (!n) throw new Error("Nome é obrigatório");
  if (!url) throw new Error("URL da instância é obrigatória");
  if (!tok) throw new Error("Token é obrigatório");

  const { numero, instanciaId } = await statusDaInstancia(url, tok);

  try {
    const [i] = await sql`
      INSERT INTO instancias_uazapi (nome, base_url, token, numero, instancia_uazapi_id)
      VALUES (${n}, ${url}, ${tok}, ${numero}, ${instanciaId})
      RETURNING id`;
    revalidarInstancias();
    return i.id;
  } catch (e) {
    if (ehDuplicado(e)) {
      throw new Error("Já existe uma instância com esse nome ou esse token");
    }
    throw e;
  }
}

export async function renomearInstancia(id: string, nome: string): Promise<void> {
  const n = nome.trim();
  if (!n) throw new Error("Nome é obrigatório");
  try {
    await sql`UPDATE instancias_uazapi SET nome = ${n} WHERE id = ${id}`;
    revalidarInstancias();
  } catch (e) {
    if (ehDuplicado(e)) throw new Error("Já existe uma instância com esse nome");
    throw e;
  }
}

/**
 * Tira a instância do CRM. NÃO mexe na uazapi: a instância continua lá e o
 * WhatsApp segue pareado — quem desliga o aparelho é `desconectarDoWhatsApp`.
 *
 * São coisas separadas de propósito, e a arckwpp é o motivo: ela é
 * compartilhada com o SprintHub, então apagar o rótulo daqui não pode derrubar
 * o número de lá.
 */
export async function removerInstancia(id: string): Promise<void> {
  await sql`DELETE FROM instancias_uazapi WHERE id = ${id}`;
  revalidarInstancias();
}

/**
 * Começa o pareamento e devolve o QR Code — ou o código, quando vem telefone.
 *
 * Sem `telefone` a uazapi gera um QR Code que vale 2 minutos; com ele, um
 * código de pareamento que vale 5. Quem renova é a tela, consultando
 * `consultarConexao` em laço: o /instance/status devolve o QR atualizado
 * enquanto o estado for "connecting".
 */
export async function gerarQrCode(
  id: string,
  telefone?: string,
): Promise<ConexaoUazapi> {
  const { baseUrl, token } = await credencial(id);
  const fone = (telefone ?? "").replace(/\D/g, "");
  if (telefone && fone.length < 10) {
    throw new Error(
      "Número incompleto — use o formato 5547999999999, com DDI e DDD",
    );
  }

  const data = await chamarUazapi(
    baseUrl,
    token,
    "/instance/connect",
    fone ? { phone: fone } : {},
  );
  const conexao = conexaoDaResposta(data);
  if (conexao.numero) {
    await gravarNumero(id, conexao.numero);
    revalidarInstancias();
  }
  return conexao;
}

/**
 * O estado atual do pareamento — é o que a tela consulta em laço enquanto o QR
 * Code está na frente do usuário.
 *
 * NÃO revalida a rota a cada consulta, de propósito: seria re-renderizar a
 * página inteira a cada poucos segundos. Revalida só quando o número muda —
 * ou seja, quando o pareamento de fato aconteceu e a lista precisa refletir.
 */
export async function consultarConexao(id: string): Promise<ConexaoUazapi> {
  const { baseUrl, token } = await credencial(id);
  const data = await chamarUazapi(baseUrl, token, "/instance/status");
  const conexao = conexaoDaResposta(data);

  if (conexao.numero) {
    const [linha] = await sql`SELECT numero FROM instancias_uazapi WHERE id = ${id}`;
    if (linha?.numero !== conexao.numero) {
      await gravarNumero(id, conexao.numero);
      revalidarInstancias();
    }
  }
  return conexao;
}

/**
 * Desliga o WhatsApp da instância NA UAZAPI: o aparelho sai de "Aparelhos
 * conectados" no celular e reconectar exige QR Code novo.
 *
 * ⚠ Não é o mesmo que `removerInstancia`. Se a instância for compartilhada (a
 * arckwpp é, com o SprintHub), o número cai para os dois lados. A tela confirma
 * antes, com esse aviso escrito.
 */
export async function desconectarDoWhatsApp(id: string): Promise<ConexaoUazapi> {
  const { baseUrl, token } = await credencial(id);
  await chamarUazapi(baseUrl, token, "/instance/disconnect", {});
  // Relê em vez de presumir "disconnected": quem manda no estado é a uazapi.
  const data = await chamarUazapi(baseUrl, token, "/instance/status");
  revalidarInstancias();
  return conexaoDaResposta(data);
}
