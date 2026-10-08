"use client";

// Usuários do CRM: quem ENTRA no sistema — e-mail, senha e departamento — e
// quem só aparece como responsável e autor (sem e-mail). O login se cria e se
// edita aqui desde 2026-10-07 ("o admin pode criar e editar um usuário. ele
// define email e senha e departamento"); antes, só pelo scripts/criar-usuario.ts.
//
// Quem abre a tela: Admin e TI (gereUsuarios, lib/auth/dal.ts). O TETO — quem
// não administra acessos não põe ninguém no TI nem edita conta de lá — é das
// actions; aqui ele só vira cadeado e opção apagada, para a pessoa saber antes
// de tentar.
//
// As iniciais são sugeridas a partir do nome, mas continuam editáveis — dois
// "Fabrício Almeida" na mesma tela precisam de um jeito de se distinguir.
import { useId, useState, useTransition } from "react";
import { Check, Eye, EyeOff, KeyRound, Lock, Pencil, Send, UserPlus, Users } from "lucide-react";
import type { DepartamentoDaConta, NumeroDeEnvio, UsuarioComConta } from "../dados";
import { criarUsuario, editarUsuario, type DadosUsuario } from "../actions";
import { botao, campoTexto } from "./ui";

/** O mesmo mínimo das actions (SENHA_MINIMA em ../actions.ts). */
const SENHA_MINIMA = 12;

const rotulo = "text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500";
// Campo que só vale com e-mail (senha, departamento) fica apagado sem ele.
const campo = `${campoTexto} disabled:cursor-not-allowed disabled:opacity-50`;
const botaoIcone =
  "flex size-7 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:pointer-events-none disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-50";

// Deriva iniciais do nome (1ª letra das 2 primeiras palavras) — só pra sugerir.
function iniciaisDe(nome: string) {
  const p = nome.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase();
}

/**
 * Uma senha forte, para quem cria a conta não ter que inventar: 16 caracteres
 * sem os que se confundem ao ditar (0/O, 1/l/I), sorteados pelo crypto do
 * navegador.
 */
function gerarSenha() {
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const sorteio = crypto.getRandomValues(new Uint32Array(16));
  return Array.from(sorteio, (n) => alfabeto[n % alfabeto.length]).join("");
}

// O número de WhatsApp DE ONDE a pessoa fala (usuarios.instancia_id), usado
// pela cadência quando "Sai por" está no responsável da oportunidade.
// Um <select> nativo: a lista é curta (os números de Integrações).
function SeletorNumero({
  valor,
  numeros,
  aoMudar,
  className,
}: {
  valor: string;
  numeros: NumeroDeEnvio[];
  aoMudar: (v: string) => void;
  className: string;
}) {
  return (
    <select
      value={valor}
      onChange={(e) => aoMudar(e.target.value)}
      aria-label="Número de envio"
      className={className}
    >
      <option value="">não envia</option>
      {numeros.map((n) => (
        <option key={n.id} value={n.id}>
          {n.nome}
          {n.numero ? ` · ${n.numero}` : " · não pareado"}
        </option>
      ))}
    </select>
  );
}

function Etiqueta({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
      {children}
    </span>
  );
}

// ── Usuários ─────────────────────────────────────────────────────────────────
export function UsuariosSection({
  usuarios,
  numeros,
  departamentos,
  euId,
  administraAcessos,
}: {
  usuarios: UsuarioComConta[];
  numeros: NumeroDeEnvio[];
  departamentos: DepartamentoDaConta[];
  euId: string;
  /** TI: põe gente em qualquer departamento e edita qualquer conta. */
  administraAcessos: boolean;
}) {
  // Um formulário aberto por vez: "novo" ou o id da linha em edição.
  const [aberto, setAberto] = useState<string | null>(usuarios.length === 0 ? "novo" : null);
  const nomeDoDepartamento = new Map(departamentos.map((d) => [d.id, d.nome]));
  const daPortaria = new Set(departamentos.filter((d) => d.gerenciaAcessos).map((d) => d.id));

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">
            <Users className="size-3.5 text-zinc-400" aria-hidden="true" />
            Usuários
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Com e-mail, senha e departamento, a pessoa entra no sistema e vê os
            módulos do departamento; sem e-mail, só aparece como responsável e
            autora. O WhatsApp é por onde a automação avisa a pessoa — vazio,
            ela não pode ser escolhida no bloco de notificação.
            {!administraAcessos && " Contas do TI, só o TI edita."}
          </p>
        </div>
        {aberto !== "novo" && (
          <button type="button" onClick={() => setAberto("novo")} className={botao}>
            <UserPlus className="size-4" aria-hidden="true" />
            Novo usuário
          </button>
        )}
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        {aberto === "novo" && (
          <div className={usuarios.length > 0 ? "mb-2 border-b border-zinc-100 pb-4 dark:border-zinc-800/70" : ""}>
            <FormularioConta
              departamentos={departamentos}
              numeros={numeros}
              souEu={false}
              administraAcessos={administraAcessos}
              aoFechar={() => setAberto(null)}
            />
          </div>
        )}

        {usuarios.length === 0 ? (
          aberto !== "novo" && (
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
              Nenhum usuário ainda — crie ao menos um para o chat ter identidade.
            </p>
          )
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800/70">
            {usuarios.map((u) =>
              aberto === u.id ? (
                <li key={u.id} className="py-4">
                  <FormularioConta
                    inicial={u}
                    departamentos={departamentos}
                    numeros={numeros}
                    souEu={u.id === euId}
                    administraAcessos={administraAcessos}
                    aoFechar={() => setAberto(null)}
                  />
                </li>
              ) : (
                <LinhaUsuario
                  key={u.id}
                  usuario={u}
                  numeros={numeros}
                  departamento={u.departamento_id ? nomeDoDepartamento.get(u.departamento_id) ?? null : null}
                  souEu={u.id === euId}
                  trancada={!administraAcessos && u.departamento_id !== null && daPortaria.has(u.departamento_id)}
                  aoEditar={() => setAberto(u.id)}
                />
              ),
            )}
          </ul>
        )}
      </div>
    </section>
  );
}

function LinhaUsuario({
  usuario,
  numeros,
  departamento,
  souEu,
  trancada,
  aoEditar,
}: {
  usuario: UsuarioComConta;
  numeros: NumeroDeEnvio[];
  departamento: string | null;
  souEu: boolean;
  /** Conta de quem administra acessos, vista por quem não administra. */
  trancada: boolean;
  aoEditar: () => void;
}) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
        {usuario.iniciais}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-zinc-900 dark:text-zinc-50">
          {usuario.nome}
          {souEu && <span className="text-zinc-400 dark:text-zinc-500"> · você</span>}
        </span>
        <span className="block truncate text-[11px] text-zinc-400 dark:text-zinc-500">
          {usuario.email ?? "sem login · só aparece como responsável"}
        </span>
      </span>
      {!usuario.ativo && <Etiqueta>desativado</Etiqueta>}
      {/* O departamento só existe para quem entra: é ele que diz o que a pessoa vê. */}
      {usuario.email && <Etiqueta>{departamento ?? "Sem departamento"}</Etiqueta>}
      {/* Sem número, a pessoa não aparece no seletor de "Avisar" da cadência —
          e isso precisa ser visível aqui, que é onde se resolve. */}
      <span className="hidden w-28 shrink-0 truncate text-right text-[11px] tabular-nums text-zinc-400 sm:block dark:text-zinc-500">
        {usuario.whatsapp ?? "sem WhatsApp"}
      </span>
      {/* O número de WhatsApp desta pessoa (usuarios.instancia_id). */}
      <span
        className="hidden w-32 shrink-0 items-center gap-1 truncate text-[11px] text-zinc-400 md:inline-flex dark:text-zinc-500"
        title="Número de WhatsApp desta pessoa (ainda sem uso nas automações)"
      >
        <Send className="size-3 shrink-0" aria-hidden="true" />
        <span className="truncate">
          {numeros.find((n) => n.id === usuario.instancia_id)?.nome ?? "não envia"}
        </span>
      </span>
      {trancada ? (
        <span
          title="Conta de quem administra acessos — só o TI edita"
          className="shrink-0 text-zinc-300 dark:text-zinc-600"
        >
          <Lock className="size-3.5" aria-hidden="true" />
          <span className="sr-only">Só o TI edita esta conta</span>
        </span>
      ) : (
        <button
          type="button"
          onClick={aoEditar}
          aria-label={`Editar ${usuario.nome}`}
          className="shrink-0 text-zinc-400 transition hover:text-zinc-900 dark:hover:text-zinc-50"
        >
          <Pencil className="size-3.5" aria-hidden="true" />
        </button>
      )}
    </li>
  );
}

// O mesmo formulário cria e edita. Na edição, a senha em branco mantém a atual
// — a tela nunca lê senha, só troca.
function FormularioConta({
  inicial,
  departamentos,
  numeros,
  souEu,
  administraAcessos,
  aoFechar,
}: {
  inicial?: UsuarioComConta;
  departamentos: DepartamentoDaConta[];
  numeros: NumeroDeEnvio[];
  souEu: boolean;
  administraAcessos: boolean;
  aoFechar: () => void;
}) {
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [iniciais, setIniciais] = useState(inicial?.iniciais ?? "");
  const [email, setEmail] = useState(inicial?.email ?? "");
  const [senha, setSenha] = useState("");
  const [verSenha, setVerSenha] = useState(false);
  const [departamentoId, setDepartamentoId] = useState(inicial?.departamento_id ?? "");
  const [whatsapp, setWhatsapp] = useState(inicial?.whatsapp ?? "");
  const [instanciaId, setInstanciaId] = useState(inicial?.instancia_id ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();
  const idSenha = useId();

  const jaEntra = Boolean(inicial?.email);
  const comEmail = email.trim() !== "";

  function salvar() {
    if (!nome.trim() || salvando) return;
    setErro(null);
    const dados: DadosUsuario = {
      nome,
      iniciais,
      whatsapp,
      instanciaId,
      email,
      // Sem e-mail não há login: senha e departamento nem viajam.
      senha: comEmail ? senha : "",
      departamentoId: comEmail ? departamentoId : "",
    };
    iniciar(async () => {
      try {
        const r = inicial ? await editarUsuario(inicial.id, dados) : await criarUsuario(dados);
        // Fecha só no sucesso. Na recusa fica aberto E DIZ O MOTIVO — sem
        // isso o formulário só piscava e voltava ao mesmo lugar.
        if (r.ok) aoFechar();
        else setErro(r.erro);
      } catch {
        setErro("Não deu para salvar agora — tente de novo.");
      }
    });
  }

  // Uma linha de ajuda, a que importa no momento.
  const dica = !comEmail
    ? "Sem e-mail, a pessoa não entra no sistema — só aparece como responsável e autora."
    : senha
      ? "Anote a senha e passe para a pessoa: depois de salvar, ninguém a vê de novo."
      : jaEntra
        ? "Senha em branco mantém a atual."
        : "Ela entra com este e-mail e a senha, e vê os módulos do departamento.";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        salvar();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") aoFechar();
      }}
      className="flex flex-col gap-3"
    >
      <h3 className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">
        {inicial ? `Editar ${inicial.nome}` : "Novo usuário"}
      </h3>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
        <label className="flex min-w-0 flex-col gap-1.5 sm:col-span-5">
          <span className={rotulo}>Nome</span>
          <input
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            autoFocus
            placeholder="Ex.: Renan Sampaio"
            className={campo}
          />
        </label>
        <label className="flex flex-col gap-1.5 sm:col-span-1">
          <span className={rotulo}>Iniciais</span>
          <input
            type="text"
            value={iniciais}
            onChange={(e) => setIniciais(e.target.value.toUpperCase())}
            maxLength={4}
            placeholder={iniciaisDe(nome) || "AB"}
            className={`${campo} text-center uppercase`}
          />
        </label>

        <label className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
          <span className={rotulo}>E-mail</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
            placeholder="nome@empresa.com.br"
            className={campo}
          />
        </label>
        <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
          <label htmlFor={idSenha} className={rotulo}>
            {jaEntra ? "Nova senha" : "Senha"}
          </label>
          <div className="relative">
            <input
              id={idSenha}
              type={verSenha ? "text" : "password"}
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              disabled={!comEmail}
              autoComplete="new-password"
              placeholder={jaEntra ? "em branco, mantém" : `mín. ${SENHA_MINIMA} caracteres`}
              className={`${campo} pr-16`}
            />
            <div className="absolute inset-y-0 right-1 flex items-center">
              <button
                type="button"
                onClick={() => {
                  setSenha(gerarSenha());
                  setVerSenha(true);
                }}
                disabled={!comEmail}
                title="Gerar uma senha forte"
                aria-label="Gerar uma senha forte"
                className={botaoIcone}
              >
                <KeyRound className="size-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setVerSenha((v) => !v)}
                disabled={!comEmail}
                aria-label={verSenha ? "Esconder a senha" : "Mostrar a senha"}
                aria-pressed={verSenha}
                className={botaoIcone}
              >
                {verSenha ? (
                  <EyeOff className="size-3.5" aria-hidden="true" />
                ) : (
                  <Eye className="size-3.5" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
        </div>
        <label className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
          <span className={rotulo}>Departamento</span>
          {/* O próprio departamento não muda aqui (seria se trancar fora desta
              tela) — quem muda é Acessos, com as travas dela. */}
          <select
            value={departamentoId}
            onChange={(e) => setDepartamentoId(e.target.value)}
            disabled={!comEmail || souEu}
            title={souEu ? "O seu departamento muda em Acessos" : undefined}
            className={campo}
          >
            {jaEntra ? (
              // "Sem departamento" é estado de verdade: entra e não vê nada —
              // é como se corta o acesso sem apagar a conta.
              <option value="">Sem departamento</option>
            ) : (
              <option value="" disabled>
                Escolha…
              </option>
            )}
            {departamentos.map((d) => {
              const soOTi = d.gerenciaAcessos && !administraAcessos;
              return (
                <option key={d.id} value={d.id} disabled={soOTi}>
                  {d.nome}
                  {soOTi ? " · só o TI define" : ""}
                </option>
              );
            })}
          </select>
        </label>

        <label className="flex min-w-0 flex-col gap-1.5 sm:col-span-3">
          <span className={rotulo}>WhatsApp</span>
          <input
            type="text"
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            placeholder="5547999999999"
            className={`${campo} tabular-nums`}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5 sm:col-span-3">
          <span className={rotulo}>Envia por</span>
          <SeletorNumero valor={instanciaId} numeros={numeros} aoMudar={setInstanciaId} className={campo} />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-[11px] text-zinc-500 dark:text-zinc-400">{dica}</p>
        <button
          type="button"
          onClick={aoFechar}
          className="rounded-lg px-3 py-2 text-[13px] text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
        >
          Cancelar
        </button>
        <button type="submit" disabled={!nome.trim() || salvando} className={botao}>
          {inicial ? (
            <Check className="size-4" aria-hidden="true" />
          ) : (
            <UserPlus className="size-4" aria-hidden="true" />
          )}
          {salvando ? "Salvando…" : inicial ? "Salvar" : "Criar usuário"}
        </button>
      </div>
      {erro && (
        <p role="alert" className="text-xs text-red-500">
          {erro}
        </p>
      )}
    </form>
  );
}
