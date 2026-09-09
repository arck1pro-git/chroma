// Cliente Supabase pro BROWSER — usado só pra Realtime (assinar postgres_changes
// em mensagens/atendimentos). As queries de dados continuam indo pelo postgres.js
// no servidor (lib/db.ts); este cliente NÃO é a fonte dos dados, é só o "ouvido".
//
// URL e anon key são públicas (NEXT_PUBLIC_). A anon só enxerga o que as políticas
// de RLS permitirem — hoje leitura liberada em mensagens/atendimentos (sem auth
// ainda; fechar quando auth entrar).
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  // Sem sessão/persistência: não há login, é só o canal de realtime.
  { auth: { persistSession: false } },
);
