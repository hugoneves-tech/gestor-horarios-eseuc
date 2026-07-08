import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
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
  // UID do perfil já carregado. Evita recarregar (e re-montar a app) num refresh de token
  // do MESMO utilizador, que o Supabase dispara sempre que o separador volta a ter foco.
  const perfilUidRef = useRef<string | null>(null);

  const carregarPerfil = async (uid: string) => {
    setPerfilCarregado(false);
    if (!supabase) { setPerfilCarregado(true); return; }
    const { data } = await supabase
      .from("profiles")
      .select("id, email, papel, is_admin")
      .eq("id", uid)
      .maybeSingle();
    setPerfil(data ? { id: data.id, email: data.email, papel: data.papel, isAdmin: !!data.is_admin } : null);
    perfilUidRef.current = uid;
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
      setSession(s);  // atualiza sempre o token (silencioso)
      const uid = s?.user?.id ?? null;
      if (!uid) { perfilUidRef.current = null; setPerfil(null); setPerfilCarregado(true); return; }
      // Só recarrega o perfil se o utilizador MUDOU (login novo). Token refresh do mesmo
      // utilizador (ao voltar ao separador) não mexe em perfilCarregado → app não remonta.
      if (uid !== perfilUidRef.current) await carregarPerfil(uid);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn: AuthCtx["signIn"] = async (email, password) => {
    if (!supabase) return { error: "Supabase não configurado." };
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return error ? { error: traduzErro(error.message) } : {};
    } catch (err: any) {
      return { error: traduzErro(err.message || "Erro desconhecido") };
    }
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
  if (m.includes("failed to fetch")) return "Erro de ligação ao Supabase (Failed to fetch). O seu projeto Supabase pode estar em pausa, apagado, ou a chave do Netlify não está configurada corretamente. Se estiver a usar o Supabase, verifique se o URL e a Anon Key estão corretos no menu de Definições.";
  return msg;
}
