import React, { useState } from "react";
import { createPortal } from "react-dom";
import { X, Plus, Trash2, Calendar, RotateCcw, Info, AlertTriangle } from "lucide-react";
import type { AnoLetivoSemestre, SemanaPersonalizada } from "../types";

interface Props {
  anoSem: AnoLetivoSemestre;
  anosSemestres: AnoLetivoSemestre[];
  onSave: (v: AnoLetivoSemestre[]) => void;
  onClose: () => void;
}

export function ModalAlocacaoSemanas({
  anoSem,
  anosSemestres,
  onSave,
  onClose,
}: Props) {
  // Helper to pre-populate default 16 weeks from dataInicioSemestre
  const preencherSemanasDefault = (dataInicio: string): SemanaPersonalizada[] => {
    if (!dataInicio) return [];
    try {
      const parts = dataInicio.split("-").map(Number);
      const base = new Date(parts[0], parts[1] - 1, parts[2]);
      
      // Ensure we start on Monday of the week containing base
      const dow = base.getDay(); // 0=Sun, 1=Mon, ...
      const daysFromMonday = dow === 0 ? 6 : dow - 1;
      const monday = new Date(base);
      monday.setDate(base.getDate() - daysFromMonday);

      const list: SemanaPersonalizada[] = [];
      for (let i = 1; i <= 16; i++) {
        const seg = new Date(monday);
        seg.setDate(monday.getDate() + (i - 1) * 7);
        const sex = new Date(seg);
        sex.setDate(seg.getDate() + 6);

        const toISODate = (d: Date) => {
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        };

        list.push({
          numero: i,
          dataSegunda: toISODate(seg),
          dataSexta: toISODate(sex),
          isPausa: false,
          motivoPausa: "",
        });
      }
      return list;
    } catch (e) {
      console.error(e);
      return [];
    }
  };

  const [semanas, setSemanas] = useState<SemanaPersonalizada[]>(() => {
    if (anoSem.semanasPersonalizadas && anoSem.semanasPersonalizadas.length > 0) {
      return [...anoSem.semanasPersonalizadas];
    }
    return preencherSemanasDefault(anoSem.dataInicioSemestre || "");
  });

  const handleUpdateWeek = (numero: number, field: keyof SemanaPersonalizada, value: any) => {
    setSemanas(prev =>
      prev.map(s => (s.numero === numero ? { ...s, [field]: value } : s))
    );
  };

  const handleAddWeek = () => {
    setSemanas(prev => {
      const num = prev.length + 1;
      let segStr = "";
      let sexStr = "";
      if (prev.length > 0) {
        const last = prev[prev.length - 1];
        try {
          const parts = last.dataSegunda.split("-").map(Number);
          const lastSeg = new Date(parts[0], parts[1] - 1, parts[2]);
          const nextSeg = new Date(lastSeg);
          nextSeg.setDate(lastSeg.getDate() + 7);
          const nextSex = new Date(nextSeg);
          nextSex.setDate(nextSeg.getDate() + 6);

          const toISODate = (d: Date) => {
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          };
          segStr = toISODate(nextSeg);
          sexStr = toISODate(nextSex);
        } catch {
          segStr = last.dataSegunda;
          sexStr = last.dataSexta;
        }
      } else if (anoSem.dataInicioSemestre) {
        segStr = anoSem.dataInicioSemestre;
        try {
          const parts = segStr.split("-").map(Number);
          const base = new Date(parts[0], parts[1] - 1, parts[2]);
          const sex = new Date(base);
          sex.setDate(base.getDate() + 6);
          const toISODate = (d: Date) => {
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          };
          sexStr = toISODate(sex);
        } catch {
          sexStr = segStr;
        }
      }
      return [
        ...prev,
        {
          numero: num,
          dataSegunda: segStr,
          dataSexta: sexStr,
          isPausa: false,
          motivoPausa: "",
        },
      ];
    });
  };

  const handleRemoveLastWeek = () => {
    if (semanas.length <= 1) return;
    setSemanas(prev => prev.slice(0, -1));
  };

  const handleRecalcular = () => {
    if (
      window.confirm(
        `Isto irá recalcular as datas de todas as semanas sequencialmente a partir de ${
          anoSem.dataInicioSemestre || "data de início"
        }. Deseja continuar?`
      )
    ) {
      setSemanas(preencherSemanasDefault(anoSem.dataInicioSemestre || ""));
    }
  };

  const handleSave = () => {
    const nextList = anosSemestres.map(a =>
      a.id === anoSem.id ? { ...a, semanasPersonalizadas: semanas } : a
    );
    onSave(nextList);
    onClose();
  };

  // Compute pedagogical S-number for each week in real-time
  let currentPedNumber = 0;
  const listWithPedNumbers = semanas.map(s => {
    if (!s.isPausa) {
      currentPedNumber++;
    }
    return {
      ...s,
      pedNumber: s.isPausa ? null : currentPedNumber
    };
  });

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-start justify-center p-4 sm:p-6 lg:p-8 bg-stone-950/60 backdrop-blur-xs animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[calc(100vh-2rem)] md:max-h-[calc(100vh-4rem)] relative flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-start border-b border-stone-100 p-6 shrink-0">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-wider text-amber-700 font-mono">
              Calendário Académico
            </span>
            <h3 className="text-base font-serif font-bold text-stone-900 mt-0.5 flex items-center gap-1.5">
              <Calendar className="w-5 h-5 text-amber-600" />
              Alocação Semanal & Pausas: {anoSem.anoLetivo} ({anoSem.semestre}.º Semestre)
            </h3>
            <p className="text-xs text-stone-500 font-light mt-0.5">
              Personalize o início e fim de cada semana. Marcar uma semana como pausa impede a alocação de aulas nessa semana.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-stone-100 rounded-full text-stone-400 hover:text-stone-700 cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-4">

        {/* Info Alerts */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3 text-amber-800">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Efeito no Planeamento Semanal</p>
              <p className="font-light mt-0.5 leading-relaxed text-[11px]">
                Semanas marcadas como <strong>Pausa</strong> terão 0 dias úteis e 0 aulas. O motor de distribuição ajustará automaticamente as semanas letivas seguintes (por exemplo, se a S14 for marcada como Pausa, a semana letiva seguinte passa a ser a S14 pedagógica).
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2 bg-stone-50 border border-stone-200 rounded-xl p-3 text-stone-700">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-stone-500" />
            <div>
              <p className="font-bold">Alterações de Datas</p>
              <p className="font-light mt-0.5 leading-relaxed text-[11px]">
                Útil para acomodar interrupções intercalares sem perder a contagem das semanas pedagógicas de forma contínua e sequencial.
              </p>
            </div>
          </div>
        </div>

        {/* Weeks Management Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-stone-50 p-3 rounded-xl border border-stone-150">
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleAddWeek}
              className="px-2.5 py-1.5 bg-stone-900 hover:bg-stone-800 text-white rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Adicionar Semana {semanas.length + 1}
            </button>
            <button
              onClick={handleRemoveLastWeek}
              disabled={semanas.length <= 1}
              className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 disabled:opacity-40 text-rose-700 border border-rose-200 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Remover Última
            </button>
          </div>

          <button
            onClick={handleRecalcular}
            className="px-2.5 py-1.5 bg-white hover:bg-stone-100 text-stone-700 border border-stone-250 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5 text-stone-500" />
            Reiniciar Sequência Clássica
          </button>
        </div>

        {/* Weeks List */}
        <div className="border border-stone-200 rounded-xl overflow-hidden max-h-[42vh] overflow-y-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="bg-stone-100 border-b border-stone-200 text-stone-600 font-bold">
                <th className="p-3 w-20">Semana</th>
                <th className="p-3 w-44">Início (Segunda-feira)</th>
                <th className="p-3 w-44">Fim (Domingo)</th>
                <th className="p-3 w-32 text-center">Tipo de Semana</th>
                <th className="p-3">Designação da Pausa / Notas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {listWithPedNumbers.map((s, idx) => {
                return (
                  <tr
                    key={s.numero}
                    className={`transition-colors ${
                      s.isPausa ? "bg-rose-50/40 hover:bg-rose-50/60" : "hover:bg-stone-50/50"
                    }`}
                  >
                    <td className="p-3 font-bold font-mono text-stone-700 text-sm">
                      {s.isPausa ? (
                        <span className="text-[10px] text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full font-sans font-bold">
                          Pausa
                        </span>
                      ) : (
                        `S${s.pedNumber}`
                      )}
                    </td>
                    <td className="p-3">
                      <input
                        type="date"
                        value={s.dataSegunda}
                        onChange={e => handleUpdateWeek(s.numero, "dataSegunda", e.target.value)}
                        className="w-full bg-white border border-stone-200 rounded-lg px-2 py-1 text-xs focus:ring-1 focus:ring-amber-500 focus:outline-none font-mono"
                      />
                    </td>
                    <td className="p-3">
                      <input
                        type="date"
                        value={s.dataSexta}
                        onChange={e => handleUpdateWeek(s.numero, "dataSexta", e.target.value)}
                        className="w-full bg-white border border-stone-200 rounded-lg px-2 py-1 text-xs focus:ring-1 focus:ring-amber-500 focus:outline-none font-mono"
                      />
                    </td>
                    <td className="p-3 text-center">
                      <button
                        onClick={() => handleUpdateWeek(s.numero, "isPausa", !s.isPausa)}
                        className={`px-2.5 py-1 rounded-full text-[10px] font-bold border transition-all cursor-pointer ${
                          s.isPausa
                            ? "bg-rose-100 text-rose-800 border-rose-300 shadow-3xs"
                            : "bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100"
                        }`}
                      >
                        {s.isPausa ? "Pausa Letiva" : "Semana de Aulas"}
                      </button>
                    </td>
                    <td className="p-3">
                      <input
                        type="text"
                        value={s.motivoPausa || ""}
                        disabled={!s.isPausa}
                        placeholder={s.isPausa ? "Ex: Férias da Páscoa, Natal..." : "Semana letiva normal"}
                        onChange={e => handleUpdateWeek(s.numero, "motivoPausa", e.target.value)}
                        className="w-full bg-white border border-stone-200 disabled:bg-stone-50 disabled:text-stone-400 rounded-lg px-2.5 py-1 text-xs focus:ring-1 focus:ring-amber-500 focus:outline-none"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2 p-6 border-t border-stone-100 shrink-0 bg-stone-50 rounded-b-2xl">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold rounded-xl text-xs cursor-pointer transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            className="px-4.5 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-xs cursor-pointer shadow-sm hover:shadow transition-all"
          >
            Guardar Configuração
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
