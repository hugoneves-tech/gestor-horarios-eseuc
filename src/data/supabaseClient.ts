import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente Supabase partilhado.
 * As credenciais vêm de variáveis Vite (`VITE_*`), expostas ao cliente.
 * A anon key é pública por design — a proteção real é o RLS no Supabase.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;

if (!supabaseConfigured) {
  // Não rebenta a app — apenas avisa. Permite correr sem Supabase configurado.
  console.warn(
    "[Supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY em falta — persistência desativada."
  );
}
