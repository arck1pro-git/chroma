import "server-only";
import { sql } from "@/lib/db";
import { PERFIS } from "@/lib/social/perfis";
import { motivoDoErro, postagensDaConta } from "@/lib/instagram";
import { sincronizarComentarios } from "@/lib/instagram-comentarios";
import { responderComentarioComIa } from "@/lib/ia/comentarios";

/** Webhook é imediato; esta conferência recupera entregas ausentes sem depender de tela aberta. */
export async function varrerComentariosInstagram() {
  return sql.begin(async (tx: typeof sql) => {
    const [trava] = await tx`SELECT pg_try_advisory_xact_lock(hashtext('instagram:varredura')) AS obtida`;
    const resultado = { novos: 0, avaliados: 0, postagens: 0, falhas: 0, ocupado: !trava?.obtida };
    if (!trava?.obtida) return resultado;
    const inicio = Date.now();
    const regras = await sql`SELECT conta_id, midia_id FROM instagram_ia_regras WHERE midia_id IS NOT NULL`;
    for (const perfil of PERFIS) {
      // Regras específicas também podem apontar para publicações fora das recentes.
      const midias = new Set<string>(regras.filter((r) => r.conta_id === perfil.instagramId).map((r) => r.midia_id as string));
      const produtos = new Map<string, string | null>();
      try {
        for (const p of (await postagensDaConta(perfil)).slice(0, 10)) {
          produtos.set(p.id, p.produto ?? null);
          if (p.comentarios > 0) midias.add(p.id);
        }
      } catch (e) {
        resultado.falhas++;
        console.error('[instagram varredura] postagens:', motivoDoErro(e));
      }
      for (const midiaId of midias) {
        if (Date.now() - inicio > 120_000) break;
        try {
          const r = await sincronizarComentarios(perfil.instagramId, midiaId, true, produtos.get(midiaId) ?? null);
          resultado.novos += r.novos;
          resultado.postagens++;
        } catch (e) {
          resultado.falhas++;
          console.error('[instagram varredura] comentários:', motivoDoErro(e));
        }
      }
    }
    // A marca só sai depois da avaliação. Um corte de execução deixa os demais
    // para a próxima rodada; reservas únicas continuam protegendo contra reenvio.
    const pendentes = await sql`
      SELECT id FROM instagram_comentarios WHERE automacao_pendente
       AND NOT da_conta AND pai_id IS NULL AND data_criacao >= now() - interval '10 minutes'
      ORDER BY data_criacao LIMIT 100`;
    for (const c of pendentes) {
      if (Date.now() - inicio > 180_000) break;
      if (await responderComentarioComIa(c.id) === false) {
        resultado.falhas++;
        continue;
      }
      await sql`UPDATE instagram_comentarios SET automacao_pendente = false WHERE id = ${c.id}`;
      resultado.avaliados++;
    }
    await sql`UPDATE instagram_comentarios SET automacao_pendente = false
      WHERE automacao_pendente AND data_criacao < now() - interval '10 minutes'`;
    return resultado;
  });
}
