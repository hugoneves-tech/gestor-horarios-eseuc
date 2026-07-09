import React, { useState, useMemo } from "react";
import { Calendar, ChevronDown, ChevronRight, Zap, AlertTriangle, CheckCircle, Info, Clock, Settings } from "lucide-react";
import type { AnoLetivoSemestre, UC, FeriadoInterrupcao, VersaoHorario, RegraHorario } from "../types";
import { calcularSemanas, calcularPlano, gerarSessoesConjunto, distribuirBlocos, type SemanaInfo, type PlanoSemanal, type EntradaUC } from "../utils/distribuicao";
import { ModalConfigCalendario } from "./ModalConfigCalendario";
import { ModalAlocacaoSemanas } from "./ModalAlocacaoSemanas";

interface Props {
  anosSemestres: AnoLetivoSemestre[];
  setAnosSemestres: (v: AnoLetivoSemestre[]) => void;
  ucs: UC[];
  setUcs: (ucs: UC[]) => void;
  feriados: FeriadoInterrupcao[];
  versoes: VersaoHorario[];
  setVersoes: (v: VersaoHorario[]) => void;
  prefManhaDe: (ano: number, sem: number) => boolean;
  setPrefManha: (ano: number, sem: number, manha: boolean) => void;
  regras: RegraHorario[];
  setRegras: (v: RegraHorario[]) => void;
  motorRegra: RegraHorario | undefined;
}

export function ConfiguracaoCalendario({
  anosSemestres, setAnosSemestres,
  ucs, setUcs, feriados, versoes, setVersoes,
  prefManhaDe, setPrefManha,
  regras, setRegras, motorRegra
}: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalAlocacaoId, setModalAlocacaoId] = useState<string | null>(null);

  const handleSetDataInicio = (id: string, value: string) => {
    setAnosSemestres(anosSemestres.map(a => a.id === id ? { ...a, dataInicioSemestre: value } : a));
  };

  const ucsPorSemestre = (anoSem: AnoLetivoSemestre) =>
    ucs.filter(uc => uc.semestre === anoSem.semestre);

  const handleGerarSessoes = (anoSemestre: AnoLetivoSemestre) => {
    if (!anoSemestre.dataInicioSemestre) {
      setFeedback({ type: "err", msg: "Defina primeiro a data de início do semestre." });
      setTimeout(() => setFeedback(null), 4000);
      return;
    }
    const versao = versoes.find(v => v.anoSemestreId === anoSemestre.id);
    if (!versao) {
      setFeedback({ type: "err", msg: "Não existe versão de horário para este semestre." });
      setTimeout(() => setFeedback(null), 4000);
      return;
    }

    setIsGenerating(true);
    try {
      const ucsDeste = ucsPorSemestre(anoSemestre);
      // Shared occupancy + PL-count across all UCs of this semester so turmas are
      // never double-booked and at most 6 PL run simultaneously per year per mancha.
      const ocupacao = new Set<string>();
      const plCount = new Map<string, number>();
      const semanaGlobalOffset = anoSemestre.semestre === 2 ? 15 : 0;
      // Schedule all UCs of this semester together (round-robin) for fair slot sharing.
      const entradas: EntradaUC[] = ucsDeste.map(uc => {
        const specificDate = motorRegra?.parametros?.[`ano${uc.anoCurricular}_dataInicioSem${anoSemestre.semestre}`];
        const startWeek = uc.semanaInicio ?? 1;
        const endWeek = uc.semanaFim ?? (startWeek + uc.numSemanas - 1);
        return {
          uc,
          semanas: calcularSemanas(
            uc.dataInicio || specificDate || anoSemestre.dataInicioSemestre!,
            startWeek,
            endWeek,
            feriados,
            anoSemestre.semanasPersonalizadas
          ),
          semanaGlobalOffset,
        };
      });
      const todas = gerarSessoesConjunto(entradas, anoSemestre.semestre as 1 | 2, 0, ocupacao, plCount);

      setVersoes(versoes.map(v =>
        v.id === versao.id
          ? {
              ...v,
              sessoes: todas,
              nome: v.nome.replace("(por gerar)", "(gerado automaticamente)"),
            }
          : v
      ));

      setFeedback({
        type: "ok",
        msg: `${todas.length} sessões geradas para ${ucsDeste.length} UCs do ${anoSemestre.semestre}.º semestre.`,
      });
      setTimeout(() => setFeedback(null), 5000);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl p-6 border border-stone-150 shadow-xs space-y-5">
      {/* Header */}
      <div className="border-b border-stone-100 pb-3 flex justify-between items-start gap-4">
        <div>
          <span className="text-[10px] uppercase font-bold tracking-wider text-teal-700 font-mono">
            Calendário Académico ESEUC
          </span>
          <h3 className="text-base font-serif font-bold text-stone-900 mt-1 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-teal-600" />
            Configuração do Calendário e Distribuição Semanal
          </h3>
          <p className="text-xs text-stone-500 font-light mt-0.5 max-w-2xl">
            Defina a data de início de cada semestre e as preferências das turmas. A aplicação
            calcula automaticamente a distribuição proporcional ao longo das semanas letivas.
          </p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg text-[10px] font-bold flex items-center gap-1.5 transition-colors shrink-0"
        >
          <Settings className="w-4 h-4" />
          Configurações Avançadas
        </button>
      </div>

      {isModalOpen && (
        <ModalConfigCalendario
          anosSemestres={anosSemestres}
          onSave={setAnosSemestres}
          onClose={() => setIsModalOpen(false)}
          prefManhaDe={prefManhaDe}
          setPrefManha={setPrefManha}
          regras={regras}
          setRegras={setRegras}
          motorRegra={motorRegra}
        />
      )}

      {modalAlocacaoId && (() => {
        const targetSem = anosSemestres.find(a => a.id === modalAlocacaoId);
        if (!targetSem) return null;
        return (
          <ModalAlocacaoSemanas
            anoSem={targetSem}
            anosSemestres={anosSemestres}
            onSave={setAnosSemestres}
            onClose={() => setModalAlocacaoId(null)}
          />
        );
      })()}

      {/* Info box */}
      <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <p>
          A distribuição segue a lógica proporcional: se uma UC tem 10h T, 10h TP e 10h PL, em cada
          semana completa serão distribuídas 2h T + 2h TP + 2h PL (média). Semanas com feriados
          recebem menos sessões, mantendo os totais correctos.
          A sequência pedagógica <strong>T (Seg/Ter) → TP (Qua/Qui) → PL (Qui/Sex)</strong> é sempre respeitada.
        </p>
      </div>

      {/* Cards por semestre */}
      {anosSemestres.map(anoSem => {
        const ucsDeste = ucsPorSemestre(anoSem);
        const isOpen = expandedId === anoSem.id;
        const temData = !!anoSem.dataInicioSemestre;
        const versao = versoes.find(v => v.anoSemestreId === anoSem.id);
        const jaGerado = (versao?.sessoes?.length ?? 0) > 0;

        return (
          <div key={anoSem.id} className="border border-stone-150 rounded-xl overflow-hidden">
            {/* Card header */}
            <div className="bg-stone-50/70 px-4 py-3 flex flex-wrap items-center gap-3 justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setExpandedId(isOpen ? null : anoSem.id)}
                  className="text-stone-400 hover:text-stone-700 cursor-pointer transition-colors"
                >
                  {isOpen
                    ? <ChevronDown className="w-4 h-4" />
                    : <ChevronRight className="w-4 h-4" />}
                </button>
                <div>
                  <span className="font-serif font-bold text-stone-900 text-xs">
                    {anoSem.anoLetivo} — {anoSem.semestre}.º Semestre
                  </span>
                  <span className="ml-1.5 text-stone-400 text-[10px]">({anoSem.edicao})</span>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <button 
                      onClick={() => setAnosSemestres(anosSemestres.map(a => a.id === anoSem.id ? { ...a, ativo: !a.ativo } : a))}
                      className={`cursor-pointer px-1.5 py-0.5 rounded text-[8.5px] font-bold border transition-all ${
                      anoSem.ativo
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                        : "bg-stone-50 text-stone-400 border-stone-200 hover:bg-stone-100"
                    }`}>
                      {anoSem.ativo ? "Ativo" : "Inativo"}
                    </button>
                    <span className="text-[9px] text-stone-400">{ucsDeste.length} UC(s)</span>
                    {jaGerado && (
                      <span className="px-1.5 py-0.5 rounded text-[8.5px] font-bold border bg-teal-50 text-teal-700 border-teal-200">
                        {versao?.sessoes.length} sessões geradas
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                {temData && (
                  <>
                    <button
                      onClick={() => setModalAlocacaoId(anoSem.id)}
                      className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg text-[10px] font-bold flex items-center gap-1.5 cursor-pointer transition-all"
                    >
                      <Calendar className="w-3.5 h-3.5" />
                      Alocação de Semanas
                    </button>
                    <button
                      onClick={() => handleGerarSessoes(anoSem)}
                      disabled={isGenerating}
                      className="px-3 py-1.5 bg-teal-700 hover:bg-teal-600 disabled:opacity-50 text-white rounded-lg text-[10px] font-bold flex items-center gap-1.5 cursor-pointer transition-all"
                    >
                      <Zap className="w-3 h-3" />
                      {jaGerado ? "Regenerar Sessões" : "Gerar Sessões"}
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Distribuição expandida */}
            {isOpen && (
              <div className="p-4">
                {!temData ? (
                  <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    Defina a data de início do semestre para visualizar a distribuição semanal.
                  </div>
                ) : ucsDeste.length === 0 ? (
                  <p className="text-xs text-stone-400">Nenhuma UC configurada para este semestre.</p>
                ) : (
                  <DistribuicaoDetalhe anoSem={anoSem} ucsDeste={ucsDeste} ucs={ucs} setUcs={setUcs} feriados={feriados} motorRegra={motorRegra} />
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Feedback toast */}
      {feedback && (
        <div className={`flex items-center gap-2 rounded-lg p-3 text-xs animate-fade-in border ${
          feedback.type === "ok"
            ? "text-emerald-700 bg-emerald-50 border-emerald-200"
            : "text-rose-700 bg-rose-50 border-rose-200"
        }`}>
          {feedback.type === "ok"
            ? <CheckCircle className="w-4 h-4 shrink-0" />
            : <AlertTriangle className="w-4 h-4 shrink-0" />}
          {feedback.msg}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-componente: tabela de distribuição para um semestre
// ---------------------------------------------------------------------------

interface DetalheProps {
  anoSem: AnoLetivoSemestre;
  ucsDeste: UC[];
  ucs: UC[];
  setUcs: (ucs: UC[]) => void;
  feriados: FeriadoInterrupcao[];
  motorRegra?: RegraHorario;
}

function DistribuicaoDetalhe({ anoSem, ucsDeste, ucs, setUcs, feriados, motorRegra }: DetalheProps) {
  const [selectedUcId, setSelectedUcId] = useState(ucsDeste[0]?.id ?? "");
  const uc = ucsDeste.find(u => u.id === selectedUcId);

  const updatePlano = (semanaNum: number, tipo: "blocoT" | "blocoTP" | "blocoPL" | "blocoS", value: number) => {
    if (!uc) return;
    const planoDist = { ...(uc.planoDistribucao || {}) };
    
    // Calculate defaults first if not already initialized
    const defaultDistT = distribuirBlocos(Math.floor(uc.cargaHorariaTeorica / 2), semanas);
    const defaultDistTP = distribuirBlocos(Math.floor(uc.cargaHorariaTP / 2), semanas);
    const defaultDistPL = distribuirBlocos(Math.floor(uc.cargaHorariaPratica / 2), semanas);
    const defaultDistS = distribuirBlocos(Math.floor((uc.cargaHorariaS ?? 0) / 2), semanas);
    
    if (!planoDist[semanaNum.toString()]) {
       const wIndex = semanas.findIndex(s => s.numero === semanaNum);
       planoDist[semanaNum.toString()] = {
          blocoT: defaultDistT[wIndex] || 0,
          blocoTP: defaultDistTP[wIndex] || 0,
          blocoPL: defaultDistPL[wIndex] || 0,
          blocoS: defaultDistS[wIndex] || 0
       };
    }
    
    planoDist[semanaNum.toString()][tipo] = value;
    
    // Also, if updating one week, we should probably initialize all weeks in planoDistribucao
    // to avoid layout shifts when recalculating. Let's initialize all weeks if missing.
    semanas.forEach((s, idx) => {
      if (!planoDist[s.numero.toString()]) {
        planoDist[s.numero.toString()] = {
          blocoT: defaultDistT[idx] || 0,
          blocoTP: defaultDistTP[idx] || 0,
          blocoPL: defaultDistPL[idx] || 0,
          blocoS: defaultDistS[idx] || 0
        };
      }
    });

    setUcs(ucs.map(u => u.id === uc.id ? { ...u, planoDistribucao: planoDist } : u));
  };

  const semanas = useMemo<SemanaInfo[]>(() => {
    if (!uc || !anoSem.dataInicioSemestre) return [];
    
    const prop = `dataInicioAno${uc.anoCurricular}` as keyof typeof anoSem;
    const specificDate = (anoSem as any)?.[prop] || motorRegra?.parametros?.[`ano${uc.anoCurricular}_dataInicioSem${anoSem.semestre}`];
    const startDateToUse = uc.dataInicio || specificDate || anoSem.dataInicioSemestre;

    const startWeek = uc.semanaInicio ?? 1;
    const endWeek = uc.semanaFim ?? (startWeek + uc.numSemanas - 1);

    return calcularSemanas(
      startDateToUse,
      startWeek,
      endWeek,
      feriados,
      anoSem.semanasPersonalizadas
    );
  }, [uc, anoSem.dataInicioSemestre, feriados, anoSem.semanasPersonalizadas, motorRegra?.parametros, anoSem.semestre]);

  const plano = useMemo<PlanoSemanal[]>(() => {
    if (!uc || !semanas.length) return [];
    return calcularPlano(uc, semanas);
  }, [uc, semanas]);

  if (!uc) return null;

  const totalAvo = {
    T:  uc.cargaHorariaTeorica,
    TP: uc.cargaHorariaTP,
    PL: uc.cargaHorariaPratica,
    S:  uc.cargaHorariaS ?? 0,
  };
  const totalGerado = {
    T:  plano.reduce((s, p) => s + p.blocoT  * 2, 0),
    TP: plano.reduce((s, p) => s + p.blocoTP * 2, 0),
    PL: plano.reduce((s, p) => s + p.blocoPL * 2, 0),
    S:  plano.reduce((s, p) => s + p.blocoS  * 2, 0),
  };

  const tipos = (["T", "TP", "PL", "S"] as const).filter(t => totalAvo[t] > 0);

  const COLOR: Record<string, string> = {
    T:  "text-blue-700",
    TP: "text-teal-700",
    PL: "text-amber-700",
    S:  "text-purple-700",
  };

  return (
    <div className="space-y-4">
      {/* Selector de UC */}
      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-[10px] font-semibold text-stone-600 whitespace-nowrap">Pré-visualizar UC:</label>
        <select
          value={selectedUcId}
          onChange={e => setSelectedUcId(e.target.value)}
          className="px-2 py-1 border border-stone-200 rounded-lg text-xs bg-white"
        >
          {ucs.map(u => {
            const sStart = u.semanaInicio ?? 1;
            const sEnd = u.semanaFim ?? (sStart + u.numSemanas - 1);
            return (
            <option key={u.id} value={u.id}>
              {u.sigla} — {u.nome} (sem. {sStart}–{sEnd})
            </option>
            );
          })}
        </select>
        <span className="text-[9px] text-stone-400 font-mono">
          {semanas.length} semanas · {semanas.filter(s => s.feriadosNesta.length > 0).length} com feriados
        </span>
      </div>

      {/* Totais / verificação */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {tipos.map(t => {
          const ok = totalGerado[t] === totalAvo[t];
          const diff = totalGerado[t] - totalAvo[t];
          return (
            <div key={t} className={`p-2.5 rounded-xl border text-center ${
              ok ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"
            }`}>
              <span className={`block text-[9px] font-black uppercase tracking-wide ${COLOR[t]}`}>{t}</span>
              <span className={`block text-sm font-black mt-0.5 ${ok ? "text-emerald-700" : "text-amber-700"}`}>
                {totalGerado[t]}h
              </span>
              <span className="block text-[9px] text-stone-500">
                alvo: {totalAvo[t]}h{!ok && (
                  <span className="text-amber-600 ml-1">({diff > 0 ? "+" : ""}{diff}h)</span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      {/* Tabela semanal */}
      <div className="overflow-x-auto rounded-lg border border-stone-200">
        <table className="w-full text-[10px] border-collapse">
          <thead>
            <tr className="bg-stone-100">
              <th className="text-left p-2 font-bold text-stone-500 border-b border-stone-200 whitespace-nowrap">Semana</th>
              <th className="text-left p-2 font-bold text-stone-500 border-b border-stone-200 whitespace-nowrap">Datas</th>
              <th className="text-left p-2 font-bold text-stone-500 border-b border-stone-200">Dias úteis</th>
              {tipos.includes("T")  && <th className={`text-center p-2 font-bold border-b border-stone-200 ${COLOR.T}`}>T (h)</th>}
              {tipos.includes("TP") && <th className={`text-center p-2 font-bold border-b border-stone-200 ${COLOR.TP}`}>TP (h)</th>}
              {tipos.includes("PL") && <th className={`text-center p-2 font-bold border-b border-stone-200 ${COLOR.PL}`}>PL (h)</th>}
              {tipos.includes("S")  && <th className={`text-center p-2 font-bold border-b border-stone-200 ${COLOR.S}`}>S (h)</th>}
              <th className="text-left p-2 font-bold text-stone-400 border-b border-stone-200">Nota</th>
            </tr>
          </thead>
          <tbody>
            {plano.map(item => {
              const { semana, blocoT, blocoTP, blocoPL, blocoS } = item;
              const temFeriado = semana.feriadosNesta.length > 0;
              const isBreak = !!semana.isPausa;
              const rowBg = isBreak
                ? "bg-stone-50/70 text-stone-400 font-light"
                : temFeriado
                ? "bg-rose-50/60"
                : "hover:bg-stone-50";

              return (
                <tr
                  key={semana.numero}
                  className={`${rowBg} transition-colors`}
                >
                  <td className="p-2 border-b border-stone-100 font-bold text-stone-700">
                    {isBreak ? (
                      <span className="text-[10px] text-rose-600 font-bold bg-rose-50 px-1.5 py-0.5 rounded-md border border-rose-100">
                        Pausa
                      </span>
                    ) : (
                      `S${semana.numeroPedagogico ?? semana.numero}`
                    )}
                  </td>
                  <td className="p-2 border-b border-stone-100 text-stone-500 font-mono whitespace-nowrap">
                    {semana.dataSegunda.slice(5)} → {semana.dataSexta.slice(5)}
                  </td>
                  <td className="p-2 border-b border-stone-100 text-center">
                    <span className={`font-bold ${isBreak ? "text-stone-300" : semana.diasUteis < 5 ? "text-amber-600" : "text-stone-500"}`}>
                      {semana.diasUteis}/5
                    </span>
                  </td>
                  {tipos.includes("T") && (
                    <td className="p-2 border-b border-stone-100 text-center font-bold text-blue-700">
                      {!isBreak ? <input type="number" min="0" step="2" value={blocoT * 2} onChange={e => updatePlano(semana.numero, "blocoT", Math.floor(Number(e.target.value) / 2))} className="w-10 text-center border border-stone-200 rounded p-0.5 text-[10px]" /> : <span className="text-stone-200 font-normal">—</span>}
                    </td>
                  )}
                  {tipos.includes("TP") && (
                    <td className="p-2 border-b border-stone-100 text-center font-bold text-teal-700">
                      {!isBreak ? <input type="number" min="0" step="2" value={blocoTP * 2} onChange={e => updatePlano(semana.numero, "blocoTP", Math.floor(Number(e.target.value) / 2))} className="w-10 text-center border border-stone-200 rounded p-0.5 text-[10px]" /> : <span className="text-stone-200 font-normal">—</span>}
                    </td>
                  )}
                  {tipos.includes("PL") && (
                    <td className="p-2 border-b border-stone-100 text-center font-bold text-amber-700">
                      {!isBreak ? <input type="number" min="0" step="2" value={blocoPL * 2} onChange={e => updatePlano(semana.numero, "blocoPL", Math.floor(Number(e.target.value) / 2))} className="w-10 text-center border border-stone-200 rounded p-0.5 text-[10px]" /> : <span className="text-stone-200 font-normal">—</span>}
                    </td>
                  )}
                  {tipos.includes("S") && (
                    <td className="p-2 border-b border-stone-100 text-center font-bold text-purple-700">
                      {!isBreak ? <input type="number" min="0" step="2" value={blocoS * 2} onChange={e => updatePlano(semana.numero, "blocoS", Math.floor(Number(e.target.value) / 2))} className="w-10 text-center border border-stone-200 rounded p-0.5 text-[10px]" /> : <span className="text-stone-200 font-normal">—</span>}
                    </td>
                  )}
                  <td className="p-2 border-b border-stone-100 text-[9px]">
                    {isBreak && (
                      <span className="text-stone-500 font-medium italic">
                        {semana.motivoPausa || "Pausa letiva"}
                      </span>
                    )}
                    {temFeriado && !isBreak && (
                      <span className="text-rose-600">
                        ⚠ {semana.feriadosNesta.join(" + ")}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-stone-100 font-bold">
              <td className="p-2 text-stone-600" colSpan={3}>Total</td>
              {tipos.includes("T")  && <td className={`p-2 text-center ${COLOR.T}`}>{totalGerado.T}h</td>}
              {tipos.includes("TP") && <td className={`p-2 text-center ${COLOR.TP}`}>{totalGerado.TP}h</td>}
              {tipos.includes("PL") && <td className={`p-2 text-center ${COLOR.PL}`}>{totalGerado.PL}h</td>}
              {tipos.includes("S")  && <td className={`p-2 text-center ${COLOR.S}`}>{totalGerado.S}h</td>}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Legenda */}
      <div className="flex items-center gap-3 text-[9px] text-stone-400 flex-wrap">
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded bg-rose-100 border border-rose-300" /> semana com feriado/interrupção</span>
        <span className="flex items-center gap-1"><Clock className="w-2.5 h-2.5" /> blocos de 2h · sequência T→TP→PL por dias da semana</span>
      </div>
    </div>
  );
}
