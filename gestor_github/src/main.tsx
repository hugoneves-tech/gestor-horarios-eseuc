import {StrictMode, type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { LoginScreen } from './auth/LoginScreen';

function Ecra({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#1F190D] flex items-center justify-center text-stone-300 text-sm font-sans p-4 text-center">
      {children}
    </div>
  );
}

/** Login → perfil/convite → App. */
function Gate() {
  const { session, perfil, perfilCarregado, loading, semAuth, signOut } = useAuth();
  if (semAuth) return <App />;                       // sem Supabase configurado → sem login
  if (loading) return <Ecra>A carregar…</Ecra>;
  if (!session) return <LoginScreen />;
  if (!perfilCarregado) return <Ecra>A verificar acesso…</Ecra>;
  if (!perfil) {
    // Autenticado mas sem perfil → não foi convidado / acesso não atribuído.
    return (
      <Ecra>
        <div className="max-w-sm space-y-4">
          <p className="text-amber-200 font-serif text-lg">Sem acesso atribuído</p>
          <p className="text-stone-400 text-xs leading-relaxed">
            A conta <span className="font-mono text-stone-200">{session.user.email}</span> está autenticada
            mas ainda não tem acesso. O acesso é dado por convite de um administrador.
          </p>
          <button
            onClick={() => signOut()}
            className="text-[11px] bg-white/10 hover:bg-white/15 px-3 py-1.5 rounded-md font-bold uppercase tracking-wider cursor-pointer"
          >
            Sair
          </button>
        </div>
      </Ecra>
    );
  }
  return <App />;
}

// Gancho de DEV para testar a camada de dados Supabase a partir da consola/preview:
//   await window.__db.seed()      → semeia o mock no Supabase
//   await window.__db.carregar()  → lê tudo de volta (devolve contagens)
//   await window.__db.limpar()    → apaga tudo
if (import.meta.env.DEV) {
  Promise.all([
    import("./data/supabaseRepo"),
    import("./data/seed"),
    import("./data/supabaseClient"),
  ]).then(([{ repo }, { dadosIniciais }, { supabase }]) => {
    (window as any).__db = {
      repo,
      supabase,
      seed: () => repo.guardarTudo(dadosIniciais()),
      carregar: async () => {
        const d = await repo.carregarTudo();
        return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, (v as any[]).length]));
      },
      limpar: () => repo.limparTudo(),
      disponivel: () => repo.disponivel(),
    };
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <Gate />
    </AuthProvider>
  </StrictMode>,
);
