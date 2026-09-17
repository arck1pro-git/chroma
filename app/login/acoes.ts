"use server";

// Entrar e sair. As duas únicas ações que respondem sem sessão.
import { redirect } from "next/navigation";
import { z } from "zod";
import { sql } from "@/lib/db";
import { conferirSenha } from "@/lib/auth/senha";
import { criarSessao, destruirSessao } from "@/lib/auth/sessao";

const Entrada = z.object({
  // trim/lowercase ANTES do pipe: em zod 4 a transformação roda depois da
  // validação do tipo, então validar o email primeiro recusaria " A@b.com "
  // por causa do espaço que a gente ia limpar em seguida.
  // z.email() e não o z.string().email(), que está deprecado em zod 4.
  email: z.string().trim().toLowerCase().pipe(z.email().max(200)),
  senha: z.string().min(1).max(200),
});

// Hash bem formado de uma senha aleatória que ninguém conhece. Quando o email
// não existe, conferimos a senha CONTRA ELE antes de recusar.
//
// Sem isso, email inexistente responde na hora e email existente demora os
// ~100ms do scrypt — e essa diferença é um oráculo: dá pra descobrir quem tem
// conta aqui só cronometrando as respostas.
const HASH_FALSO =
  "scrypt$32768$8$1$9VCADpphuGR+MQkku3rf5w==$PWzwYlSEMoCd4ANmBstvM7yMLvi/W51vzLbN7J6cVwg=";

// ── Freio de força bruta ────────────────────────────────────────────────────
// Em memória, por instância do servidor. É best-effort e eu prefiro dizer isso
// do que fingir: com várias instâncias (ou serverless frio) a contagem se
// divide entre elas. Mesmo assim tira do mapa o ataque de dicionário simples,
// que é o que de fato acontece em CRM exposto na internet. Freio de verdade,
// se precisar, é no banco ou numa borda tipo Cloudflare.
const TENTATIVAS_MAX = 8;
const JANELA_MS = 10 * 60 * 1000;
const tentativas = new Map<string, { contagem: number; expira: number }>();

function excedeu(chave: string): boolean {
  const agora = Date.now();
  const atual = tentativas.get(chave);
  if (!atual || atual.expira < agora) return false;
  return atual.contagem >= TENTATIVAS_MAX;
}

function registrarFalha(chave: string): void {
  const agora = Date.now();
  const atual = tentativas.get(chave);
  if (!atual || atual.expira < agora) {
    tentativas.set(chave, { contagem: 1, expira: agora + JANELA_MS });
    return;
  }
  atual.contagem += 1;
  // Poda oportunista: sem isto o Map cresce com cada email tentado e não
  // encolhe nunca — um ataque de dicionário viraria vazamento de memória.
  if (tentativas.size > 5000) {
    for (const [k, v] of tentativas) if (v.expira < agora) tentativas.delete(k);
  }
}

/**
 * `?de=` só pode levar pra DENTRO do CRM. Sem esta peneira, `/login?de=https://
 * site-falso` faria o nosso domínio despachar a pessoa pra fora logo depois de
 * ela digitar a senha — é o open redirect clássico, e ele presta justamente
 * porque o link começa no domínio de confiança.
 *
 * `//` no começo é rejeitado junto: `//outro.com` é URL absoluta para o
 * navegador, mesmo parecendo caminho.
 */
function destinoSeguro(de: unknown): string {
  if (typeof de !== "string" || !de.startsWith("/") || de.startsWith("//")) {
    return "/";
  }
  return de;
}

export type EstadoLogin = { erro: string | null };

export async function entrar(
  _anterior: EstadoLogin,
  formData: FormData,
): Promise<EstadoLogin> {
  const analisado = Entrada.safeParse({
    email: formData.get("email"),
    senha: formData.get("senha"),
  });

  // Mensagem ÚNICA pra todos os casos de recusa — formato inválido, email que
  // não existe, senha errada, usuário desativado. "Esse email não existe"
  // confirmaria pra quem está tentando quais contas valem a pena atacar.
  const RECUSA: EstadoLogin = { erro: "Email ou senha inválidos." };

  if (!analisado.success) return RECUSA;
  const { email, senha } = analisado.data;

  if (excedeu(email)) {
    return { erro: "Tentativas demais. Espere alguns minutos e tente de novo." };
  }

  // Sem `papel` e sem `departamento_id`: o login só precisa saber se a senha
  // confere. O que a pessoa pode ver é lido a cada render pela DAL, e ler aqui
  // seria uma cópia que envelhece dentro do cookie.
  const linhas = (await sql`
    SELECT id, senha_hash, ativo
      FROM usuarios
     WHERE lower(email) = ${email}
     LIMIT 1
  `) as {
    id: string;
    senha_hash: string | null;
    ativo: boolean;
  }[];

  const usuario = linhas[0];
  const confere = await conferirSenha(senha, usuario?.senha_hash ?? HASH_FALSO);

  if (!usuario || !usuario.ativo || !confere) {
    registrarFalha(email);
    return RECUSA;
  }

  tentativas.delete(email);
  await criarSessao({ usuarioId: usuario.id });
  await sql`UPDATE usuarios SET ultimo_acesso = now() WHERE id = ${usuario.id}`;

  // redirect() funciona lançando — tem que ficar FORA de qualquer try/catch,
  // senão o catch engole o desvio e a pessoa fica parada na tela de login.
  redirect(destinoSeguro(formData.get("de")));
}

export async function sair(): Promise<void> {
  await destruirSessao();
  redirect("/login");
}
