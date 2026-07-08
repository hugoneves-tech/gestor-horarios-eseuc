import { useEffect, useState, type FormEvent } from "react";
import { UserPlus, ShieldCheck, RefreshCw, Copy, Mail } from "lucide-react";
import { useAuth } from "./AuthProvider";

const PAPEIS = [
  "diretor_1", "diretor_2",
  "coordenador_1", "coordenador_2", "coordenador_3", "coordenador_4",
  "vice_coordenador_1", "vice_coordenador_2", "vice_coordenador_3", "vice_coordenador_4",
];

interface UtilizadorRow { id: string; email: string; papel: string; is_admin: boolean; created_at: string; }

export function AdminConvites() {
  const { session } = useAuth();
  const [email, setEmail] = useState("");
  const [papel, setPapel] = useState("coordenador_1");
  const [isAdmin, setIsAdmin] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ email: string; pass: string } | null>(null);
  const [aEnviar, setAEnviar] = useState(false);
  const [utilizadores, setUtilizadores] = useState<UtilizadorRow[]>([]);

  const token = session?.access_token;
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  const carregar = async () => {
    try {
      const r = await fetch("/api/admin/utilizadores", { headers });
      const d = await r.json();
      if (r.ok) setUtilizadores(d.utilizadores || []);
    } catch { /* ignore */ }
  };

  useEffect(() => { if (token) carregar(); /* eslint-disable-next-line */ }, [token]);

  const convidar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(null); setResultado(null); setAEnviar(true);
    try {
      const r = await fetch("/api/admin/convidar", {
        method: "POST", headers,
        body: JSON.stringify({ email: email.trim(), papel, isAdmin }),
      });
      const d = await r.json();
      if (!r.ok) { setErro(d.error || "Falha ao convidar."); return; }
      setResultado({ email: d.email, pass: d.passwordTemporaria });
      setEmail("");
      carregar();
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setAEnviar(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl p-6 border border-amber-200/65 shadow-xs space-y-5">
      <div className="border-b border-stone-100 pb-3">
        <span className="text-[10px] uppercase font-bold tracking-wider text-amber-600 font-mono">Administração</span>
        <h3 className="text-base font-serif font-bold text-stone-900 mt-1 flex items-center gap-1.5">
          <ShieldCheck className="w-5 h-5 text-amber-600" />
          Convidar Utilizadores
        </h3>
        <p className="text-xs text-stone-500 font-light mt-0.5">
          Cria contas institucionais (@ese.uc.pt). É gerada uma palavra-passe temporária para
          partilhares com a pessoa — não há registo livre.
        </p>
      </div>

      <form onSubmit={convidar} className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 items-end">
        <label className="space-y-1">
          <span className="text-[9px] uppercase font-bold text-stone-500">Email institucional</span>
          <input
            type="email" required value={email} onChange={e => setEmail(e.target.value)}
            placeholder="nome@ese.uc.pt"
            className="w-full bg-white border border-stone-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[9px] uppercase font-bold text-stone-500">Papel</span>
          <select value={papel} onChange={e => setPapel(e.target.value)}
            className="bg-white border border-stone-200 rounded-lg px-2 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400">
            {PAPEIS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <button type="submit" disabled={aEnviar}
          className="px-4 py-2 bg-stone-900 hover:bg-stone-800 disabled:opacity-50 text-white font-bold rounded-lg text-xs flex items-center gap-1.5 cursor-pointer">
          {aEnviar ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
          Convidar
        </button>
        <label className="sm:col-span-3 flex items-center gap-1.5 text-[10px] text-stone-500">
          <input type="checkbox" checked={isAdmin} onChange={e => setIsAdmin(e.target.checked)} />
          Conceder privilégios de administrador
        </label>
      </form>

      {erro && <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{erro}</p>}
      {resultado && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5 text-xs text-emerald-900 space-y-1">
          <p className="font-bold">Conta criada para {resultado.email}.</p>
          <p className="flex items-center gap-2">
            Palavra-passe temporária:
            <code className="font-mono bg-white px-2 py-0.5 rounded border border-emerald-200">{resultado.pass}</code>
            <button onClick={() => navigator.clipboard?.writeText(resultado.pass)} title="Copiar"
              className="text-emerald-700 hover:text-emerald-900 cursor-pointer"><Copy className="w-3.5 h-3.5" /></button>
          </p>
          <p className="text-[10px] text-emerald-700">Partilha-a com a pessoa; ela deve alterá-la depois de entrar.</p>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase font-bold text-stone-500 tracking-wide">Utilizadores ({utilizadores.length})</span>
          <button onClick={carregar} className="text-[10px] text-stone-500 hover:text-stone-800 flex items-center gap-1 cursor-pointer">
            <RefreshCw className="w-3 h-3" /> Atualizar
          </button>
        </div>
        <div className="divide-y divide-stone-100 border border-stone-150 rounded-lg overflow-hidden">
          {utilizadores.length === 0 && <p className="text-[11px] text-stone-400 italic px-3 py-2">Sem utilizadores.</p>}
          {utilizadores.map(u => (
            <div key={u.id} className="flex items-center justify-between px-3 py-2 text-[11px]">
              <span className="flex items-center gap-1.5 text-stone-700">
                <Mail className="w-3 h-3 text-stone-400" /> {u.email}
              </span>
              <span className="flex items-center gap-2">
                <span className="font-mono text-[9px] text-stone-500">{u.papel}</span>
                {u.is_admin && <span className="text-[8px] bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded font-bold uppercase">admin</span>}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
