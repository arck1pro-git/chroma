"use server";

// Mutações das Configurações: criar funil e criar etapa dentro do funil.
// Revalida /configuracoes (a própria tela) e / (a raiz, onde o quadro mora).
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

  revalidatePath("/configuracoes");
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
  revalidatePath("/configuracoes");
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

  revalidatePath("/configuracoes");
  revalidatePath("/");
  return e.id;
}

export async function editarEtapa(id: string, nome: string): Promise<void> {
  const n = nome.trim();
  if (!n) throw new Error("Nome da etapa é obrigatório");
  await sql`UPDATE etapas SET nome = ${n} WHERE id = ${id}`;
  revalidatePath("/configuracoes");
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
  revalidatePath("/configuracoes");
  revalidatePath("/");
}

// ── Tags ─────────────────────────────────────────────────────────────────────
// nome é UNIQUE no schema — nome repetido vira erro amigável (não 500 cru).
function ehDuplicado(e: unknown) {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";
}

function revalidarTags() {
  revalidatePath("/configuracoes");
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
  revalidatePath("/configuracoes");
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
  revalidatePath("/configuracoes");
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
  revalidatePath("/configuracoes");
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
// "Conectar" testa a credencial de verdade antes de gravar — não é só salvar
// texto num formulário. Sem isso, um token errado só apareceria como erro
// silencioso lá na frente, no primeiro webhook ou no primeiro envio.
function revalidarInstancias() {
  revalidatePath("/configuracoes");
}

async function statusDaInstancia(baseUrl: string, token: string) {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/instance/status`, {
      headers: { token },
      cache: "no-store",
    });
  } catch {
    throw new Error("Não consegui alcançar essa URL — confira o endereço");
  }
  if (!res.ok) {
    throw new Error(
      res.status === 401 || res.status === 403
        ? "Token inválido para essa instância"
        : `A uazapi respondeu ${res.status} — confira URL e token`,
    );
  }
  const data = await res.json().catch(() => ({}));
  return {
    numero: (data?.status?.jid as string | undefined)?.split(":")[0]?.split("@")[0]
      ?? (data?.instance?.owner as string | undefined)
      ?? null,
    instanciaId: (data?.instance?.id as string | undefined) ?? null,
  };
}

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

export async function desconectarInstancia(id: string): Promise<void> {
  await sql`DELETE FROM instancias_uazapi WHERE id = ${id}`;
  revalidarInstancias();
}
