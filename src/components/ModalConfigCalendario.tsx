import React, { useState } from "react";
import { X, Calendar as CalIcon, Check, Info } from "lucide-react";
import type { AnoLetivoSemestre, RegraHorario } from "../types";

interface Props {
  anosSemestres: AnoLetivoSemestre[];
  onSave: (novos: AnoLetivoSemestre[]) => void;
  onClose: () => void;
  prefManhaDe: (ano: number, sem: number) => boolean;
  setPrefManha: (ano: number, sem: number, manha: boolean) => void;
  regras: RegraHorario[];
  setRegras: (v: RegraHorario[]) => void;
  motorRegra: RegraHorario | undefined;
}

export function ModalConfigCalendario({ anosSemestres, onSave, onClose, prefManhaDe, setPrefManha, regras, setRegras, motorRegra }: Props) {
  const [draftAnoSem, setDraftAnoSem] = useState<AnoLetivoSemestre[]>([...anosSemestres]);
  const [draftMotor, setDraftMotor] = useState<any>(motorRegra ? { ...motorRegra.parametros } : {});

  // Extrair o ano letivo ativo atual para podermos configurar os seus semestres globais, caso necessário
  const activeAnoLetivo = anosSemestres[0]?.anoLetivo || "2024/2025";
  const sem1 = draftAnoSem.find(s => s.anoLetivo === activeAnoLetivo && s.semestre === 1);
  const sem2 = draftAnoSem.find(s => s.anoLetivo === activeAnoLetivo && s.semestre === 2);

  const updateGlobalDate = (id: string, date: string) => {
    setDraftAnoSem(prev => prev.map(a => a.id === id ? { ...a, dataInicioSemestre: date } : a));
  };

  const updateMotor = (key: string, value: any) => {
    setDraftMotor(prev => ({ ...prev, [key]: value }));
  };

  const parseWeeks = (str: string): number[] => {
    if (!str.trim()) return [];
    return str.split(',').map(s => {
      const parts = s.trim().split('-');
      if (parts.length === 2) {
        const start = parseInt(parts[0], 10);
        const end = parseInt(parts[1], 10);
        if (!isNaN(start) && !isNaN(end) && start <= end) {
          return Array.from({ length: end - start + 1 }, (_, i) => start + i);
        }
      } else {
         const val = parseInt(s, 10);
         if (!isNaN(val)) return [val];
      }
      return [];
    }).flat();
  };

  const formatWeeks = (weeks?: number[]): string => {
    if (!weeks || !weeks.length) return "";
    const sorted = [...new Set(weeks)].sort((a, b) => a - b);
    let out = [];
    let start = sorted[0];
    let end = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] === end + 1) {
        end = sorted[i];
      } else {
        out.push(start === end ? `${start}` : `${start}-${end}`);
        start = sorted[i];
        end = sorted[i];
      }
    }
    out.push(start === end ? `${start}` : `${start}-${end}`);
    return out.join(", ");
  };

  const handleWeekChange = (ano: number, turma: "A" | "B", val: string) => {
    const parsed = parseWeeks(val);
    updateMotor(`ano${ano}_semanasSoTurma${turma}`, parsed);
  };

  const save = () => {
    onSave(draftAnoSem);
    if (motorRegra) {
      setRegras(regras.map(r => r.id === motorRegra.id ? { ...r, parametros: draftMotor } : r));
    }
    onClose();
  };

  const CurricularYearCard = ({ ano }: { ano: number }) => {
    const s1Date = draftMotor[`ano${ano}_dataInicioSem1`] || sem1?.dataInicioSemestre || "";
    const s2Date = draftMotor[`ano${ano}_dataInicioSem2`] || sem2?.dataInicioSemestre || "";
    const wksA = formatWeeks(draftMotor[`ano${ano}_semanasSoTurmaA`] ?? draftMotor.semanasSoTurmaA ?? (ano === 2 ? Array.from({length:8},(_,i)=>8+i) : []));
    const wksB = formatWeeks(draftMotor[`ano${ano}_semanasSoTurmaB`] ?? draftMotor.semanasSoTurmaB ?? (ano === 2 ? Array.from({length:8},(_,i)=>16+i) : []));

    return (
      <div className="border border-stone-200 rounded-xl p-4 bg-white shadow-sm flex flex-col gap-4">
        <h3 className="font-bold text-sm text-stone-700 uppercase tracking-wider flex items-center gap-2 border-b border-stone-100 pb-2">
          <span className="bg-stone-100 text-stone-600 px-2 py-0.5 rounded-md">{ano}º Ano Curricular</span>
        </h3>
        
        <div className="grid grid-cols-2 gap-4">
          {/* SEMESTER 1 */}
          <div className="space-y-3 bg-stone-50/50 p-3 rounded-lg border border-stone-100">
            <h4 className="text-xs font-bold text-stone-800">1º Semestre</h4>
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-stone-500 tracking-wide">Data de Início Específica</label>
              <input type="date" value={s1Date} onChange={e => updateMotor(`ano${ano}_dataInicioSem1`, e.target.value)}
                className="w-full px-2 py-1.5 border border-stone-200 rounded-md text-xs focus:ring-1 focus:ring-teal-500 outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-stone-500 tracking-wide">Turno Turma A</label>
              <div className="flex p-0.5 bg-stone-200/50 rounded-md">
                <button onClick={() => setPrefManha(ano, 1, true)} className={`flex-1 text-[10px] font-semibold py-1 rounded transition-all ${prefManhaDe(ano, 1) ? "bg-white shadow-sm text-indigo-700" : "text-stone-500"}`}>Manhã</button>
                <button onClick={() => setPrefManha(ano, 1, false)} className={`flex-1 text-[10px] font-semibold py-1 rounded transition-all ${!prefManhaDe(ano, 1) ? "bg-white shadow-sm text-indigo-700" : "text-stone-500"}`}>Tarde</button>
              </div>
            </div>
          </div>

          {/* SEMESTER 2 */}
          <div className="space-y-3 bg-stone-50/50 p-3 rounded-lg border border-stone-100">
            <h4 className="text-xs font-bold text-stone-800">2º Semestre</h4>
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-stone-500 tracking-wide">Data de Início Específica</label>
              <input type="date" value={s2Date} onChange={e => updateMotor(`ano${ano}_dataInicioSem2`, e.target.value)}
                className="w-full px-2 py-1.5 border border-stone-200 rounded-md text-xs focus:ring-1 focus:ring-teal-500 outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-stone-500 tracking-wide">Turno Turma A</label>
              <div className="flex p-0.5 bg-stone-200/50 rounded-md">
                <button onClick={() => setPrefManha(ano, 2, true)} className={`flex-1 text-[10px] font-semibold py-1 rounded transition-all ${prefManhaDe(ano, 2) ? "bg-white shadow-sm text-indigo-700" : "text-stone-500"}`}>Manhã</button>
                <button onClick={() => setPrefManha(ano, 2, false)} className={`flex-1 text-[10px] font-semibold py-1 rounded transition-all ${!prefManhaDe(ano, 2) ? "bg-white shadow-sm text-indigo-700" : "text-stone-500"}`}>Tarde</button>
              </div>
            </div>
          </div>
        </div>

        {/* EXCLUSIVE WEEKS */}
        <div className="space-y-2 mt-2">
          <label className="text-[10px] uppercase font-bold text-stone-500 tracking-wide flex items-center gap-1">
            <Info className="w-3 h-3" /> Semanas Exclusivas (Turma Única)
          </label>
          <div className="flex gap-4">
            <div className="flex-1 space-y-1">
              <span className="text-[9px] text-stone-500 font-medium">Só Turma A (ex: 8-15)</span>
              <input type="text" value={wksA} onChange={e => handleWeekChange(ano, "A", e.target.value)} placeholder="Vazio = sem exclusividade"
                className="w-full px-2 py-1.5 border border-stone-200 rounded-md text-xs focus:ring-1 focus:ring-teal-500 outline-none" />
            </div>
            <div className="flex-1 space-y-1">
              <span className="text-[9px] text-stone-500 font-medium">Só Turma B (ex: 16-23)</span>
              <input type="text" value={wksB} onChange={e => handleWeekChange(ano, "B", e.target.value)} placeholder="Vazio = sem exclusividade"
                className="w-full px-2 py-1.5 border border-stone-200 rounded-md text-xs focus:ring-1 focus:ring-teal-500 outline-none" />
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-5 border-b border-stone-100 bg-stone-50/50">
          <div>
            <h2 className="text-lg font-serif font-bold text-stone-800 flex items-center gap-2">
              <CalIcon className="w-5 h-5 text-teal-600" />
              Configurar Calendário e Estrutura ({activeAnoLetivo})
            </h2>
            <p className="text-xs text-stone-500 mt-1">Configure o início letivo, turnos e semanas exclusivas (estágios) por ano curricular.</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-stone-200/50 rounded-full text-stone-400 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto bg-stone-50/30">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {[1, 2, 3, 4].map(ano => (
              <div key={ano}>
                {CurricularYearCard({ ano })}
              </div>
            ))}
          </div>
        </div>

        <div className="p-5 border-t border-stone-100 bg-stone-50 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-xs font-bold text-stone-600 hover:bg-stone-200/50 rounded-lg transition-colors">Cancelar</button>
          <button onClick={save} className="px-5 py-2 text-xs font-bold bg-teal-600 hover:bg-teal-700 text-white rounded-lg flex items-center gap-2 transition-all shadow-sm">
            <Check className="w-4 h-4" /> Guardar Configuração
          </button>
        </div>
      </div>
    </div>
  );
}
