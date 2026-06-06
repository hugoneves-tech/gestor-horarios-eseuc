import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, supabaseConfigured } from "../data/supabaseClient";

export interface Perfil {
  id: string;
  email: string;
  papel: string;       // perfil da app (diretor_1, coordenador_2, …)
  isAdmin: boolean;
}

interface AuthCtx {
  session: Session | null;
  user: User | null;
  /** Perfil ESEUC do utilizador (null = autenticado mas sem acesso/convite). */
  perfil: Perfil | null;
  perfilCarregado: boolean;
  loading: boolean;
  /** True quando o Supabase não está configurado — corre sem autenticação. */
  semAuth: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  recarregarPerfil: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth fora de <AuthProvider>");
  return c;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [perfilCarregado, setPerfilCarregado] = useState(false);
  const [loading, setLoading] = useState(true);

  const carregarPerfil = async (uid: string) => {
    setPerfilCarregado(false);
    if (!supabase) { setPerfilCarregado(true); return; }
    const { data } = await supabase
      .from("profiles")
      .select("id, email, papel, is_admin")
      .eq("id", uid)
      .maybeSingle();
    setPerfil(data ? { id: data.id, email: data.email, papel: data.papel, isAdmin: !!data.is_admin } : null);
    setPerfilCarregado(true);
  };

  useEffect(() => {
    if (!supabase) { setLoading(false); setPerfilCarregado(true); return; }
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session?.user) await carregarPerfil(data.session.user.id);
      else setPerfilCarregado(true);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, s) => {
      setSession(s);
      if (s?.user) await carregarPerfil(s.user.id);
      else { setPerfil(null); setPerfilCarregado(true); }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn: AuthCtx["signIn"] = async (email, password) => {
    if (!supabase) return { error: "Supabase não configurado." };
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? { error: traduzErro(error.message) } : {};
  };

  const signOut: AuthCtx["signOut"] = async () => {
    await supabase?.auth.signOut();
  };

  return (
    <Ctx.Provider value={{
      session,
      user: session?.user ?? null,
      perfil,
      perfilCarregado,
      loading,
      semAuth: !supabaseConfigured,
      signIn, signOut,
      recarregarPerfil: async () => { if (session?.user) await carregarPerfil(session.user.id); },
    }}>
      {children}
    </Ctx.Provider>
  );
}

function traduzErro(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("invalid login")) return "Email ou palavra-passe incorretos.";
  if (m.includes("already registered")) return "Já existe uma conta com este email.";
  if (m.includes("password should be at least")) return "A palavra-passe deve ter pelo menos 6 caracteres.";
  if (m.includes("email not confirmed")) return "Confirma o email antes de entrar.";
  return msg;
}
