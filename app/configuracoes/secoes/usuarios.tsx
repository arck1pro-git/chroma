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
// ENXUTO desde 2026-10-08 (pedido dele: "sem inicial, e sem o envia por"):
// - as iniciais saem sempre do nome, nas actions — não são mais campo;
// - o número de onde a pessoa ENVIA (usuarios.instancia_id) não se escolhe
//   aqui: é definido ao criar a instância de WhatsApp, que já pede o "Usuário
//   responsável", e trocado em Configurações · WhatsApp ("Vincular usuário").
//   Salvar o usuário não mexe nesse vínculo.
//
// O DESENHO (redesenho de 2026-10-08): a lista se parte em DOIS blocos — quem
// entra no sistema e quem só aparece como responsável —, porque são perguntas
// diferentes ("quem tem acesso?" × "quem assina card?") e misturadas uma
// escondia a outra. O formulário também se parte: a pessoa (nome, WhatsApp) e
// o acesso (e-mail, senha, departamento), que só vale com e-mail.
import { useId, useState, useTransition } from "react";
import {
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Pencil,
  Phone,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import type { DepartamentoDaConta, UsuarioComConta } from "../dados";
import { criarUsuario, editarUsuario, type DadosUsuario } from "../actions";
import { botao, botaoFantasma, campoTexto, rotuloCampo, textoAjuda } from "./ui";
import { Avatar, BotaoIcone, Cabecalho, Erro, formatarTelefone, Painel, PainelTopo } from "./pecas";

/** O mesmo mínimo das actions (SENHA_MINIMA em ../actions.ts). */
const SENHA_MINIMA = 12;

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

// ── Usuários ─────────────────────────────────────────────────────────────────
export function UsuariosSection({
  usuarios,
  departamentos,
  euId,
  administraAcessos,
}: {
  usuarios: UsuarioComConta[];
  departamentos: DepartamentoDaConta[];
  euId: string;
  /** TI: põe gente em qualquer departamento e edita qualquer conta. */
  administraAcessos: boolean;
}) {
  // Um formulário aberto por vez: "novo" ou o id da linha em edição.
  const [aberto, setAberto] = useState<string | null>(usuarios.length === 0 ? "novo" : null);
  const departamentoPorId = new Map(departamentos.map((d) => [d.id, d]));
  const comLogin = usuarios.filter((u) => u.email);
  const semLogin = usuarios.filter((u) => !u.email);

  function linhas(lista: UsuarioComConta[]) {
    return (
      // @container: as colunas de telefone e departamento aparecem pela
      // largura do PAINEL, não da janela — com a barra lateral aberta num
      // tablet, a janela é larga e o painel não.
      <ul className="@container divide-y divide-zinc-100 dark:divide-zinc-800/80">
        {lista.map((u) => {
          const departamento = u.departamento_id ? departamentoPorId.get(u.departamento_id) ?? null : null;
          return aberto === u.id ? (
            <li key={u.id} className="bg-zinc-50/60 dark:bg-zinc-900/30">
              <FormularioConta
                inicial={u}
                departamentos={departamentos}
                souEu={u.id === euId}
                administraAcessos={administraAcessos}
                aoFechar={() => setAberto(null)}
              />
            </li>
          ) : (
            <LinhaUsuario
              key={u.id}
              usuario={u}
              departamento={departamento}
              souEu={u.id === euId}
              trancada={!administraAcessos && Boolean(departamento?.gerenciaAcessos)}
              aoEditar={() => setAberto(u.id)}
            />
          );
        })}
      </ul>
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <Cabecalho
        Icone={Users}
        titulo="Usuários"
        contagem={usuarios.length}
        descricao={
          <>
            Quem entra no CRM e quem só aparece como responsável. Com e-mail,
            senha e departamento, a pessoa entra e vê os módulos do departamento.
            {!administraAcessos && " Contas do TI, só o TI edita."}
          </>
        }
        acao={
          aberto !== "novo" && (
            <button type="button" onClick={() => setAberto("novo")} className={botao}>
              <UserPlus className="size-4" aria-hidden="true" />
              Novo usuário
            </button>
          )
        }
      />

      {aberto === "novo" && (
        <Painel className="surge overflow-hidden">
          <FormularioConta
            departamentos={departamentos}
            souEu={false}
            administraAcessos={administraAcessos}
            aoFechar={usuarios.length > 0 ? () => setAberto(null) : undefined}
          />
        </Painel>
      )}

      {comLogin.length > 0 && (
        <Painel className="overflow-hidden">
          <PainelTopo
            titulo="Com acesso ao sistema"
            contagem={comLogin.length}
            descricao="Entram com e-mail e senha e veem os módulos do departamento."
          />
          {linhas(comLogin)}
        </Painel>
      )}

      {semLogin.length > 0 && (
        <Painel className="overflow-hidden">
          <PainelTopo
            titulo="Só responsáveis"
            contagem={semLogin.length}
            descricao="Sem login: aparecem como responsável de oportunidade e autor de mensagem. Dê um e-mail para que passem a entrar."
          />
          {linhas(semLogin)}
        </Painel>
      )}
    </section>
  );
}

function LinhaUsuario({
  usuario,
  departamento,
  souEu,
  trancada,
  aoEditar,
}: {
  usuario: UsuarioComConta;
  departamento: DepartamentoDaConta | null;
  souEu: boolean;
  /** Conta de quem administra acessos, vista por quem não administra. */
  trancada: boolean;
  aoEditar: () => void;
}) {
  const telefone = formatarTelefone(usuario.whatsapp);
  return (
    <li className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-zinc-50/80 dark:hover:bg-zinc-900/40">
      <Avatar nome={usuario.nome} iniciais={usuario.iniciais} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50">
          <span className="truncate">{usuario.nome}</span>
          {souEu && (
            <span className="shrink-0 rounded-full bg-zinc-900 px-1.5 py-px text-[10px] font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
              você
            </span>
          )}
          {!usuario.ativo && (
            <span className="shrink-0 rounded-full bg-zinc-100 px-1.5 py-px text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              desativado
            </span>
          )}
        </p>
        <p className="truncate text-[12px] text-zinc-500 dark:text-zinc-400">
          {usuario.email ?? "sem login"}
        </p>
      </div>

      {/* Sem número, a pessoa não aparece no seletor de "Avisar" das
          automações — e isso precisa ser visível aqui, que é onde se resolve. */}
      <span
        className={`hidden w-40 shrink-0 items-center gap-1.5 text-[12px] tabular-nums @2xl:flex ${
          telefone ? "text-zinc-600 dark:text-zinc-300" : "text-zinc-300 dark:text-zinc-600"
        }`}
        title={telefone ? "WhatsApp para os avisos das automações" : "Sem WhatsApp: não recebe avisos das automações"}
      >
        <Phone className="size-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
        {telefone ?? "sem WhatsApp"}
      </span>

      {/* O departamento só existe para quem entra: é ele que diz o que a
          pessoa vê. A chave marca o departamento que administra acessos. */}
      {usuario.email && (
        <span
          className={`hidden w-36 shrink-0 @md:block ${
            departamento ? "" : "text-zinc-400"
          }`}
        >
          <span className="inline-flex max-w-full items-center gap-1 truncate rounded-md border border-zinc-200 bg-white px-2 py-0.5 text-[12px] text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
            {departamento?.gerenciaAcessos && (
              <KeyRound className="size-3 shrink-0 text-zinc-400" aria-label="Administra acessos" />
            )}
            <span className="truncate">{departamento?.nome ?? "Sem departamento"}</span>
          </span>
        </span>
      )}

      {trancada ? (
        <span
          title="Conta de quem administra acessos — só o TI edita"
          className="flex size-8 shrink-0 items-center justify-center text-zinc-300 dark:text-zinc-600"
        >
          <Lock className="size-3.5" aria-hidden="true" />
          <span className="sr-only">Só o TI edita esta conta</span>
        </span>
      ) : (
        <BotaoIcone rotulo={`Editar ${usuario.nome}`} onClick={aoEditar}>
          <Pencil className="size-3.5" aria-hidden="true" />
        </BotaoIcone>
      )}
    </li>
  );
}

// O mesmo formulário cria e edita. Na edição, a senha em branco mantém a atual
// — a tela nunca lê senha, só troca.
function FormularioConta({
  inicial,
  departamentos,
  souEu,
  administraAcessos,
  aoFechar,
}: {
  inicial?: UsuarioComConta;
  departamentos: DepartamentoDaConta[];
  souEu: boolean;
  administraAcessos: boolean;
  /** Sem ele não há Cancelar: é o formulário da tela vazia. */
  aoFechar?: () => void;
}) {
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [email, setEmail] = useState(inicial?.email ?? "");
  const [senha, setSenha] = useState("");
  const [verSenha, setVerSenha] = useState(false);
  const [departamentoId, setDepartamentoId] = useState(inicial?.departamento_id ?? "");
  const [whatsapp, setWhatsapp] = useState(inicial?.whatsapp ?? "");
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
      whatsapp,
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
        if (r.ok) aoFechar?.();
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
        if (e.key === "Escape") aoFechar?.();
      }}
      className="@container flex flex-col"
    >
      <div className="flex items-center gap-3 px-5 pt-5">
        {inicial ? (
          <Avatar nome={inicial.nome} iniciais={inicial.iniciais} />
        ) : (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-dashed border-zinc-300 text-zinc-400 dark:border-zinc-700">
            <UserPlus className="size-4" aria-hidden="true" />
          </span>
        )}
        <h3 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-zinc-900 dark:text-zinc-50">
          {inicial ? `Editar ${inicial.nome}` : "Novo usuário"}
        </h3>
        {aoFechar && (
          <BotaoIcone rotulo="Fechar" onClick={aoFechar}>
            <X className="size-4" aria-hidden="true" />
          </BotaoIcone>
        )}
      </div>

      <div className="flex flex-col divide-y divide-zinc-100 px-5 dark:divide-zinc-800/80">
        {/* ── A pessoa ── */}
        <div className="grid gap-4 py-5 @2xl:grid-cols-[180px_1fr]">
          <div>
            <p className="text-[13px] font-medium text-zinc-900 dark:text-zinc-50">Pessoa</p>
            <p className={`${textoAjuda} mt-0.5`}>
              Como ela aparece nos cards e por onde as automações a avisam.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className={rotuloCampo}>Nome</span>
              <input
                type="text"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                autoFocus
                placeholder="Ex.: Renan Sampaio"
                className={campoTexto}
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className={rotuloCampo}>
                WhatsApp <span className="font-normal text-zinc-400">· para avisos</span>
              </span>
              <input
                type="text"
                inputMode="tel"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                placeholder="5547999999999"
                className={`${campoTexto} tabular-nums`}
              />
            </label>
          </div>
        </div>

        {/* ── O acesso ── */}
        <div className="grid gap-4 py-5 @2xl:grid-cols-[180px_1fr]">
          <div>
            <p className="text-[13px] font-medium text-zinc-900 dark:text-zinc-50">Acesso ao sistema</p>
            <p className={`${textoAjuda} mt-0.5`}>
              Senha e departamento só valem com e-mail.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
              <span className={rotuloCampo}>E-mail</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
                placeholder="nome@empresa.com.br"
                className={campoTexto}
              />
            </label>
            <div className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor={idSenha} className={rotuloCampo}>
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
                  className={`${campoTexto} pr-[4.5rem] ${senha ? "font-mono" : ""}`}
                />
                <div className="absolute inset-y-0 right-1 flex items-center">
                  <BotaoIcone
                    rotulo="Gerar uma senha forte"
                    onClick={() => {
                      setSenha(gerarSenha());
                      setVerSenha(true);
                    }}
                    disabled={!comEmail}
                    className="size-7"
                  >
                    <KeyRound className="size-3.5" aria-hidden="true" />
                  </BotaoIcone>
                  <BotaoIcone
                    rotulo={verSenha ? "Esconder a senha" : "Mostrar a senha"}
                    onClick={() => setVerSenha((v) => !v)}
                    disabled={!comEmail}
                    className="size-7"
                  >
                    {verSenha ? (
                      <EyeOff className="size-3.5" aria-hidden="true" />
                    ) : (
                      <Eye className="size-3.5" aria-hidden="true" />
                    )}
                  </BotaoIcone>
                </div>
              </div>
            </div>
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className={rotuloCampo}>Departamento</span>
              {/* O próprio departamento não muda aqui (seria se trancar fora desta
                  tela) — quem muda é Acessos, com as travas dela. */}
              <select
                value={departamentoId}
                onChange={(e) => setDepartamentoId(e.target.value)}
                disabled={!comEmail || souEu}
                title={souEu ? "O seu departamento muda em Acessos" : undefined}
                className={campoTexto}
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
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 px-5 py-3 dark:border-zinc-800/80">
        <p className={`${textoAjuda} min-w-0 flex-1`}>{dica}</p>
        {aoFechar && (
          <button type="button" onClick={aoFechar} className={botaoFantasma}>
            Cancelar
          </button>
        )}
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
        <div className="px-5 pb-4">
          <Erro>{erro}</Erro>
        </div>
      )}
    </form>
  );
}
