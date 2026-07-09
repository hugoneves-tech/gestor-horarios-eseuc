import { useState, type FormEvent } from "react";
import { Calendar, Lock, Mail, LogIn, Loader2 } from "lucide-react";
import { useAuth } from "./AuthProvider";

const DOMINIO = "@ese.uc.pt";

export function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [aProcessar, setAProcessar] = useState(false);

  const submeter = async (e: FormEvent) => {
    e.preventDefault();
    setErro(null);
    if (!email.trim().toLowerCase().endsWith(DOMINIO)) {
      setErro(`Apenas contas institucionais (${DOMINIO}).`);
      return;
    }
    setAProcessar(true);
    try {
      const r = await signIn(email.trim(), password);
      if (r.error) setErro(r.error);
    } finally {
      setAProcessar(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#1F190D] flex items-center justify-center p-4 font-sans">
      <div className="w-full max-w-sm bg-[#FBF9F3] rounded-2xl shadow-2xl overflow-hidden">
        <div className="bg-[#1F190D] text-white px-6 py-6 flex items-center gap-3">
          <span className="p-2.5 bg-white/10 rounded-xl border border-white/10">
            <Calendar className="w-5 h-5 text-amber-200" />
          </span>
          <div>
            <h1 className="text-base font-serif tracking-wide">ESEUC • Gestor de Horários</h1>
            <p className="text-[10px] text-stone-300 font-light">Escola Superior de Enfermagem da Universidade de Coimbra</p>
          </div>
        </div>

        <form onSubmit={submeter} className="p-6 space-y-4">
          <h2 className="text-lg font-serif font-bold text-stone-900">Entrar</h2>

          <label className="block space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wide text-stone-500">Email institucional</span>
            <div className="flex items-center gap-2 bg-white border border-stone-200 rounded-lg px-3">
              <Mail className="w-4 h-4 text-stone-400" />
              <input
                type="email" required value={email} onChange={e => setEmail(e.target.value)}
                placeholder={`nome${DOMINIO}`}
                className="flex-1 py-2.5 text-sm bg-transparent focus:outline-none"
                autoComplete="email"
              />
            </div>
          </label>

          <label className="block space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wide text-stone-500">Palavra-passe</span>
            <div className="flex items-center gap-2 bg-white border border-stone-200 rounded-lg px-3">
              <Lock className="w-4 h-4 text-stone-400" />
              <input
                type="password" required value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="flex-1 py-2.5 text-sm bg-transparent focus:outline-none"
                autoComplete="current-password"
              />
            </div>
          </label>

          {erro && <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{erro}</p>}

          <button
            type="submit" disabled={aProcessar}
            className="w-full py-2.5 bg-[#D4A32A] hover:bg-[#B5861D] disabled:opacity-50 text-stone-900 font-bold rounded-lg text-sm flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            {aProcessar ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
            Entrar
          </button>

          <p className="text-center text-[11px] text-stone-400 leading-relaxed">
            O acesso é apenas por <strong className="text-stone-600">convite</strong> de um administrador.
            Não há registo livre.
          </p>
        </form>
      </div>
    </div>
  );
}
