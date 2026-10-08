"use server";

// Toda ação daqui é ponto de entrada de rede: o cliente posta direto nela.
// O proxy já barra quem não tem cookie; esta linha acrescenta o que ele não
// pode conferir sem ir ao banco — se a pessoa ainda existe e ainda está ativa.
import { exigirGestaoDeUsuarios, exigirModulo, type UsuarioLogado } from "@/lib/auth/dal";

// Mutações das Configurações — de funil e etapa a instância de WhatsApp.
//
// Revalida /configuracoes e / (a raiz, onde o quadro mora). O "layout" no
// revalidatePath das Configurações é obrigatório desde que cada seção virou
// uma rota (/configuracoes/funis, /configuracoes/whatsapp, …): sem ele, o
// caminho literal invalidaria só a tela índice, que hoje nem existe mais.
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { sql } from "@/lib/db";
import { gerarHash } from "@/lib/auth/senha";
import { corValida } from "@/lib/cores-funil";
import { enderecoDoCrm } from "@/lib/endereco";
import { NOME_EVENTO_META } from "@/lib/meta-eventos-nomes";

export async function criarFunil(
  nome: string,
  descricao: string,
  cor: string,
): Promise<string> {
  await exigirModulo("configuracoes");
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
 * Renomeia o funil e troca a descrição.
 *
 * O nome do funil aparece no quadro da raiz, no seletor de etapa das
 * automações e em toda ação de webhook que abre oportunidade — todas leem
 * `funis.nome` na hora, então não há nada a propagar aqui. É por isso que
 * renomear é só um UPDATE: nenhuma cópia do nome foi gravada noutro lugar.
 *
 * A descrição vem junto porque ela nasce no mesmo formulário de criação, e
 * separar as duas obrigaria a tela a ter dois modos de edição para um cartão só.
 */
export async function editarFunil(
  id: string,
  nome: string,
  descricao: string,
): Promise<void> {
  await exigirModulo("configuracoes");
  const n = nome.trim();
  if (!n) throw new Error("Nome do funil é obrigatório");

  await sql`
    UPDATE funis SET nome = ${n}, descricao = ${descricao.trim()}
    WHERE id = ${id}`;

  revalidatePath("/configuracoes", "layout");
  revalidatePath("/");
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
  await exigirModulo("configuracoes");
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
  await exigirModulo("configuracoes");
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
  await exigirModulo("configuracoes");
  const n = nome.trim();
  if (!n) throw new Error("Nome da etapa é obrigatório");
  await sql`UPDATE etapas SET nome = ${n} WHERE id = ${id}`;
  revalidatePath("/configuracoes", "layout");
  revalidatePath("/");
}

/**
 * Qual evento da Meta a etapa envia quando uma oportunidade entra nela.
 * `null` desliga. O envio em si mora em lib/meta-eventos.ts.
 *
 * Mudar o evento não reenvia nada para quem já está na etapa: o gatilho é a
 * ENTRADA, e quem já entrou entrou antes de a etapa mandar alguma coisa.
 */
export async function definirEventoMetaDaEtapa(
  id: string,
  evento: string | null,
): Promise<void> {
  await exigirModulo("configuracoes");
  const e = evento?.trim() || null;
  if (e && !NOME_EVENTO_META.test(e)) {
    throw new Error(
      "Nome de evento inválido: comece com letra e use só letras, números e _ (até 50).",
    );
  }
  await sql`UPDATE etapas SET meta_evento = ${e} WHERE id = ${id}`;
  revalidatePath("/configuracoes", "layout");
}

// Recebe os ids na ordem final (é o que o drag-and-drop já resolveu na tela)
// e regrava 1..N. Em transação: uma reordenação pela metade deixaria duas
// etapas com o mesmo `ordem` e o quadro empilharia colunas.
export async function reordenarEtapas(etapaIds: string[]): Promise<void> {
  await exigirModulo("configuracoes");
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
  await exigirModulo("configuracoes");
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
  await exigirModulo("configuracoes");
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
  await exigirModulo("configuracoes");
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
  await exigirModulo("configuracoes");
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
  await exigirModulo("configuracoes");
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
  await exigirModulo("configuracoes");
  await sql`DELETE FROM segmentos WHERE id = ${id}`;
  revalidarSegmentos();
}

// ── Usuários ─────────────────────────────────────────────────────────────────
// Desde 2026-10-07 esta seção também cria e edita o LOGIN — e-mail, senha e
// departamento (pedido dele: "o admin pode criar e editar um usuário"). Antes
// só o scripts/criar-usuario.ts fazia isso. Quem abre a tela está em
// gereUsuarios (lib/auth/dal.ts); o que cada um pode mexer, no teto abaixo.

// Iniciais: sempre do nome (1ª letra das 2 primeiras palavras). Deixaram de ser
// campo do formulário em 2026-10-08 ("sem inicial").
function iniciaisDe(nome: string) {
  const p = nome.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase();
}

function revalidarUsuarios() {
  revalidatePath("/configuracoes", "layout");
  revalidatePath("/chat");
  revalidatePath("/");
}

/**
 * Recusa que a pessoa precisa LER. Volta para a tela como `{ ok: false, erro }`
 * e não como exceção: em produção o Next troca a mensagem de erro lançado numa
 * Server Function por uma genérica — erro esperado é valor de retorno (guia
 * "Error Handling" do Next).
 */
class Recusa extends Error {}

/**
 * O WhatsApp de quem trabalha aqui, normalizado para o formato do banco: só
 * dígitos, com DDI. É por este número que a automação AVISA a pessoa (o bloco
 * "Enviar notificação"), então vazio é legítimo — a maioria não recebe aviso
 * nenhum, e exigir telefone travaria o cadastro de quem só existe para aparecer
 * como responsável.
 *
 * Número curto vira erro em vez de ser gravado torto: o CHECK da tabela recusa
 * de qualquer jeito, e o erro do Postgres não serve para ler.
 */
function whatsappOuNulo(bruto: string): string | null {
  const so = bruto.replace(/\D/g, "");
  if (!so) return null;
  // 10 = fixo com DDD sem DDI; 15 = teto do E.164. Fora disso é engano de
  // digitação, e um aviso indo para um número inexistente falha semanas depois.
  if (so.length < 10 || so.length > 15) {
    throw new Recusa(
      "WhatsApp inválido — use DDI, DDD e número (ex.: 5547921379 73)",
    );
  }
  return so;
}

/**
 * A instância de um vínculo usuário ↔ WhatsApp (usuarios.instancia_id). Só o id
 * atravessa, e precisa existir em Integrações: um id torto viraria erro de uuid
 * do Postgres, e um id de instância apagada, um "sem número" semanas depois.
 */
async function instanciaOuNula(bruto: string): Promise<string | null> {
  const id = bruto.trim();
  if (!id) return null;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Recusa("Número de envio inválido");
  const [i] = await sql`SELECT id FROM instancias_uazapi WHERE id = ${id}`;
  if (!i) throw new Recusa("Esse número de envio não existe mais em Integrações");
  return id;
}

// O e-mail como o login o lê (app/login/acoes.ts): sem espaço e minúsculo, e
// validado DEPOIS de normalizado. Gravado de outro jeito, a pessoa não entraria.
const EMAIL = z.string().trim().toLowerCase().pipe(z.email().max(200));

/** O mesmo mínimo do scripts/criar-usuario.ts, que era a porta até aqui. */
const SENHA_MINIMA = 12;

function emailOuNulo(bruto: string): string | null {
  if (!bruto.trim()) return null;
  const lido = EMAIL.safeParse(bruto);
  if (!lido.success) throw new Recusa("E-mail inválido");
  return lido.data;
}

/** null = não mexe na senha (o campo em branco da edição). */
function senhaOuNula(bruta: string): string | null {
  if (!bruta) return null;
  if (bruta.length < SENHA_MINIMA) {
    throw new Recusa(`A senha precisa de ao menos ${SENHA_MINIMA} caracteres`);
  }
  // O teto do login: senha maior que isto nunca conferiria lá.
  if (bruta.length > 200) throw new Recusa("Senha longa demais (máximo 200 caracteres)");
  return bruta;
}

type DepartamentoEscolhido = { id: string; nome: string; gerencia_acessos: boolean };

async function departamentoOuNulo(bruto: string): Promise<DepartamentoEscolhido | null> {
  const id = bruto.trim();
  if (!id) return null;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Recusa("Departamento inválido");
  const [d] = (await sql`
    SELECT id, nome, gerencia_acessos FROM departamentos WHERE id = ${id}
  `) as DepartamentoEscolhido[];
  if (!d) throw new Recusa("Esse departamento não existe mais");
  return d;
}

/**
 * O TETO DA PORTARIA: quem não administra acessos não põe ninguém num
 * departamento que administra. Sem ele, o Admin criaria uma conta no TI,
 * entraria por ela em Acessos e de lá se daria qualquer módulo — o desenho de
 * migration-departamentos.sql (gerencia_acessos separado de Configurações)
 * cairia por uma porta lateral.
 */
function conferirTeto(eu: UsuarioLogado, destino: DepartamentoEscolhido | null) {
  if (destino?.gerencia_acessos && !eu.departamento?.gerenciaAcessos) {
    throw new Recusa(`Só quem administra acessos põe alguém no ${destino.nome}`);
  }
}

/**
 * O formulário de usuário — o mesmo para criar e para editar.
 *
 * Sem o número de ENVIO (usuarios.instancia_id) desde 2026-10-08: ele é
 * definido ao criar a instância de WhatsApp (o "Usuário responsável") e trocado
 * em Configurações · WhatsApp. Salvar o usuário não toca nesse vínculo — senão
 * editar a senha de alguém apagaria o WhatsApp de onde ele envia.
 */
export type DadosUsuario = {
  nome: string;
  whatsapp: string;
  /** Vazio = sem login: a pessoa só aparece como responsável e autora. */
  email: string;
  /** Na edição, vazio mantém a senha atual. */
  senha: string;
  /** Vazio = sem departamento, que é não ver módulo nenhum. */
  departamentoId: string;
};

export type ResultadoUsuario = { ok: true } | { ok: false; erro: string };

async function comoResultado(fazer: () => Promise<void>): Promise<ResultadoUsuario> {
  try {
    await fazer();
    return { ok: true };
  } catch (e) {
    if (e instanceof Recusa) return { ok: false, erro: e.message };
    // 23505 = o índice único de lower(email) (migration-auth.sql).
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "23505") {
      return { ok: false, erro: "Já existe uma conta com esse e-mail" };
    }
    throw e;
  }
}

export async function criarUsuario(dados: DadosUsuario): Promise<ResultadoUsuario> {
  const eu = await exigirGestaoDeUsuarios();
  return comoResultado(async () => {
    const n = dados.nome.trim();
    if (!n) throw new Recusa("Nome é obrigatório");
    const ini = iniciaisDe(n);
    const email = emailOuNulo(dados.email);
    const senha = senhaOuNula(dados.senha);
    const departamento = await departamentoOuNulo(dados.departamentoId);

    if (email) {
      if (!senha) throw new Recusa("Defina a senha — é com ela e o e-mail que a pessoa entra");
      if (!departamento) throw new Recusa("Escolha o departamento — sem ele a pessoa entra e não vê nada");
    } else if (senha || departamento) {
      throw new Recusa("Senha e departamento são de quem entra no sistema: preencha o e-mail");
    }
    conferirTeto(eu, departamento);

    const whatsapp = whatsappOuNulo(dados.whatsapp);
    const hash = senha ? await gerarHash(senha) : null;
    await sql`
      INSERT INTO usuarios (nome, iniciais, whatsapp, email, senha_hash, departamento_id)
      VALUES (${n}, ${ini}, ${whatsapp}, ${email}, ${hash}, ${departamento?.id ?? null})`;
    revalidarUsuarios();
  });
}

export async function editarUsuario(id: string, dados: DadosUsuario): Promise<ResultadoUsuario> {
  const eu = await exigirGestaoDeUsuarios();
  const administro = eu.departamento?.gerenciaAcessos ?? false;
  return comoResultado(async () => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Recusa("Usuário inválido");
    const [alvo] = (await sql`
      SELECT u.email, u.departamento_id, COALESCE(d.gerencia_acessos, false) AS gerencia
        FROM usuarios u
        LEFT JOIN departamentos d ON d.id = u.departamento_id
       WHERE u.id = ${id}
    `) as { email: string | null; departamento_id: string | null; gerencia: boolean }[];
    if (!alvo) throw new Recusa("Esse usuário não existe mais");
    // O teto, do outro lado: a conta de quem administra acessos só quem
    // administra edita — trocar a senha dela seria entrar por ela.
    if (alvo.gerencia && !administro) {
      throw new Recusa("Esta conta é de quem administra acessos — só o TI a edita");
    }

    const n = dados.nome.trim();
    if (!n) throw new Recusa("Nome é obrigatório");
    const ini = iniciaisDe(n);
    const email = emailOuNulo(dados.email);
    const senha = senhaOuNula(dados.senha);
    const departamento = await departamentoOuNulo(dados.departamentoId);

    if (!email) {
      // Tirar o e-mail apagaria login e senha juntos. Para cortar o acesso sem
      // perder a conta existe "Sem departamento".
      if (alvo.email) {
        throw new Recusa('O e-mail é o login desta pessoa e não fica vazio — para tirar o acesso, escolha "Sem departamento"');
      }
      if (senha || departamento) {
        throw new Recusa("Senha e departamento são de quem entra no sistema: preencha o e-mail");
      }
    } else if (!alvo.email) {
      // Ganhando login agora: as mesmas exigências da conta nova.
      if (!senha) throw new Recusa("Defina a senha — é com ela e o e-mail que a pessoa vai entrar");
      if (!departamento) throw new Recusa("Escolha o departamento — sem ele a pessoa entra e não vê nada");
    }

    // O próprio departamento não muda aqui: seria se trancar fora desta tela
    // (ou, no TI, de Acessos). Quem muda é a tela de Acessos, com as travas
    // dela (ver moverParticipante em ./acoes-acessos.ts).
    if (id === eu.id && (departamento?.id ?? null) !== alvo.departamento_id) {
      throw new Recusa("O seu próprio departamento não muda aqui — peça a quem administra acessos");
    }
    conferirTeto(eu, departamento);

    const whatsapp = whatsappOuNulo(dados.whatsapp);
    const hash = senha ? await gerarHash(senha) : null;

    // O teto vai TAMBÉM no WHERE: entre a leitura acima e este UPDATE alguém
    // pode ter posto a pessoa num departamento que administra acessos.
    const feitos = await sql`
      UPDATE usuarios
         SET nome = ${n}, iniciais = ${ini}, whatsapp = ${whatsapp},
             email = ${email},
             senha_hash = COALESCE(${hash}::text, senha_hash),
             departamento_id = ${departamento?.id ?? null}
       WHERE id = ${id}
         AND (${administro}::boolean
              OR departamento_id IS NULL
              OR departamento_id NOT IN (SELECT id FROM departamentos WHERE gerencia_acessos))
      RETURNING id`;
    if (feitos.length === 0) {
      throw new Recusa("Esta conta mudou enquanto você editava — recarregue a página");
    }
    revalidarUsuarios();
  });
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
  await exigirModulo("configuracoes");
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
  await exigirModulo("configuracoes");
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
  await exigirModulo("configuracoes");
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
// ── O servidor uazapi e o token de ADMIN ────────────────────────────────────
//
// Dois tokens diferentes vivem nesta tela, e confundi-los é o erro caro:
//
//   · TOKEN DA INSTÂNCIA — fica no banco, numa linha por número. Serve para
//     parear, consultar e desconectar AQUELE número.
//   · ADMIN TOKEN — fica no .env, um por servidor uazapi. Cria e apaga
//     instância, e manda em TODAS as do servidor, inclusive as que não são
//     nossas. O arckwpp é compartilhado com o SprintHub: com este token dá para
//     derrubar o WhatsApp de lá sem querer.
//
// Por isso o admin token só aparece em duas funções, as duas abaixo, e nada
// que ele devolve (o token da instância nova, por exemplo) volta para a tela.
function servidorUazapi() {
  const base = (process.env.UAZAPI_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const admin = (process.env.UAZAPI_ADMIN_TOKEN ?? "").trim();
  if (!base || !admin) {
    throw new Error(
      "Criar instância exige UAZAPI_BASE_URL e UAZAPI_ADMIN_TOKEN no .env do servidor.",
    );
  }
  return { base, admin };
}

/** Chamada administrativa: header `admintoken`, não `token`. */
async function chamarAdminUazapi(
  caminho: string,
  corpo?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { base, admin } = servidorUazapi();
  let res: Response;
  try {
    res = await fetch(`${base}${caminho}`, {
      method: corpo === undefined ? "GET" : "POST",
      headers:
        corpo === undefined
          ? { admintoken: admin }
          : { admintoken: admin, "Content-Type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error("Não consegui alcançar o servidor uazapi");
  }
  if (!res.ok) {
    const erro = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(
      res.status === 401 || res.status === 403
        ? "Admin token inválido para este servidor uazapi"
        : erro?.error ?? `A uazapi respondeu ${res.status}`,
    );
  }
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

function revalidarInstancias() {
  // "layout": as Configurações viraram várias rotas (/configuracoes/funis,
  // /configuracoes/whatsapp, …) e o caminho literal só invalidaria uma delas.
  revalidatePath("/configuracoes", "layout");
  revalidatePath("/");
}

async function usuarioDaInstancia(usuarioId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(usuarioId)) {
    throw new Error("Selecione o usuário responsável por este WhatsApp");
  }
  const [usuario] = await sql`SELECT id FROM usuarios WHERE id = ${usuarioId}`;
  if (!usuario) throw new Error("Esse usuário não existe mais no sistema");
}

export async function usuariosParaVincularWhatsApp(): Promise<{ id: string; nome: string; instancia_id: string | null }[]> {
  await exigirModulo("configuracoes");
  return sql`SELECT id, nome, instancia_id FROM usuarios ORDER BY nome`;
}

export async function vincularUsuarioInstancia(instanciaId: string, usuarioId: string): Promise<void> {
  await exigirModulo("configuracoes");
  await usuarioDaInstancia(usuarioId);
  const id = await instanciaOuNula(instanciaId);
  if (!id) throw new Error("Selecione uma instância de WhatsApp");
  const [usuario] = await sql`
    UPDATE usuarios SET instancia_id = ${id} WHERE id = ${usuarioId} RETURNING id`;
  if (!usuario) throw new Error("Esse usuário não existe mais no sistema");
  revalidarInstancias();
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
  // Só o DELETE de /instance precisa disto. Sem o parâmetro, o método sai do
  // corpo: sem corpo é GET, com corpo é POST — que é como o resto da uazapi
  // funciona.
  metodo?: "DELETE",
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${caminho}`, {
      method: metodo ?? (corpo === undefined ? "GET" : "POST"),
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
  usuarioId: string,
): Promise<string> {
  await exigirModulo("configuracoes");
  const n = nome.trim();
  const url = baseUrl.trim().replace(/\/+$/, "");
  const tok = token.trim();
  if (!n) throw new Error("Nome é obrigatório");
  if (!url) throw new Error("URL da instância é obrigatória");
  if (!tok) throw new Error("Token é obrigatório");
  await usuarioDaInstancia(usuarioId);

  const { numero, instanciaId } = await statusDaInstancia(url, tok);

  try {
    const id = await sql.begin(async (tx: typeof sql) => {
      const [usuario] = await tx`SELECT id FROM usuarios WHERE id = ${usuarioId} FOR UPDATE`;
      if (!usuario) throw new Error("Esse usuário não existe mais no sistema");
      const [i] = await tx`
        INSERT INTO instancias_uazapi (nome, base_url, token, numero, instancia_uazapi_id)
        VALUES (${n}, ${url}, ${tok}, ${numero}, ${instanciaId}) RETURNING id`;
      await tx`UPDATE usuarios SET instancia_id = ${i.id} WHERE id = ${usuarioId}`;
      return i.id as string;
    });
    revalidarInstancias();
    return id;
  } catch (e) {
    if (ehDuplicado(e)) {
      throw new Error("Já existe uma instância com esse nome ou esse token");
    }
    throw e;
  }
}

export async function renomearInstancia(id: string, nome: string): Promise<void> {
  await exigirModulo("configuracoes");
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
 * Remove a instância — dos DOIS lados: apaga na uazapi e apaga a linha daqui.
 *
 * ⚠ NÃO TEM VOLTA. O aparelho sai de "Aparelhos conectados" no celular, a
 * instância some do servidor e o token dela morre junto. Qualquer outro sistema
 * que use aquele número para de receber na hora.
 *
 * Eram duas ações — "só do CRM" e "na uazapi também" —, separadas porque a
 * arckwpp é compartilhada com o SprintHub. Viraram uma só a pedido de quem usa:
 * na prática, instância que sai do CRM é instância que ninguém mais vai usar, e
 * deixá-la viva no servidor só gasta slot do plano. Quem quiser tirar o número
 * do CRM SEM matar a instância tem `desconectarDoWhatsApp` para desligar o
 * aparelho, ou o painel da uazapi.
 *
 * A ordem importa: a uazapi primeiro. Apagando a linha antes, uma falha lá
 * deixaria a instância órfã no servidor, sem nenhuma tela que a alcance.
 *
 * Instância que já não existe no servidor (apagada por fora, ou removida numa
 * tentativa anterior que falhou depois) NÃO trava a remoção: o 404 é tratado
 * como "já está como eu queria" e a linha sai do mesmo jeito.
 */
export async function removerInstancia(id: string): Promise<void> {
  await exigirModulo("configuracoes");
  const { baseUrl, token } = await credencial(id);

  const res = await fetch(`${baseUrl}/instance`, {
    method: "DELETE",
    headers: { token },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);

  if (!res) throw new Error("Não consegui alcançar a uazapi para apagar a instância");
  if (!res.ok && res.status !== 404) {
    const erro = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(
      res.status === 401 || res.status === 403
        ? "Token inválido para essa instância — ela não foi apagada"
        : erro?.error ?? `A uazapi respondeu ${res.status} ao apagar a instância`,
    );
  }

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
  await exigirModulo("configuracoes");
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
  await exigirModulo("configuracoes");
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
  await exigirModulo("configuracoes");
  const { baseUrl, token } = await credencial(id);
  await chamarUazapi(baseUrl, token, "/instance/disconnect", {});
  // Relê em vez de presumir "disconnected": quem manda no estado é a uazapi.
  const data = await chamarUazapi(baseUrl, token, "/instance/status");
  revalidarInstancias();
  return conexaoDaResposta(data);
}

// ── Criar instância NA UAZAPI, daqui ────────────────────────────────────────
//
// Antes, a única porta era `conectarInstancia`: alguém criava a instância no
// painel da uazapi, copiava URL e token e colava aqui. Agora o CRM cria — e o
// que muda de verdade não é o clique a menos, é o WEBHOOK: instância criada à
// mão entra sem webhook nenhum, pareia, envia, e nenhuma resposta chega ao
// /chat. Quem cria a instância é quem sabe qual é o endereço deste CRM.
//
// Contrato confirmado ao vivo contra a arckwpp (uazapiGO):
//   POST   {base}/instance/init   header admintoken  body { name }
//                                 → { instance: { id, token, status, … } }
//   POST   {base}/webhook         header token       body { enabled, url, events, … }
//   GET    {base}/webhook         header token       → [ { id, url, events, … } ]
//   GET    {base}/instance/all    header admintoken  → [ { id, status, … } ]
//   DELETE {base}/instance        header token       → apaga de vez

/** Os eventos que este CRM consome hoje (app/api/uazapi/webhook). */
const EVENTOS_WEBHOOK = ["messages", "messages_update"];

/**
 * A URL que a uazapi vai chamar. `numero` entra na querystring porque é ele que
 * carimba `atendimentos.numero_instancia` — é assim que o /chat responde pelo
 * mesmo número em que a conversa entrou. Antes de parear não há número, e a URL
 * nasce sem ele; `sincronizarWebhook` a completa quando o pareamento acontece.
 */
function urlDoWebhook(base: string, numero: string | null) {
  const segredo = process.env.UAZAPI_WEBHOOK_SECRET ?? "";
  const fim = numero ? `&numero=${numero}` : "";
  return `${base}/api/uazapi/webhook?secret=${encodeURIComponent(segredo)}${fim}`;
}

async function gravarWebhook(baseUrl: string, token: string, url: string) {
  await chamarUazapi(baseUrl, token, "/webhook", {
    enabled: true,
    url,
    events: EVENTOS_WEBHOOK,
    excludeMessages: [],
    addUrlEvents: false,
    addUrlTypesMessages: false,
  });
}

/**
 * Cria a instância no servidor uazapi, grava a linha e já aponta o webhook para
 * este CRM. O QR Code continua sendo o passo seguinte, pelo painel de conexão —
 * instância nasce `disconnected`, sem WhatsApp nenhum pendurado.
 *
 * O webhook é BEST-EFFORT: se falhar, a instância continua criada e gravada, e
 * a mensagem de volta diz o que ficou faltando. Desfazer a criação por causa do
 * webhook seria apagar uma instância boa por um passo que se refaz.
 */
export async function criarInstanciaNaUazapi(
  nome: string,
  usuarioId: string,
): Promise<{ id: string; aviso: string | null }> {
  await exigirModulo("configuracoes");
  const n = nome.trim();
  if (!n) throw new Error("Dê um nome à instância");
  await usuarioDaInstancia(usuarioId);

  const { base } = servidorUazapi();
  const data = (await chamarAdminUazapi("/instance/init", { name: n })) as {
    instance?: { id?: string; token?: string; name?: string };
    token?: string;
  };

  const token = data.instance?.token ?? data.token ?? "";
  const instanciaId = data.instance?.id ?? null;
  if (!token) {
    throw new Error("A uazapi criou a instância mas não devolveu o token dela");
  }

  let id: string;
  try {
    id = await sql.begin(async (tx: typeof sql) => {
      const [usuario] = await tx`SELECT id FROM usuarios WHERE id = ${usuarioId} FOR UPDATE`;
      if (!usuario) throw new Error("Esse usuário não existe mais no sistema");
      const [linha] = await tx`
        INSERT INTO instancias_uazapi (nome, base_url, token, numero, instancia_uazapi_id)
        VALUES (${n}, ${base}, ${token}, ${null}, ${instanciaId})
        RETURNING id`;
      await tx`UPDATE usuarios SET instancia_id = ${linha.id} WHERE id = ${usuarioId}`;
      return linha.id as string;
    });
  } catch (e) {
    if (ehDuplicado(e)) {
      throw new Error(
        `A instância foi criada na uazapi, mas já existe uma linha com o nome "${n}" aqui. Renomeie a antiga e cadastre esta pelo token.`,
      );
    }
    throw e;
  }

  // O endereço deste CRM sai do próprio request (lib/endereco.ts). Em
  // localhost ele não serve: a uazapi está na internet e não alcança a sua
  // máquina — por isso o aviso em vez do silêncio.
  let aviso: string | null = null;
  const endereco = enderecoDoCrm(await headers());
  if (!endereco.publico) {
    aviso = `Instância criada, mas o webhook não foi configurado: ${endereco.host} não é alcançável pela uazapi. Rode isto num domínio público (ou por túnel) e aponte o webhook de lá.`;
  } else {
    try {
      await gravarWebhook(base, token, urlDoWebhook(endereco.url, null));
    } catch (e) {
      aviso = `Instância criada, mas falhou apontar o webhook: ${
        e instanceof Error ? e.message : "erro desconhecido"
      }`;
    }
  }

  revalidarInstancias();
  return { id, aviso };
}

/**
 * Reescreve o webhook desta instância com o número já pareado — e SÓ quando o
 * webhook atual já aponta para este CRM.
 *
 * A condição é a parte importante. A arckwpp é compartilhada: uma instância
 * dela pode estar entregando para o SprintHub ou para um fluxo do n8n, e
 * reapontar aquilo daqui derrubaria a captação de outro sistema sem ninguém
 * perceber. Se a URL não é nossa, esta função não toca em nada e diz isso.
 */
export async function sincronizarWebhook(id: string): Promise<string> {
  await exigirModulo("configuracoes");
  const { baseUrl, token } = await credencial(id);
  const [linha] = await sql`SELECT numero FROM instancias_uazapi WHERE id = ${id}`;
  const numero = (linha?.numero as string | null) ?? null;

  const endereco = enderecoDoCrm(await headers());
  if (!endereco.publico) {
    return `${endereco.host} não é alcançável pela uazapi — o webhook não foi mexido.`;
  }

  const atual = (await chamarUazapi(baseUrl, token, "/webhook")) as unknown as
    | { url?: string }[]
    | null;
  const lista = Array.isArray(atual) ? atual : [];
  const nosso = lista.some((w) => (w.url ?? "").includes(endereco.host));

  if (lista.length > 0 && !nosso) {
    return "O webhook desta instância aponta para outro sistema. Não mexi — troque no painel da uazapi se for mesmo para vir pra cá.";
  }

  await gravarWebhook(baseUrl, token, urlDoWebhook(endereco.url, numero));
  return numero
    ? `Webhook apontado para este CRM, com o número ${numero}.`
    : "Webhook apontado para este CRM. Assim que parear, sincronize de novo para carimbar o número.";
}

/**
 * O estado de TODAS as instâncias numa chamada só (`/instance/all`, com o admin
 * token), para a lista pintar o ponto verde ou vermelho sem uma ida por linha.
 *
 * A chave do mapa é o id da NOSSA linha. O casamento é por
 * `instancia_uazapi_id`; quando ele é nulo — linhas cadastradas à mão antes
 * desta tela existir —, cai no número pareado. Instância que não aparecer na
 * resposta fica de fora do mapa, e a tela mostra "desconhecido" em vez de
 * inventar "desconectado".
 *
 * Sem admin token configurado, devolve o mapa vazio em silêncio: o ponto some,
 * o painel de conexão continua funcionando, e nada quebra.
 */
export async function statusDasInstancias(): Promise<Record<string, EstadoConexao>> {
  await exigirModulo("configuracoes");

  let remotas: { id?: string; status?: string; owner?: string }[];
  try {
    const data = await chamarAdminUazapi("/instance/all");
    remotas = Array.isArray(data) ? (data as typeof remotas) : [];
  } catch {
    return {};
  }

  const linhas = await sql`
    SELECT id, numero, instancia_uazapi_id FROM instancias_uazapi`;

  const mapa: Record<string, EstadoConexao> = {};
  for (const l of linhas) {
    const remota = remotas.find(
      (r) =>
        (l.instancia_uazapi_id && r.id === l.instancia_uazapi_id) ||
        (!l.instancia_uazapi_id && l.numero && r.owner === l.numero),
    );
    if (remota?.status) mapa[l.id as string] = remota.status as EstadoConexao;
  }
  return mapa;
}
