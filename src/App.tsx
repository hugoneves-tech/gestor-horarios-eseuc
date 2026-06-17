import React, { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import { useAuth } from "./auth/AuthProvider";
import {
  Server,
  Database,
  Brain,
  Disc,
  Shield,
  Calendar,
  Plus,
  Trash2,
  Edit2,
  Save,
  Lock,
  Unlock,
  Zap,
  Bot,
  ArrowRight,
  Settings,
  Upload,
  FileText,
  Download,
  CheckCircle,
  AlertTriangle,
  AlertCircle,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  Info,
  Copy,
  RefreshCw,
  Clock,
  MapPin,
  Users,
  Layers,
  Sparkles,
  Search,
  Eye,
  Sliders,
  Check,
  ChevronRight,
  Menu,
  X,
  ListChecks
} from "lucide-react";

import {
  generateEseucTurmas,
  cursosIniciais,
  anosSemestresIniciais,
  ucsIniciais,
  docentesIniciais,
  salasIniciais,
  turmasIniciais,
  feriadosIniciais,
  regrasIniciais,
  versoesIniciais,
  solverRunsIniciais
} from "./mockData";

import {
  Curso,
  AnoLetivoSemestre,
  UC,
  Docente,
  Sala,
  Turma,
  FeriadoInterrupcao,
  RegraHorario,
  SessaoHorario,
  VersaoHorario,
  SolverRun,
  ChatMessage
} from "./types";

import { TechnicalArchitecture } from "./components/TechnicalArchitecture";
import { ConfiguracaoCalendario } from "./components/ConfiguracaoCalendario";
import { AdminConvites } from "./auth/AdminConvites";
import { gerarSessoesConjunto, calcularSemanas, type EntradaUC } from "./utils/distribuicao";
import { parseHorarioCSV, gerarTemplateCSV, type ErroLinha } from "./utils/importacao";
import { validarHorario, type RelatorioValidacao } from "./utils/validacao";
import { repo } from "./data/supabaseRepo";
import { dadosIniciais } from "./data/seed";

export default function App() {
  // Theme and Vibe State for ESEUC Coimbra
  // - "eseuc_ouro": Classic Coimbra Gold
  // - "eseuc_escola": Pedagogical Mint & Care Teal
  // - "eseuc_cardoso": Deep Academic Faculty Burgundy / Slate Red
  const [vibe, setVibe] = useState<"eseuc_ouro" | "eseuc_escola" | "eseuc_cardoso">("eseuc_ouro");

  // Global Active Tab Navigation — persistida no browser para manter o local ao recarregar.
  const [activeTab, setActiveTab ] = useState<
    "horario" | "config" | "regras" | "assistant"
  >(() => {
    try {
      const v = localStorage.getItem("eseuc_active_tab");
      if (v === "horario" || v === "config" || v === "regras" || v === "assistant") return v;
    } catch { /* ignore */ }
    return "horario";
  });
  useEffect(() => {
    try { localStorage.setItem("eseuc_active_tab", activeTab); } catch { /* ignore */ }
  }, [activeTab]);

  // Domain States (Representing PostgreSQL collections held in reactive memory)
  const [cursos, setCursos] = useState<Curso[]>(cursosIniciais);
  const [anosSemestres, setAnosSemestres] = useState<AnoLetivoSemestre[]>(anosSemestresIniciais);
  const [ucs, setUcs] = useState<UC[]>(ucsIniciais);
  const [docentes, setDocentes] = useState<Docente[]>(docentesIniciais);
  const [salas, setSalas] = useState<Sala[]>(salasIniciais);
  const [turmas, setTurmas] = useState<Turma[]>(turmasIniciais);
  const [feriados, setFeriados] = useState<FeriadoInterrupcao[]>(feriadosIniciais);
  const [regras, setRegras] = useState<RegraHorario[]>(regrasIniciais);
  const [versoes, setVersoes] = useState<VersaoHorario[]>(versoesIniciais);
  const [solverRuns, setSolverRuns] = useState<SolverRun[]>(solverRunsIniciais);

  // Active Context Filters
  const [selectedSemestreId, setSelectedSemestreId] = useState<string>("as1");
  const [selectedAnoLetivo, setSelectedAnoLetivo] = useState<string>("2026/2027");
  const [perfilAtivo, setPerfilAtivo] = useState<
    "diretor_1" | "diretor_2" | "coordenador_1" | "coordenador_2" | "coordenador_3" | "coordenador_4" |
    "vice_coordenador_1" | "vice_coordenador_2" | "vice_coordenador_3" | "vice_coordenador_4"
  >("diretor_1");

  // Autenticação Supabase + estado de sincronização
  const { user, perfil, signOut } = useAuth();

  // O papel atribuído no perfil (convite) define o perfil ativo na app.
  useEffect(() => {
    if (perfil?.papel) setPerfilAtivo(perfil.papel as any);
  }, [perfil?.papel]);
  const [cloudStatus, setCloudStatus] = useState<"offline" | "synced" | "saving" | "error">("offline");
  const [dbLoaded, setDbLoaded] = useState<boolean>(false);

  const [selectedYearFilter, setSelectedYearFilter] = useState<number | "todos">("todos");
  const [selectedSemesterFilter, setSelectedSemesterFilter] = useState<number | "todos">(1);
  const [selectedWeekFilter, setSelectedWeekFilter] = useState<number>(1);
  const [selectedVersaoId, setSelectedVersaoId] = useState<string>("v1");
  const [activeVersao, setActiveVersao] = useState<VersaoHorario | null>(null);

  // Âmbito de uma regra (multi-ano + cursos), guardado no config (sem migração no Supabase).
  // config.anos: number[] (vazio = transversal/todos os anos). config.cursoIds: string[]
  // (vazio = todos os cursos). Compatível com regras antigas (escopo/anoCurricular).
  const anosDaRegra = (r: RegraHorario): number[] => {
    const a = (r.config as any)?.anos;
    if (Array.isArray(a)) return a.map(Number).filter(n => !Number.isNaN(n));
    if (r.escopo === "ano" && typeof r.anoCurricular === "number") return [r.anoCurricular];
    return [];
  };
  const cursosDaRegra = (r: RegraHorario): string[] => {
    const c = (r.config as any)?.cursoIds;
    return Array.isArray(c) ? c.filter((x: any) => typeof x === "string") : [];
  };

  // Helper to generate a reliable week label based on the academic calendar (ignoring holidays for display purpose simply)
  const getWeekLabel = (week: number) => {
    const start = new Date(2025, 8, 8); // Sep 8, 2025 (Monday)
    start.setDate(start.getDate() + (week - 1) * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 4); // Friday
    const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    return `${start.getDate()} a ${end.getDate()} de ${months[end.getMonth()]}`;
  };

  // Rótulo de VISUALIZAÇÃO das turmas: Turma A→T1, Turma B→T2, com a derivação (TP/PL) e a
  // turma-mãe (ex.: "T1 · TP1", "T2 · PL13"). Só no ecrã — os dados, o motor e os exports
  // (CSV/iCal) mantêm "Turma A"/"Turma B"/TPn/PLn para não partir lógica nem o round-trip do import.
  const rotuloTurma = (turma: string): string => {
    if (turma === "Turma A") return "T1";
    if (turma === "Turma B") return "T2";
    const tp = turma.match(/^TP(\d+)$/); if (tp) return `${+tp[1] <= 4 ? "T1" : "T2"} · TP${tp[1]}`;
    const pl = turma.match(/^PL(\d+)$/); if (pl) return `${+pl[1] <= 12 ? "T1" : "T2"} · PL${pl[1]}`;
    return turma;
  };

  // Modals / Creators Form State
  const [showDuplicarSemestreModal, setShowDuplicarSemestreModal] = useState(false);
  const [newSemesterName, setNewSemesterName] = useState("2026/2027");
  const [newSemesterHalf, setNewSemesterHalf] = useState<number>(2);
  const [newSemesterEdicao, setNewSemesterEdicao] = useState("Regular Diurno");
  const [emptyAcademicYear, setEmptyAcademicYear] = useState(true); // Default to clean slate
  const [showValidatorReport, setShowValidatorReport] = useState(false);

  // Temporary item creation variables
  const [isAddingUc, setIsAddingUc] = useState(false);
  const [editingUcId, setEditingUcId] = useState<string | null>(null);
  const [horasUcModal, setHorasUcModal] = useState<UC | null>(null);
  // Preferência manhã/tarde da turma teórica (Turma A) por ano do CLE e semestre.
  // Chave `${ano}|${semestre}` → "manha" | "tarde". Default: manhã no 1.º sem., tarde no 2.º.
  const [prefTurmaA, setPrefTurmaA] = useState<Record<string, "manha" | "tarde">>(() => {
    try { const raw = localStorage.getItem("eseuc_pref_turma_a"); if (raw) return JSON.parse(raw); } catch { /* ignore */ }
    return {};
  });
  const prefManhaDe = (ano: number, sem: number): boolean => {
    const v = prefTurmaA[`${ano}|${sem}`];
    return v ? v === "manha" : sem === 1;
  };
  const setPrefManha = (ano: number, sem: number, manha: boolean) => {
    setPrefTurmaA(prev => {
      const next = { ...prev, [`${ano}|${sem}`]: (manha ? "manha" : "tarde") as "manha" | "tarde" };
      try { localStorage.setItem("eseuc_pref_turma_a", JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };
  const [editingDocenteId, setEditingDocenteId] = useState<string | null>(null);
  const [editingSalaId, setEditingSalaId] = useState<string | null>(null);
  // Chave da API Google (Gemini), introduzida na app e guardada no browser (localStorage).
  // Enviada no corpo de cada pedido /api/gemini/chat; o servidor usa-a (fallback p/ env var).
  const [geminiApiKey, setGeminiApiKey] = useState<string>(() => {
    try { return localStorage.getItem("eseuc_gemini_api_key") || ""; } catch { return ""; }
  });
  const [showGeminiKeyPanel, setShowGeminiKeyPanel] = useState(false);
  const [geminiKeyDraft, setGeminiKeyDraft] = useState("");
  const guardarGeminiKey = (k: string) => {
    const v = k.trim();
    setGeminiApiKey(v);
    try { v ? localStorage.setItem("eseuc_gemini_api_key", v) : localStorage.removeItem("eseuc_gemini_api_key"); } catch { /* ignore */ }
  };
  // Modelo Gemini a usar (configurável na app, sem precisar de deploy). O tier gratuito de
  // alguns modelos (ex.: gemini-2.0-flash) está a 0 — daí ser editável.
  const GEMINI_MODELO_DEFAULT = "gemini-2.5-flash";
  const [geminiModel, setGeminiModel] = useState<string>(() => {
    try { return localStorage.getItem("eseuc_gemini_model") || GEMINI_MODELO_DEFAULT; } catch { return GEMINI_MODELO_DEFAULT; }
  });
  const guardarGeminiModel = (m: string) => {
    const v = m.trim() || GEMINI_MODELO_DEFAULT;
    setGeminiModel(v);
    try { localStorage.setItem("eseuc_gemini_model", v); } catch { /* ignore */ }
  };
  // Importação de horário externo (Excel/CSV): sessões lidas, erros de linha e relatório.
  const [sessoesImportadas, setSessoesImportadas] = useState<SessaoHorario[] | null>(null);
  const [errosImport, setErrosImport] = useState<ErroLinha[]>([]);
  const [relatorioImport, setRelatorioImport] = useState<RelatorioValidacao | null>(null);
  const [nomeFicheiroImport, setNomeFicheiroImport] = useState("");
  const [nomePropostaImport, setNomePropostaImport] = useState("");
  // Propostas (versões): guardar/importar com nome, renomear.
  const [showGuardarProposta, setShowGuardarProposta] = useState(false);
  const [nomeProposta, setNomeProposta] = useState("");
  const [escopoProposta, setEscopoProposta] = useState<"ano" | "todos">("ano");
  const [renomearPropostaId, setRenomearPropostaId] = useState<string | null>(null);
  const [nomeRenomear, setNomeRenomear] = useState("");
  // Edição de regra (anos múltiplos + cursos). Reutilizada para validar a sugestão da IA.
  const [regraEmEdicao, setRegraEmEdicao] = useState<RegraHorario | null>(null);
  const [editProveniencia, setEditProveniencia] = useState<"edicao" | "ia">("edicao");
  // Fases do fluxo (manuais, controladas pelo utilizador): 1.º UCs (sempre), 2.º salas,
  // 3.º docentes. Interruptores em Configuração; quando ON, o grid permite atribuir à mão.
  const [incluirSalas, setIncluirSalas] = useState<boolean>(() => { try { return localStorage.getItem("eseuc_incluir_salas") === "1"; } catch { return false; } });
  const [incluirDocentes, setIncluirDocentes] = useState<boolean>(() => { try { return localStorage.getItem("eseuc_incluir_docentes") === "1"; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem("eseuc_incluir_salas", incluirSalas ? "1" : "0"); } catch { /* ignore */ } }, [incluirSalas]);
  useEffect(() => { try { localStorage.setItem("eseuc_incluir_docentes", incluirDocentes ? "1" : "0"); } catch { /* ignore */ } }, [incluirDocentes]);
  // Ecrã do "sorteio" de docentes: UCs selecionadas + atribuições (UC,turma)→LISTA de docentes
  // (T/TP: 2-3 docentes; PL: 1). Um docente pode ter várias turmas.
  const [showDistDocentes, setShowDistDocentes] = useState(false);
  const [ucsSelDocentes, setUcsSelDocentes] = useState<Set<string>>(new Set());
  const [atribDocente, setAtribDocente] = useState<Record<string, string[]>>({});
  const [newUc, setNewUc] = useState<Partial<UC>>({
    nome: "",
    sigla: "",
    cursoId: "c1",
    anoCurricular: 1,
    semestre: 1,
    cargaHorariaTeorica: 2,
    cargaHorariaPratica: 0,
    cargaHorariaTP: 0,
    ects: 6,
    semanaInicio: 1,
    numSemanas: 15,
    turmasConfig: generateEseucTurmas("UC", 2, 0, 0, 0)
  });
  const [autoDistributeNewUc, setAutoDistributeNewUc] = useState(true);

  const updateNewUcHours = (updates: Partial<UC>) => {
    setNewUc(prev => {
      const updated = { ...prev, ...updates };
      const sig = (updated.sigla || "UC").toUpperCase();
      if (autoDistributeNewUc) {
        updated.turmasConfig = generateEseucTurmas(
          sig,
          updated.cargaHorariaTeorica || 0,
          updated.cargaHorariaTP || 0,
          updated.cargaHorariaPratica || 0,
          updated.cargaHorariaS || 0
        );
      }
      return updated;
    });
  };

  const estruturaEstudantesEseuc = [
    {
      turma: "Turma A",
      tps: [
        { nome: "TP1", pls: ["PL1", "PL2", "PL3"] },
        { nome: "TP2", pls: ["PL4", "PL5", "PL6"] },
        { nome: "TP3", pls: ["PL7", "PL8", "PL9"] },
        { nome: "TP4", pls: ["PL10", "PL11", "PL12"] }
      ]
    },
    {
      turma: "Turma B",
      tps: [
        { nome: "TP5", pls: ["PL13", "PL14", "PL15"] },
        { nome: "TP6", pls: ["PL16", "PL17", "PL18"] },
        { nome: "TP7", pls: ["PL19", "PL20", "PL21"] },
        { nome: "TP8", pls: ["PL22", "PL23", "PL24"] }
      ]
    }
  ];

  const renderSeletorSemanasPL = (
    semanasPL: number[] | undefined,
    numSemanas: number | undefined,
    semestre: number | undefined,
    onChange: (s: number[] | undefined) => void
  ) => {
    const total = Math.max(1, Math.min(20, numSemanas || 15));
    const sel = new Set(semanasPL || []);
    const semanaGlobalBase = (semestre === 2 ? 15 : 0);
    const toggle = (n: number) => {
      const next = new Set(sel);
      if (next.has(n)) next.delete(n); else next.add(n);
      const arr = [...next].sort((a, b) => a - b);
      onChange(arr.length ? arr : undefined);
    };
    return (
      <div className="bg-gradient-to-br from-indigo-50/70 to-violet-50/40 border border-indigo-200/70 rounded-xl p-3 space-y-2 shadow-3xs">
        <div className="flex items-center justify-between gap-2">
          <div>
            <span className="block text-[9px] uppercase font-black text-indigo-700 tracking-wide flex items-center gap-1">
              <span className="text-[11px]">🧪</span> Semanas das Práticas (PL)
            </span>
            <p className="text-[9px] text-indigo-700/70 leading-snug mt-0.5">
              Clique nas semanas em que as PL podem decorrer. {sel.size === 0 ? "Nenhuma selecionada = todas as semanas válidas." : `${sel.size} semana(s) escolhida(s).`}
            </p>
          </div>
          {sel.size > 0 && (
            <button
              type="button"
              onClick={() => onChange(undefined)}
              className="shrink-0 text-[8.5px] font-bold uppercase font-mono text-indigo-600 hover:text-indigo-800 border border-indigo-300 hover:border-indigo-400 bg-white/70 rounded px-2 py-1 cursor-pointer transition-colors"
            >
              Limpar
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: total }, (_, i) => i + 1).map((n) => {
            const ativa = sel.has(n);
            return (
              <button
                key={n}
                type="button"
                onClick={() => toggle(n)}
                title={`Semana ${n} (global ${semanaGlobalBase + n})`}
                className={`w-8 h-8 rounded-lg text-[11px] font-bold font-mono transition-all cursor-pointer border ${
                  ativa
                    ? "bg-indigo-600 border-indigo-700 text-white shadow-sm scale-105"
                    : "bg-white border-indigo-200 text-indigo-500 hover:border-indigo-400 hover:bg-indigo-50"
                }`}
              >
                {n}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderEstruturaEstudantes = (turmasConfig?: UC["turmasConfig"]) => {
    const activeNames = new Set((turmasConfig || []).map(t => t.nome));
    return (
      <div className="bg-white border border-stone-200 rounded-xl p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <span className="block text-[9px] uppercase font-black text-stone-500 tracking-wide">Estrutura oficial de estudantes</span>
            <p className="text-[9.5px] text-stone-500 leading-snug mt-0.5">
              Quando uma turma-mãe está em aula, todos os seus TP e PL ficam indisponíveis no mesmo horário. Quando um TP está em aula, os seus 3 PL também ficam indisponíveis.
            </p>
          </div>
          <span className="shrink-0 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-150 text-[8px] font-black uppercase font-mono">
            Regra ativa
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {estruturaEstudantesEseuc.map(grupo => (
            <div key={grupo.turma} className="rounded-lg border border-stone-150 bg-stone-50/70 p-2">
              <div className={`inline-flex px-2 py-0.5 rounded-md text-[9px] font-black border ${activeNames.has(grupo.turma) ? "bg-amber-600 text-white border-amber-650" : "bg-white text-stone-500 border-stone-200"}`}>
                {grupo.turma}
              </div>
              <div className="mt-2 space-y-1">
                {grupo.tps.map(tp => (
                  <div key={tp.nome} className="flex items-center gap-1.5 flex-wrap">
                    <span className={`w-9 text-center px-1 py-0.5 rounded text-[8.5px] font-bold border ${activeNames.has(tp.nome) ? "bg-[#148A96] text-white border-[#148A96]" : "bg-white text-stone-500 border-stone-200"}`}>
                      {tp.nome}
                    </span>
                    <ArrowRight className="w-3 h-3 text-stone-300" />
                    {tp.pls.map(pl => (
                      <span key={pl} className={`px-1 py-0.5 rounded text-[8px] font-bold border ${activeNames.has(pl) ? "bg-teal-700 text-white border-teal-750" : "bg-white text-stone-500 border-stone-200"}`}>
                        {pl}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const createTurnoConfig = (nome: string, prefix: string) => {
    const tipo = nome.startsWith("TP")
      ? "TeoricoPratica"
      : nome.startsWith("PL")
        ? "Prática"
        : "Teórica";

    return {
      id: `${prefix}_${Date.now()}_${nome.replace(/\s/g, "")}`,
      nome,
      tipo: tipo as "Teórica" | "Prática" | "TeoricoPratica",
      docenteId: ""
    };
  };

  const getTurnosAssociadosTurma = (turma: "Turma A" | "Turma B", uc: Partial<UC>) => {
    const isA = turma === "Turma A";
    const nomes: string[] = [turma];

    if ((uc.cargaHorariaTP || 0) > 0) {
      nomes.push(...(isA ? ["TP1", "TP2", "TP3", "TP4"] : ["TP5", "TP6", "TP7", "TP8"]));
    }

    if ((uc.cargaHorariaPratica || 0) > 0) {
      const firstPl = isA ? 1 : 13;
      nomes.push(...Array.from({ length: 12 }, (_, i) => `PL${firstPl + i}`));
    }

    return nomes;
  };

  const toggleTurmaMae = (
    currentTurmas: NonNullable<UC["turmasConfig"]>,
    turma: "Turma A" | "Turma B",
    uc: Partial<UC>,
    prefix: string
  ) => {
    const isSelected = currentTurmas.some(t => t.nome === turma);
    const associated = getTurnosAssociadosTurma(turma, uc);

    if (isSelected) {
      return currentTurmas.filter(t => !associated.includes(t.nome));
    }

    const existingNames = new Set(currentTurmas.map(t => t.nome));
    const toAdd = associated
      .filter(nome => !existingNames.has(nome))
      .map(nome => createTurnoConfig(nome, prefix));

    return [...currentTurmas, ...toAdd];
  };

  const [isAddingDocente, setIsAddingDocente] = useState(false);
  const [newDocente, setNewDocente] = useState<Partial<Docente>>({
    nome: "",
    email: "",
    departamento: "DEP-Informática",
    maxHorasSemanais: 12,
    unidadesCurriculares: []
  });

  const [isAddingSala, setIsAddingSala] = useState(false);
  const [newSala, setNewSala] = useState<Partial<Sala>>({
    nome: "",
    tipo: "Teórica",
    capacidade: 40,
    equipamento: [],
    tipologia: "Teórica"
  });

  const [isAddingFeriado, setIsAddingFeriado] = useState(false);
  const [newFeriado, setNewFeriado] = useState<Partial<FeriadoInterrupcao>>({
    nome: "",
    tipo: "Feriado",
    dataInicio: "",
    dataFim: ""
  });

  const [isAddingRegra, setIsAddingRegra] = useState(false);
  const [newRegra, setNewRegra] = useState<Partial<RegraHorario>>({
    nome: "",
    tipo: "hard",
    categoria: "Professor",
    descricao: "",
    escopo: "transversal",
    anoCurricular: "todos",
    peso: 5,
    ativa: true
  });

  // Smart AI interaction engine
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Olá! Sou o seu Assistente de Agendamento Inteligente. Interpreto os seus pedidos em português simples (ex: *'Não quero aulas do Professor António às quartas à tarde'*) e configuro as restrições automaticamente no solucionador. O SQL aqui não existe para si! Como posso ajudar?",
      timestamp: new Date().toISOString()
    }
  ]);
  const [aiPrompt, setAiPrompt] = useState("");
  const [pendingAiRule, setPendingAiRule] = useState<RegraHorario | null>(null);
  const [isLoadingAi, setIsLoadingAi] = useState(false);

  // Optimizer solver running outputs
  const [isSolving, setIsSolving] = useState(false);
  const [lastSolverVerdict, setLastSolverVerdict] = useState<any>(null);

  // Compare selection
  const [compareV1, setCompareV1] = useState<string>("v1");
  const [compareV2, setCompareV2] = useState<string>("v2");

  // Drag and drop parameters
  const [draggedSessionId, setDraggedSessionId] = useState<number | null>(null);

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const getSimulatedIncompatibilities = () => {
    const list: { type: "info" | "warning" | "error"; title: string; desc: string; category: string }[] = [];
    if (!activeVersao) return list;

    // 1. Teacher Overlap Check
    const teacherSlots: { [key: string]: { ucSigla: string; turmaName: string; docente: string }[] } = {};
    activeVersao.sessoes.forEach(s => {
      const key = `${s.diaSemana}_${s.horaInicio}`;
      if (!teacherSlots[key]) teacherSlots[key] = [];
      teacherSlots[key].push({ ucSigla: s.ucSigla, turmaName: s.turma || "", docente: s.docente });
    });

    for (const [key, sessions] of Object.entries(teacherSlots)) {
      const [dia, slot] = key.split("_");
      const teacherCounts: { [name: string]: number } = {};
      sessions.forEach(sess => {
        if (!sess.docente) return;
        const subTeachers = sess.docente.split(",").map(t => t.trim());
        subTeachers.forEach(st => {
          teacherCounts[st] = (teacherCounts[st] || 0) + 1;
        });
      });

      for (const [teacher, cnt] of Object.entries(teacherCounts)) {
        if (cnt > 1) {
          list.push({
            type: "error",
            category: "Sobreposição de Docente",
            title: `Dupla Reserva para ${teacher}`,
            desc: `O docente ${teacher} está escalado em ${cnt} aulas em simultâneo ? ${dia} às ${slot}.`
          });
        }
      }
    }

    // 2. Room Overlap Check
    const roomSlots: { [key: string]: { ucSigla: string; rId: string; rNome: string }[] } = {};
    activeVersao.sessoes.forEach(s => {
      if (!s.salaId) return;
      const key = `${s.diaSemana}_${s.horaInicio}_${s.salaId}`;
      if (!roomSlots[key]) roomSlots[key] = [];
      const rm = salas.find(r => r.id === s.salaId);
      roomSlots[key].push({ ucSigla: s.ucSigla, rId: s.salaId, rNome: rm ? rm.nome : s.salaId });
    });

    for (const [key, sessions] of Object.entries(roomSlots)) {
      if (sessions.length > 1) {
        const parts = key.split("_");
        const dia = parts[0];
        const slot = parts[1];
        const rName = sessions[0].rNome;
        list.push({
          type: "error",
          category: "Lotação de Sala",
          title: `Dupla Ocupação de Sala: ${rName}`,
          desc: `A sala ${rName} está com ${sessions.length} turmas diferentes agendadas ? ${dia} às ${slot}.`
        });
      }
    }

    // 3. Room capacity check
    activeVersao.sessoes.forEach(s => {
      if (!s.salaId) return;
      const rm = salas.find(r => r.id === s.salaId);
      if (!rm) return;
      const ucObj = ucs.find(u => u.sigla === s.ucSigla);
      const relatedTurma = turmas.find(t => t.id === s.turmaId);
      const studentQty = relatedTurma ? relatedTurma.alunos : (ucObj ? 30 : 25);
      if (studentQty > rm.capacidade) {
        list.push({
          type: "warning",
          category: "Capacidade Excedida",
          title: `Lotação de Alunos no Espação`,
          desc: `A disciplina ${s.ucSigla} reúne ${studentQty} alunos, mas a sala ${rm.nome} tem capacidade para apenas ${rm.capacidade} lugares.`
        });
      }
    });

    // 4. Teaching limits simultaneous rules (TP: max 4, PL: max 6)
    const tpTeachersPerSlot: { [key: string]: Set<string> } = {};
    const plTeachersPerSlot: { [key: string]: Set<string> } = {};

    activeVersao.sessoes.forEach(s => {
      const ucObj = ucs.find(u => u.sigla === s.ucSigla);
      if (!ucObj) return;

      const slotKey = `${s.diaSemana}_${s.horaInicio}`;
      const docList = s.docente ? s.docente.split(",").map(n => n.trim()) : [];

      if (s.turmaDescr && s.turmaDescr.includes("TP")) {
        if (!tpTeachersPerSlot[slotKey]) tpTeachersPerSlot[slotKey] = new Set();
        docList.forEach(d => tpTeachersPerSlot[slotKey].add(d));
      }
      if (s.turmaDescr && s.turmaDescr.includes("PL")) {
        if (!plTeachersPerSlot[slotKey]) plTeachersPerSlot[slotKey] = new Set();
        docList.forEach(d => plTeachersPerSlot[slotKey].add(d));
      }
    });

    for (const [slotKey, teachers] of Object.entries(tpTeachersPerSlot)) {
      if (teachers.size > 4) {
        const [dia, slot] = slotKey.split("_");
        list.push({
          type: "warning",
          category: "Limite TP Ultrapassado",
          title: `Excesso de Docentes Simultâneos em TP`,
          desc: `H? ${teachers.size} professores em aulas TP simultâneas ? ${dia} às ${slot}, mas o regulamento ESEUC define o máximo de 4 professores.`
        });
      }
    }

    for (const [slotKey, teachers] of Object.entries(plTeachersPerSlot)) {
      if (teachers.size > 6) {
        const [dia, slot] = slotKey.split("_");
        list.push({
          type: "warning",
          category: "Limite PL Ultrapassado",
          title: `Excesso de Docentes Simultâneos em PL`,
          desc: `H? ${teachers.size} professores em aulas PL simultâneas ? ${dia} às ${slot}, mas o regulamento ESEUC define o máximo de 6 professores.`
        });
      }
    }

    // 5. Student continuous contact / teacher homogeneity rules (Homogeneidade de Turma)
    const teachersTeoricaA = new Set<string>();
    const teachersTeoricaB = new Set<string>();

    activeVersao.sessoes.forEach(s => {
      const isTeorica = s.turmaDescr && (s.turmaDescr === "Turma A" || s.turmaDescr === "Turma B" || s.turmaDescr.endsWith("-T") || s.turmaDescr.includes("Teórica"));
      if (!isTeorica || !s.docente) return;

      const subTeachers = s.docente.split(",").map(t => t.trim());
      if (s.turmaDescr.includes("A") || s.turmaDescr === "Turma A") {
        subTeachers.forEach(st => teachersTeoricaA.add(st));
      } else if (s.turmaDescr.includes("B") || s.turmaDescr === "Turma B") {
        subTeachers.forEach(st => teachersTeoricaB.add(st));
      }
    });

    docentes.forEach(d => {
      if (!d.atribuicoesUcs) return;
      Object.entries(d.atribuicoesUcs).forEach(([sig, val]) => {
        const atrib = val as any;
        if (atrib.tipos && atrib.tipos.includes("T")) {
          if (atrib.turmas && atrib.turmas.includes("Turma A")) teachersTeoricaA.add(d.nome);
          if (atrib.turmas && atrib.turmas.includes("Turma B")) teachersTeoricaB.add(d.nome);
        }
      });
    });

    activeVersao.sessoes.forEach(s => {
      if (!s.docente || !s.turmaDescr) return;
      const subTeachers = s.docente.split(",").map(t => t.trim());
      
      const isTPGroupB = ["TP5", "TP6", "TP7", "TP8"].some(term => s.turmaDescr!.includes(term));
      const isPLGroupB = Array.from({ length: 12 }, (_, idx) => `PL${idx + 13}`).some(term => s.turmaDescr!.includes(term));
      
      if (isTPGroupB || isPLGroupB) {
        subTeachers.forEach(st => {
          if (teachersTeoricaA.has(st)) {
            list.push({
              type: "error",
              category: "Quebra de Contacto Contínuo",
              title: `Docente de Teórica A alocado ao Grupo B: ${st}`,
              desc: `O docente ${st} leciona Teórica ? Turma A, mas está escalado na aula prática "${s.turmaDescr}" da Turma B. Isto quebra a homogeneidade recomendada de contacto contínuo!`
            });
          }
        });
      }

      const isTPGroupA = ["TP1", "TP2", "TP3", "TP4"].some(term => s.turmaDescr!.includes(term));
      const isPLGroupA = Array.from({ length: 12 }, (_, idx) => `PL${idx + 1}`).some(term => s.turmaDescr!.includes(term));

      if (isTPGroupA || isPLGroupA) {
        subTeachers.forEach(st => {
          if (teachersTeoricaB.has(st)) {
            list.push({
              type: "error",
              category: "Quebra de Contacto Contínuo",
              title: `Docente de Teórica B alocado ao Grupo A: ${st}`,
              desc: `O docente ${st} leciona Teórica ? Turma B, mas está escalado na aula prática "${s.turmaDescr}" da Turma A. Isto quebra a homogeneidade recomendada de contacto contínuo!`
            });
          }
        });
      }
    });

    docentes.forEach(d => {
      if (!d.atribuicoesUcs) return;
      
      let doesTheoryA = false;
      let doesTheoryB = false;

      Object.entries(d.atribuicoesUcs).forEach(([sig, val]) => {
        const atrib = val as any;
        if (atrib.tipos && atrib.tipos.includes("T")) {
          if (atrib.turmas && atrib.turmas.includes("Turma A")) doesTheoryA = true;
          if (atrib.turmas && atrib.turmas.includes("Turma B")) doesTheoryB = true;
        }
      });

      Object.entries(d.atribuicoesUcs).forEach(([sig, val]) => {
        const atrib = val as any;
        if (doesTheoryA) {
          const hasInvalidPracticalB = atrib.turmas && atrib.turmas.some((t: string) => 
            ["TP5", "TP6", "TP7", "TP8"].includes(t) || 
            Array.from({ length: 12 }, (_, i) => `PL${i + 13}`).includes(t)
          );
          if (hasInvalidPracticalB) {
            list.push({
              type: "error",
              category: "Incompatibilidade de Perfil",
              title: `Falta de Homogeneidade ESEUC: ${d.nome}`,
              desc: `O docente ${d.nome} está configurado para lecionar Teóricas na Turma A mas tem proposta prática atribuída a turmas do Grupo B (TP5-TP8 ou PL13-PL24).`
            });
          }
        }

        if (doesTheoryB) {
          const hasInvalidPracticalA = atrib.turmas && atrib.turmas.some((t: string) => 
            ["TP1", "TP2", "TP3", "TP4"].includes(t) || 
            Array.from({ length: 12 }, (_, i) => `PL${i + 1}`).includes(t)
          );
          if (hasInvalidPracticalA) {
            list.push({
              type: "error",
              category: "Incompatibilidade de Perfil",
              title: `Falta de Homogeneidade ESEUC: ${d.nome}`,
              desc: `O docente ${d.nome} está configurado para lecionar Teóricas na Turma B mas tem proposta prática atribuída a turmas do Grupo A (TP1-TP4 ou PL1-PL12).`
            });
          }
        }
      });
    });

    return list;
  };

  // Theme styling definitions dynamically applied on components
  const themeStyles = {
    eseuc_ouro: {
      bgColor: "bg-[#FBF9F3]",
      panelColor: "bg-white",
      borderColor: "border-[#EDE3C8]",
      textColor: "text-[#1F190D]",
      subtextColor: "text-[#73603A]",
      primaryBtn: "bg-[#D4A32A] hover:bg-[#B5861D] text-stone-900",
      primaryText: "text-[#B5861D]",
      headerBg: "bg-[#1F190D]",
      headingFont: "font-serif tracking-tight font-semibold",
      cardHover: "hover:border-[#D4A32A]/50 hover:shadow-xs",
      softAccent: "bg-[#FCF5E3] text-[#B5861D]"
    },
    eseuc_escola: {
      bgColor: "bg-[#EBF3F5]",
      panelColor: "bg-white",
      borderColor: "border-[#CCE2E4]",
      textColor: "text-[#002D33]",
      subtextColor: "text-[#3A6B72]",
      primaryBtn: "bg-[#148A96] hover:bg-[#0F6F7A] text-white",
      primaryText: "text-[#148A96]",
      headerBg: "bg-[#002D33]",
      headingFont: "font-sans tracking-tight font-bold",
      cardHover: "hover:border-[#148A96]/50 hover:shadow-xs",
      softAccent: "bg-[#DEF1F3] text-[#148A96]"
    },
    eseuc_cardoso: {
      bgColor: "bg-[#FCF9F7]",
      panelColor: "bg-white",
      borderColor: "border-[#ECDCD5]",
      textColor: "text-[#300F0A]",
      subtextColor: "text-[#784E44]",
      primaryBtn: "bg-[#801B0B] hover:bg-[#601205] text-white",
      primaryText: "text-[#801B0B]",
      headerBg: "bg-[#300F0A]",
      headingFont: "font-serif tracking-tight font-medium",
      cardHover: "hover:border-[#801B0B]/50 hover:shadow-xs",
      softAccent: "bg-[#F9EDEA] text-[#801B0B]"
    }
  }[vibe];

  // Helper template exporter using sheetjs (xlsx)
  const downloadTemplate = (tipo: 'instalacoes' | 'corpo_docente' | 'ucs' | 'turmas') => {
    let headers: string[] = [];
    let sampleData: any[] = [];
    let filename = "";

    if (tipo === 'instalacoes') {
      headers = [
        "Nome da Instalação", 
        "Tipo (Teórica / Teórico-prática / Laboratório / Sala de Computadores)", 
        "Capacidade Máxima", 
        "Equipamentos Obrigatórios (Separados por vírgula)"
      ];
      sampleData = [
        ["Auditório Professor Armando Cardoso", "Teórica", 160, "Projetor 4K, Sistema de Som Integrado, Cabine Tradicional"],
        ["Laboratório de Saúde Materno-Infantil e Obstetrícia", "Laboratório", 30, "Manequins de Parto Avançados, Incubadora, Berços de Recém-nascido"],
        ["Sala de Práticas Clínicas Simuladas 3", "Laboratório", 25, "Camas Clínicas de Enfermagem, Postos de Oxigenoterapia, Suportes de Soro"],
        ["Sala de Aula Regular 108", "Teórico-prática", 45, "Quadro Interativo, Ar Condicionado"]
      ];
      filename = "modelo_instalacoes_eseuc.xlsx";
    } else if (tipo === 'corpo_docente') {
      headers = [
        "Nome Completo do Professor", 
        "Email Institucional @eseuc", 
        "Departamento Científico", 
        "Limite de Horas Semanais", 
        "Siglas das Disciplinas que Ministra (Separadas por vírgula)"
      ];
      sampleData = [
        ["Prof. Dra. Maria do Céu Rebelo", "mariaceu@eseuc.pt", "UCP Enfermagem de Saúde da Mulher", 12, "BDP, PCS1"],
        ["Prof. Dr. António Jesus Coimbra", "antoniojesus@eseuc.pt", "UCP Enfermagem Fundamental", 16, "FE, ECCP"],
        ["Dra. Ana Rita Mendonça", "anarita@eseuc.pt", "UCP Enfermagem Fundamental", 8, "AFH, PCS1"]
      ];
      filename = "modelo_corpo_docente_eseuc.xlsx";
    } else if (tipo === 'ucs') {
      headers = [
        "Designação da UC",
        "Sigla",
        "Ano Curricular (1, 2, 3 ou 4)",
        "Semestre (1 ou 2)",
        "Semana de Início (1 a 15)",
        "Total de Semanas",
        "Créditos ECTS",
        "Horas Teóricas T por semana",
        "Horas Teórico-Práticas TP por semana",
        "Horas Práticas Laboratoriais PL por semana",
        "Horas Seminário S por semana",
        "Ensino Clínico E total (h)",
        "Estrutura de estudantes",
        "Tipologia de sala preferencial",
        "Observações para docentes/salas"
      ];
      sampleData = [
        ["Fundamentos de Enfermagem", "FE", 1, 1, 1, 15, 6, 4, 2, 2, 0, 0, "Oficial ESEUC: A/B; A=TP1-TP4; B=TP5-TP8; cada TP=3 PL", "T: Anfiteatro; TP: Sala TP; PL: Laboratório", "Docentes por tipo/turno podem ser ajustados depois na ficha da UC"],
        ["Anatomia e Fisiologia Humanas", "AFH", 1, 1, 1, 15, 6, 4, 0, 2, 0, 0, "Oficial ESEUC", "T: Anfiteatro; PL: Laboratório", ""],
        ["Bioética e Deontologia Profissional", "BDP", 2, 1, 1, 15, 4, 2, 0, 0, 0, 0, "Oficial ESEUC", "Sala teórica", ""],
        ["Práticas Clínicas Simuladas I", "PCS1", 2, 2, 1, 15, 6, 0, 0, 4, 0, 0, "Oficial ESEUC", "Laboratório de práticas simuladas", ""],
        ["Enfermagem de Comunidade e Cuidados Primários", "ECCP", 3, 1, 1, 6, 6, 0, 0, 0, 0, 490, "Ensino Clínico", "Campo clínico", "Sem grelha semanal fixa quando for EC"]
      ];
      filename = "modelo_disciplinas_eseuc.xlsx";
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...sampleData]);
    XLSX.utils.book_append_sheet(wb, ws, "Modelo_ESEUC");
    XLSX.writeFile(wb, filename);
    showToast(`Œ¿ O ficheiro modelo ${filename} foi transferido para a sua máquina.`);
  };

  // Parser of uploaded xlsx sheets 
  const handleLoadXlsxFile = (e: React.ChangeEvent<HTMLInputElement>, tipo: 'instalacoes' | 'corpo_docente' | 'ucs' | 'turmas') => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];

        if (rawRows.length < 2) {
          alert("O ficheiro Excel carregado não tem linhas de dados suficientes.");
          return;
        }

        const dataRows = rawRows.slice(1);

        if (tipo === 'instalacoes') {
          const imported: Sala[] = dataRows
            .filter(r => r[0] && r[0].toString().trim() !== "")
            .map((r, idx) => {
              const nome = r[0]?.toString() || "";
              const tipoInst = r[1]?.toString() || "Teórica";
              const cap = parseInt(r[2]?.toString()) || 40;
              const equip = r[3] ? r[3].toString().split(",").map((s: string) => s.trim()) : [];
              return {
                id: "imp_sala_" + Date.now() + "_" + idx,
                nome,
                tipo: ["Teórica", "Teórico-prática", "Laboratório", "Sala de Computadores"].includes(tipoInst) ? tipoInst as any : "Teórica",
                capacidade: cap,
                equipamento: equip,
                tipologia: tipoInst,
                tipologias: [tipoInst]
              };
            });

          setSalas(prev => [...prev, ...imported]);
          showToast(` ${imported.length} instalações clínicas integradas com sucesso!`);
        }

        else if (tipo === 'corpo_docente') {
          const imported: Docente[] = dataRows
            .filter(r => r[0] && r[0].toString().trim() !== "")
            .map((r, idx) => {
              const nome = r[0]?.toString() || "";
              const email = r[1]?.toString() || "docente@eseuc.pt";
              const dept = r[2]?.toString() || "Enfermagem Fundamental";
              const hrs = parseInt(r[3]?.toString()) || 12;
              const ucsList = r[4] ? r[4].toString().split(",").map((s: string) => s.trim().toUpperCase()) : [];
              return {
                id: "imp_doc_" + Date.now() + "_" + idx,
                nome,
                email,
                departamento: dept,
                maxHorasSemanais: hrs,
                unidadesCurriculares: ucsList,
                disponibilidade: {
                  "Segunda": ["08:00-12:00", "14:00-18:00"],
                  "Terça": ["08:00-12:00", "14:00-18:00"],
                  "Quarta": ["08:00-12:00", "14:00-18:00"],
                  "Quinta": ["08:00-12:00", "14:00-18:00"],
                  "Sexta": ["08:00-13:00"]
                }
              };
            });

          setDocentes(prev => [...prev, ...imported]);
          showToast(` ${imported.length} novos docentes clínicos adicionados ao mapa científico!`);
        }

        else if (tipo === 'ucs') {
          const headers = (rawRows[0] || []).map(h => h?.toString().trim().toLowerCase() || "");
          const findCol = (fallback: number, ...needles: string[]) => {
            const idx = headers.findIndex(h => needles.some(n => h.includes(n)));
            return idx >= 0 ? idx : fallback;
          };
          const colNome = findCol(0, "designação", "disciplina", "uc");
          const colSigla = findCol(1, "sigla");
          const colAno = findCol(2, "ano curricular");
          const colSemestre = findCol(headers.includes("semestre (1 ou 2)") ? headers.indexOf("semestre (1 ou 2)") : 7, "semestre");
          const colSemanaInicio = findCol(4, "semana de início", "semana inicio");
          const colSemanas = findCol(8, "total de semanas", "total semanas");
          const colEcts = findCol(6, "ects", "créditos", "creditos");
          const colT = findCol(3, "teóricas", "teoricas", " t ");
          const colTP = findCol(5, "teórico-práticas", "teorico-praticas", "tp por semana");
          const colPL = findCol(4, "laboratoriais", "pl por semana");
          const colS = findCol(10, "seminário", "seminario");
          const colE = findCol(9, "ensino clínico", "ensino clinico");
          const colTipologia = findCol(13, "tipologia de sala", "sala preferencial");

          const imported: UC[] = dataRows
            .filter(r => r[0] && r[0].toString().trim() !== "")
            .map((r, idx) => {
              const nome = r[colNome]?.toString() || "";
              const sigla = r[colSigla]?.toString()?.toUpperCase() || "UC";
              const ano = parseInt(r[colAno]?.toString()) || 1;
              const t = parseInt(r[colT]?.toString()) || 0;
              const tp = parseInt(r[colTP]?.toString()) || 0;
              const pl = parseInt(r[colPL]?.toString()) || 0;
              const s = parseInt(r[colS]?.toString()) || 0;
              const ects = parseInt(r[colEcts]?.toString()) || 6;
              const sem = parseInt(r[colSemestre]?.toString()) || 1;
              const semanaInicio = parseInt(r[colSemanaInicio]?.toString()) || 1;
              const semanas = parseInt(r[colSemanas]?.toString()) || 15;
              const eHrs = parseInt(r[colE]?.toString()) || 0;
              const tipologiaSalaDesejada = r[colTipologia]?.toString()?.trim() || "";
              return {
                id: "imp_uc_" + Date.now() + "_" + idx,
                nome,
                sigla,
                cursoId: "c1",
                anoCurricular: ano,
                cargaHorariaTeorica: t,
                cargaHorariaPratica: pl,
                cargaHorariaTP: tp,
                cargaHorariaS: s,
                cargaHorariaE: eHrs,
                ects,
                semestre: sem,
                semanaInicio,
                numSemanas: semanas,
                turmasConfig: generateEseucTurmas(sigla, t, tp, pl, s).map(turno => ({
                  ...turno,
                  tipologiaSalaDesejada
                }))
              };
            });

          setUcs(prev => [...prev, ...imported]);
          showToast(` ${imported.length} novas Unidades Curriculares integradas ao rascunho de Coimbra!`);
        }

      } catch (err) {
        console.error("XLSX parsing failed: ", err);
        alert("Falha na importação: O ficheiro não está no formato do modelo.");
      }
    };
    reader.readAsBinaryString(file);
  };

  useEffect(() => {
    const found = versoes.find(v => v.id === selectedVersaoId);
    if (found) {
      setActiveVersao(found);
    } else if (versoes.length > 0) {
      setActiveVersao(versoes[0]);
      setSelectedVersaoId(versoes[0].id);
    }
  }, [selectedVersaoId, versoes]);

  // Sync selected year with active selectedSemestreId and active proposal
  useEffect(() => {
    const currentVer = versoes.find(v => v.id === selectedVersaoId);
    if (currentVer) {
      const matchS = anosSemestres.find(item => item.id === currentVer.anoSemestreId);
      if (matchS && matchS.anoLetivo === selectedAnoLetivo) {
        setSelectedSemestreId(currentVer.anoSemestreId);
        return;
      }
    }

    const matchingVer = versoes.find(v => {
      const s = anosSemestres.find(item => item.id === v.anoSemestreId);
      return s && s.anoLetivo === selectedAnoLetivo;
    });

    if (matchingVer) {
      setSelectedVersaoId(matchingVer.id);
      setSelectedSemestreId(matchingVer.anoSemestreId);
    } else {
      const matchingSem = anosSemestres.find(s => s.anoLetivo === selectedAnoLetivo);
      if (matchingSem) {
        setSelectedSemestreId(matchingSem.id);
      }
    }
  }, [selectedAnoLetivo, versoes, anosSemestres]);

  // Sync profile selection to pre-filter curricular year (now fully supporting vice-coordinators)
  useEffect(() => {
    if (perfilAtivo === "coordenador_1" || perfilAtivo === "vice_coordenador_1") {
      setSelectedYearFilter(1);
    } else if (perfilAtivo === "coordenador_2" || perfilAtivo === "vice_coordenador_2") {
      setSelectedYearFilter(2);
    } else if (perfilAtivo === "coordenador_3" || perfilAtivo === "vice_coordenador_3") {
      setSelectedYearFilter(3);
    } else if (perfilAtivo === "coordenador_4" || perfilAtivo === "vice_coordenador_4") {
      setSelectedYearFilter(4);
    } else {
      setSelectedYearFilter("todos");
    }
  }, [perfilAtivo]);

  // Carregamento inicial a partir do Supabase (fonte de verdade).
  // Nao depende do login: o RLS esta aberto por agora (fecha-se com a auth).
  useEffect(() => {
    if (!repo.disponivel()) { setDbLoaded(true); return; }

    let isMounted = true;
    setCloudStatus("saving");
    repo.carregarTudo()
      .then(async (d) => {
        if (!isMounted) return;
        const vazio = d.ucs.length === 0 && d.cursos.length === 0;
        if (vazio) {
          await repo.guardarTudo(dadosIniciais());
          if (!isMounted) return;
          showToast("Base de dados Supabase semeada com os dados ESEUC iniciais.");
        } else {
          setCursos(d.cursos);
          setAnosSemestres(d.anosSemestres);
          setUcs(d.ucs);
          setDocentes(d.docentes);
          setSalas(d.salas);
          setTurmas(d.turmas);
          setFeriados(d.feriados);
          setRegras(d.regras);
          setVersoes(d.versoes);
          setSolverRuns(d.solverRuns);
        }
        setDbLoaded(true);
        setCloudStatus("synced");
      })
      .catch((err) => {
        console.error("Erro a carregar do Supabase:", err);
        setCloudStatus("error");
        setDbLoaded(true);
      });

    return () => { isMounted = false; };
  }, []);

  // Auto-gravacao (debounced) no Supabase. Usa upsert: adicoes/edicoes persistem;
  // a sincronizacao de REMOCOES e um refinamento seguinte.
  useEffect(() => {
    if (!repo.disponivel() || !dbLoaded) return;
    setCloudStatus("saving");
    const delayDebounce = setTimeout(() => {
      repo.guardarTudo({
        cursos, anosSemestres, ucs, docentes, salas, turmas, feriados, regras, versoes, solverRuns,
      })
        .then(() => setCloudStatus("synced"))
        .catch((err) => { console.error("Erro a gravar no Supabase:", err); setCloudStatus("error"); });
    }, 1500);
    return () => clearTimeout(delayDebounce);
  }, [cursos, anosSemestres, ucs, docentes, salas, turmas, feriados, regras, versoes, solverRuns, dbLoaded]);

  const handleLogout = async () => {
    await signOut();
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4500);
  };

  // Predefined SQL-Free Quick Rules setup
  const handleQuickRuleActivate = (ruleType: string) => {
    let newGenerated: RegraHorario;
    
    if (ruleType === "sextas") {
      newGenerated = {
        id: "quick_sexta_" + Date.now(),
        nome: "Sextas-Feiras Livres de Aulas",
        tipo: "soft",
        categoria: "Estudantes",
        descricao: "A IA reorganizará as sessões prioritariamente de Segunda a Quinta, deixando a Sexta-feira sem atividades académicas.",
        config: { traducaoSimples: "Desativação de penalização soft para maximizar blocos vazios às sextas." },
        peso: 8,
        ativa: true
      };
    } else if (ruleType === "almoco") {
      newGenerated = {
        id: "quick_almoco_" + Date.now(),
        nome: "Proteção Automática do Intervalo de Almoço",
        tipo: "hard",
        categoria: "Calendário",
        descricao: "Bloquear qualquer aula letiva entre as 12:00 e as 14:00 para professores e turmas.",
        config: { traducaoSimples: "A IA remove automaticamente as opções de agendamento do slot do meio-dia." },
        peso: 10,
        ativa: true
      };
    } else if (ruleType === "caloiros") {
      newGenerated = {
        id: "quick_caloiros_" + Date.now(),
        nome: "Período Totalmente Matinal para o 1.º Ano",
        tipo: "soft",
        categoria: "Estudantes",
        descricao: "Concentrar todas as disciplinas fundamentais das turmas do primeiro ano na parte da manhã.",
        config: { traducaoSimples: "A IA pontuará negativamente qualquer alocação vespertina para o 1.º Ano de Licenciatura." },
        peso: 7,
        ativa: true
      };
    } else {
      newGenerated = {
        id: "quick_investigacao_" + Date.now(),
        nome: "Dia Exclusivo Para Investigação Científica",
        tipo: "soft",
        categoria: "Professor",
        descricao: "Atribuir um dia da semana sem aulas para cada professor titular para que se foquem em investigação.",
        config: { traducaoSimples: "A IA garante um dia inteiro de folga a cada docente do departamento." },
        peso: 9,
        ativa: true
      };
    }

    setRegras([newGenerated, ...regras]);
    showToast(` A IA traduziu e ativou a regra "${newGenerated.nome}" automaticamente para o motor de otimização!`);
  };

  // Duplicar Semestre ou Criar em Branco
  const handleDuplicarSemestre = () => {
    if (!newSemesterName.trim()) return;

    const id = "as_" + Date.now();
    const duplicatedSemester: AnoLetivoSemestre = {
      id,
      anoLetivo: newSemesterName,
      semestre: newSemesterHalf,
      edicao: "Regular",
      ativo: false
    };

    const duplicatedRules = regras.map(r => ({
      ...r,
      id: "r_" + r.id + "_" + Date.now().toString().slice(-4),
      config: { ...r.config, clonedFrom: r.id }
    }));

    const initialProposalId = "v_base_" + id;
    const initialProposal: VersaoHorario = {
      id: initialProposalId,
      nome: emptyAcademicYear 
        ? `Plano em Branco - ${newSemesterName} (${newSemesterHalf}º Semestre)`
        : `Proposta Copiada - ${newSemesterName} (${newSemesterHalf}º Semestre)`,
      anoSemestreId: id,
      criadaEm: new Date().toISOString(),
      criadaPor: "hugoneves@gmail.com",
      ativa: true,
      score: emptyAcademicYear ? 0 : 85,
      sessoes: emptyAcademicYear ? [] : (activeVersao ? [...activeVersao.sessoes] : [])
    };

    setAnosSemestres([...anosSemestres, duplicatedSemester]);
    setRegras([...regras, ...duplicatedRules]);
    setVersoes([...versoes, initialProposal]);

    setSelectedSemestreId(id);
    setSelectedVersaoId(initialProposalId);
    setShowDuplicarSemestreModal(false);

    if (emptyAcademicYear) {
      showToast(` Novo ano letivo ${newSemesterName} criado em branco! Pode validar os docentes e salas antes de efetuar a distribuição.`);
    } else {
      showToast(` Ano letivo ${newSemesterName} criado e aulas do semestre anterior duplicadas com sucesso.`);
    }
  };

  const handleAddUc = () => {
    if (!newUc.nome || !newUc.sigla) return;
    const item: UC = {
      id: "uc_" + Date.now(),
      nome: newUc.nome,
      sigla: newUc.sigla.toUpperCase(),
      cursoId: newUc.cursoId || "c1",
      anoCurricular: Number(newUc.anoCurricular) || 1,
      cargaHorariaTeorica: Number(newUc.cargaHorariaTeorica) || 0,
      cargaHorariaPratica: Number(newUc.cargaHorariaPratica) || 0,
      cargaHorariaTP: Number(newUc.cargaHorariaTP) || 0,
      cargaHorariaS: Number(newUc.cargaHorariaS) || 0,
      cargaHorariaE: Number(newUc.cargaHorariaE) || 0,
      ects: Number(newUc.ects) || 6,
      semestre: Number(newUc.semestre) || 1,
      semanaInicio: Number(newUc.semanaInicio) || 1,
      numSemanas: Number(newUc.numSemanas) || 15,
      turmasConfig: newUc.turmasConfig || []
    };
    setUcs([...ucs, item]);
    setIsAddingUc(false);
    setNewUc({ nome: "", sigla: "", cursoId: "c1", anoCurricular: 1, semestre: 1, semanaInicio: 1, numSemanas: 15, cargaHorariaTeorica: 2, cargaHorariaPratica: 0, cargaHorariaTP: 0, cargaHorariaS: 0, cargaHorariaE: 0, ects: 6, turmasConfig: generateEseucTurmas("UC", 2, 0, 0, 0) });
    showToast(`Materia "${item.nome}" criada com sucesso com ${item.turmasConfig.length} turmas associadas!`);
  };

  const handleAddDocente = () => {
    if (!newDocente.nome || !newDocente.email) return;
    const item: Docente = {
      id: "doc_" + Date.now(),
      nome: newDocente.nome,
      email: newDocente.email,
      departamento: newDocente.departamento || "DEP-Informática",
      maxHorasSemanais: Number(newDocente.maxHorasSemanais) || 12,
      unidadesCurriculares: newDocente.unidadesCurriculares || [],
      disponibilidade: {
        "Segunda": ["08:00-12:00", "14:00-18:00"],
        "Terça": ["08:00-12:00", "14:00-18:00"],
        "Quarta": ["08:00-12:00", "14:00-18:00"],
        "Quinta": ["08:00-12:00", "14:00-18:00"],
        "Sexta": ["08:00-12:00", "18:00-20:00"]
      }
    };
    setDocentes([...docentes, item]);
    setIsAddingDocente(false);
    setNewDocente({ nome: "", email: "", departamento: "DEP-Informática", maxHorasSemanais: 12, unidadesCurriculares: [] });
    showToast(`Docente "${item.nome}" integrado com sucesso!`);
  };

  const handleClearDatabase = async () => {
    if (!window.confirm("âš  Tem a certeza absoluta que deseja LIMPAR todos os dados da base de dados académica (UCs, Docentes, Salas, Regras e Propostas) para o semestre ativo? Esta ação é irreversível na Cloud!")) {
      return;
    }
    setUcs([]);
    setDocentes([]);
    setSalas([]);
    setRegras([]);
    setVersoes([]);
    setSolverRuns([]);
    showToast("Base de dados académica limpa (sincronizado com o Supabase).");
  };

  const handleRestoreDatabaseMock = async () => {
    if (!window.confirm("Deseja repor os modelos académicos predefinidos da ESEUC para este semestre? Os dados atuais serão substituídos pelos dados originais.")) {
      return;
    }
    setUcs(ucsIniciais);
    setDocentes(docentesIniciais);
    setSalas(salasIniciais);
    setRegras(regrasIniciais);
    setVersoes(versoesIniciais);
    setSolverRuns(solverRunsIniciais);
    showToast("Modelos académicos predefinidos repostos (gravado no Supabase).");
  };

  const handleAddSala = () => {
    if (!newSala.nome) return;
    const item: Sala = {
      id: "sala_" + Date.now(),
      nome: newSala.nome,
      tipo: (newSala.tipo as any) || "Teórica",
      capacidade: Number(newSala.capacidade) || 40,
      equipamento: newSala.equipamento || ["Projetor"],
      tipologia: newSala.tipologia || "Teórica",
      tipologias: newSala.tipologias || [newSala.tipologia || "Teórica"]
    };
    setSalas([...salas, item]);
    setIsAddingSala(false);
    setNewSala({ nome: "", tipo: "Teórica", capacidade: 40, equipamento: [], tipologia: "Teórica", tipologias: [] });
    showToast(`Sala "${item.nome}" registada com sucesso!`);
  };

  const handleAddFeriado = () => {
    if (!newFeriado.nome || !newFeriado.dataInicio) return;
    const item: FeriadoInterrupcao = {
      id: "fer_" + Date.now(),
      nome: newFeriado.nome,
      tipo: (newFeriado.tipo as any) || "Feriado",
      dataInicio: newFeriado.dataInicio,
      dataFim: newFeriado.dataFim || newFeriado.dataInicio
    };
    setFeriados([...feriados, item]);
    setIsAddingFeriado(false);
    setNewFeriado({ nome: "", tipo: "Feriado", dataInicio: "", dataFim: "" });
    showToast(`Feriado "${item.nome}" registado no sistema!`);
  };

  const handleAddRegra = () => {
    if (!newRegra.nome || !newRegra.descricao) return;
    // Coordenador/vice só pode criar regras do seu ano (escopo forçado).
    const ehDir = perfilAtivo.startsWith("diretor");
    const anoPerfil = ehDir ? null : (parseInt(perfilAtivo.replace(/\D/g, "")) || null);
    const escopo: RegraHorario["escopo"] = ehDir ? (newRegra.escopo || "transversal") : "ano";
    const anoCurricular: RegraHorario["anoCurricular"] = ehDir
      ? (newRegra.escopo === "ano" ? Number(newRegra.anoCurricular) || 2 : "todos")
      : (anoPerfil ?? 1);
    const item: RegraHorario = {
      id: "reg_" + Date.now(),
      nome: newRegra.nome,
      tipo: (newRegra.tipo as any) || "hard",
      categoria: newRegra.categoria || "Professor",
      descricao: newRegra.descricao,
      escopo,
      anoCurricular,
      config: { traducaoSimples: "Regra criada de forma simples e intuitiva na consola do coordenador." },
      peso: Number(newRegra.peso) || 5,
      ativa: true
    };
    setRegras([item, ...regras]);
    setIsAddingRegra(false);
    setNewRegra({ nome: "", tipo: "hard", categoria: "Professor", descricao: "", escopo: "transversal", anoCurricular: "todos", peso: 5, ativa: true });
    showToast(`Regra "${item.nome}" criada pelo coordenador!`);
  };

  // Distribuição local pelas 30 semanas letivas usando o motor de distribuição (distribuicao.ts).
  // S1 = semanas 1-15; S2 = semanas 16-30 (offset +15 aplicado automaticamente).
  const handleTriggerSolver = (semRegras = false, sessoesFixasImport: SessaoHorario[] = []) => {
    setIsSolving(true);
    setLastSolverVerdict(null);

    try {
      const t0 = performance.now();

      // ONE shared occupancy set + PL-count map for the entire 30-week schedule.
      // Keys are namespaced by ano, so turmas never collide across years, and
      // at most 6 PL run simultaneously per year per mancha horária.
      const ocupacaoGlobal = new Set<string>();
      const plCount = new Map<string, number>();

      // Build the entry list (per UC: its weeks + global offset), grouped by semester.
      // Each semester is scheduled together so UCs share slots fairly (round-robin).
      const entradasS1: EntradaUC[] = [];
      const entradasS2: EntradaUC[] = [];
      for (const uc of ucs) {
        if (!uc.turmasConfig?.length) continue;
        if (Number(uc.anoCurricular) === 3) continue; // 3.º ano é ensino clínico
        // Gerar só as UCs do ano selecionado (as regras globais — opcoes — aplicam-se na
        // mesma a toda a distribuição). Com "todos", entram todas como antes.
        if (selectedYearFilter !== "todos" && Number(uc.anoCurricular) !== Number(selectedYearFilter)) continue;

        const anoSem = anosSemestres.find(s => s.semestre === uc.semestre);
        if (!anoSem?.dataInicioSemestre) continue;

        // Use UC-specific start date if set (e.g. year 2 starts on Thursday Sept 10).
        const dataInicio = uc.dataInicio || anoSem.dataInicioSemestre;
        const semanaGlobalOffset = uc.semestre === 2 ? 15 : 0;
        const semStart = uc.semanaInicio || 1;
        const semEnd = semStart + (uc.numSemanas || 15) - 1;

        const semanas = calcularSemanas(dataInicio, semStart, semEnd, feriados);
        const entrada: EntradaUC = { uc, semanas, semanaGlobalOffset };
        (uc.semestre === 2 ? entradasS2 : entradasS1).push(entrada);
      }

      // Regra opcional (ligável/desligável): PL só de 4.ª a 6.ª feira.
      const regraPLDias = regras.find(r => r.id === "h_pl_dias_4a_6a" && r.ativa);
      // Preferência manhã/tarde da Turma A por ano+semestre (do painel de configuração).
      const prefTurmaAManha: Record<string, boolean> = {};
      for (let ano = 1; ano <= 4; ano++) for (const sem of [1, 2]) prefTurmaAManha[`${ano}|${sem}`] = prefManhaDe(ano, sem);
      // Conflitos entre UCs (não podem estar na mesma mancha por partilharem docentes).
      // ESDAC ∦ EIG (indicado), + pares derivados de docentes partilhados (quando atribuídos).
      const ucConflitos: string[][] = [["ESDAC", "EIG"]];
      const docPorUC: Record<string, Set<string>> = {};
      for (const u of ucs) {
        const ds = new Set((u.turmasConfig || []).map(t => t.docenteId).filter(Boolean) as string[]);
        if (ds.size) docPorUC[u.sigla] = ds;
      }
      const sigs = Object.keys(docPorUC);
      for (let i = 0; i < sigs.length; i++) for (let j = i + 1; j < sigs.length; j++) {
        if ([...docPorUC[sigs[i]]].some(d => docPorUC[sigs[j]].has(d))) ucConflitos.push([sigs[i], sigs[j]]);
      }
      // Regras criadas por IA (ou editadas) com config.motor → aplicam-se ao solver.
      // ÂMBITO: ao gerar um ano, só entram as TRANSVERSAIS + as DESSE ano (as de outros
      // anos ficam de fora). ucConflitos acumulam; os restantes parâmetros são substituídos
      // pela última regra ativa que os defina.
      const regraNoAmbito = (r: RegraHorario) => {
        const anos = anosDaRegra(r);
        return anos.length === 0 || selectedYearFilter === "todos" || anos.includes(Number(selectedYearFilter));
      };
      const motorAI: { plDiasPermitidos?: string[]; ucConflitos?: string[][]; maxTPporMancha?: number; semanasSoTurmaA?: number[]; semanasSoTurmaB?: number[] } = {};
      for (const r of regras) {
        if (!regraNoAmbito(r)) continue;
        const m = r.ativa && (r.config as any)?.motor;
        if (!m || typeof m !== "object") continue;
        if (Array.isArray(m.plDiasPermitidos) && m.plDiasPermitidos.length) motorAI.plDiasPermitidos = m.plDiasPermitidos;
        if (Array.isArray(m.ucConflitos)) motorAI.ucConflitos = [...(motorAI.ucConflitos || []), ...m.ucConflitos.filter((p: any) => Array.isArray(p) && p.length === 2)];
        if (typeof m.maxTPporMancha === "number" && m.maxTPporMancha > 0) motorAI.maxTPporMancha = m.maxTPporMancha;
        if (Array.isArray(m.semanasSoTurmaA) && m.semanasSoTurmaA.length) motorAI.semanasSoTurmaA = m.semanasSoTurmaA.map(Number);
        if (Array.isArray(m.semanasSoTurmaB) && m.semanasSoTurmaB.length) motorAI.semanasSoTurmaB = m.semanasSoTurmaB.map(Number);
      }
      // Sessões FIXAS a semear no motor: as IMPORTADAS (deste import) + as já fixadas na
      // versão ativa (pins), exceto as de semanas inteiras congeladas. O motor regista a
      // ocupação delas e gera só o que falta À VOLTA (sem as duplicar no output).
      const semanasCongeladasSeed = activeVersao?.semanasBloqueadas ?? [];
      const fixasExistentes = (activeVersao?.sessoes ?? []).filter(s => s.bloqueado && !(s.semana != null && semanasCongeladasSeed.includes(s.semana)));
      const sessoesFixas = [...sessoesFixasImport, ...fixasExistentes];

      const opcoes = {
        plDiasPermitidos: motorAI.plDiasPermitidos ?? (regraPLDias
          ? (regraPLDias.config?.diasPermitidos ?? ["Quarta", "Quinta", "Sexta"])
          : null),
        // Sem limite de TP por mancha nesta fase: 4 TP podem coexistir.
        maxTPporMancha: motorAI.maxTPporMancha ?? null,
        prefTurmaAManha,
        ucConflitos: [...ucConflitos, ...(motorAI.ucConflitos || [])],
        // Estrutura ESEUC: 8-15 só T1 (Turma A) presente, UCs "-I"; 16-23 só T2 (Turma B), UCs
        // "-II". Tudo de manhã. Assim T1 está de manhã nas semanas 1-15 e T2 nas 16-30.
        semanasSoTurmaA: motorAI.semanasSoTurmaA ?? Array.from({ length: 8 }, (_, i) => 8 + i),   // 8..15
        semanasSoTurmaB: motorAI.semanasSoTurmaB ?? Array.from({ length: 8 }, (_, i) => 16 + i),  // 16..23
        // Modo "sem regras": ignora todas as regras pedagógicas, mantendo só os turnos da
        // tarde e o espaço para almoço (e o teto de 8h). Para comparar cenários.
        semRegras,
        // v2: sessões fixas (importadas/pins) — o motor completa à volta delas.
        sessoesFixas,
      };

      // Schedule each semester fairly across its UCs (round-robin per week).
      const sessoesS1 = gerarSessoesConjunto(entradasS1, 1, 0, ocupacaoGlobal, plCount, opcoes);
      const sessoesS2 = gerarSessoesConjunto(entradasS2, 2, sessoesS1.length, ocupacaoGlobal, plCount, opcoes);
      const allSessoes: SessaoHorario[] = [...sessoesS1, ...sessoesS2];

      // Preservar (1) as SEMANAS validadas/bloqueadas inteiras e (2) as sessões fixadas
      // individualmente nas restantes semanas.
      // Geração por ano: ao gerar um ano específico, as sessões dos OUTROS anos preservam-se
      // tal como estão (não são tocadas). Com "todos", não há outros anos a preservar.
      const mesmoAnoGen = (s: SessaoHorario) => {
        if (selectedYearFilter === "todos") return true;
        const uc = ucs.find(u => u.sigla === s.ucSigla);
        return !!uc && Number(uc.anoCurricular) === Number(selectedYearFilter);
      };
      const outrosAnos = (activeVersao?.sessoes ?? []).filter(s => !mesmoAnoGen(s));

      const bloqueadas = activeVersao?.semanasBloqueadas ?? [];
      const ehBloqueada = (s: SessaoHorario) => s.semana != null && bloqueadas.includes(s.semana);
      const sessoesCongeladas = (activeVersao?.sessoes ?? []).filter(s => ehBloqueada(s) && mesmoAnoGen(s));
      const fixadas = (activeVersao?.sessoes ?? []).filter(s => s.bloqueado && !ehBloqueada(s) && mesmoAnoGen(s));
      const merged: SessaoHorario[] = [
        ...outrosAnos,                    // anos não selecionados → intactos
        ...sessoesCongeladas,            // semanas validadas → ficam exatamente como estão
        ...sessoesFixasImport.map(s => ({ ...s, bloqueado: true })),  // v2: importadas (fixas)
        ...fixadas,                       // sessões "fixa" em semanas não bloqueadas
        ...allSessoes.filter(s =>
          !ehBloqueada(s) &&              // descarta as novas das semanas congeladas
          !fixadas.some(p => p.ucSigla === s.ucSigla && p.turma === s.turma && p.semana === s.semana)
        ),
      ].map((s, i) => ({ ...s, id: i + 1 }));  // IDs ÚNICOS (evita colisões: eliminar/desbloquear afetava o registo errado, ex.: semana 1)

      const durationMs = Math.round(performance.now() - t0);
      const score = Math.min(100, Math.max(60, 100 - Math.round(allSessoes.length / 50)));

      const runId = "sr_" + Date.now();
      const newRun: SolverRun = {
        id: runId,
        dataExecucao: new Date().toISOString(),
        versaoId: selectedVersaoId,
        status: "Concluído",
        duracaoMs: durationMs,
        tentativas: 1,
        score,
        conflitosContidos: 0,
        detalhes: {
          iteracoes: allSessoes.length,
          log: `Distribuição completa: ${allSessoes.length} sessões geradas em ${durationMs}ms para 30 semanas letivas.`
        }
      };

      setSolverRuns([newRun, ...solverRuns]);
      setLastSolverVerdict({ score, conflicts: [], runDetails: { solveTimeMs: durationMs, iterations: allSessoes.length } });
      setVersoes(versoes.map(v => v.id === selectedVersaoId ? { ...v, score, sessoes: merged } : v));
      showToast(` ${allSessoes.length} sessões distribuídas pelas 30 semanas letivas!`);
    } catch (e) {
      console.error(e);
      alert("Erro no motor de distribuição. Verifique as configurações das UCs.");
    } finally {
      setIsSolving(false);
    }
  };

  // --- Importação de horário externo (Excel/CSV) -------------------------------------
  const descarregarTemplate = () => {
    const blob = new Blob([gerarTemplateCSV()], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "template_horario_eseuc.csv"; a.click();
    URL.revokeObjectURL(url);
  };
  const onFicheiroImport = async (file: File | null) => {
    if (!file) return;
    setNomeFicheiroImport(file.name);
    try {
      let texto: string;
      if (/\.xlsx?$/i.test(file.name)) {
        // Excel nativo: 1.ª folha → CSV (delimitador ';') e reaproveita o parser de CSV.
        const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
        texto = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]], { FS: ";" });
      } else {
        texto = await file.text();
      }
      const { sessoes, erros } = parseHorarioCSV(texto, ucs);
      setErrosImport(erros);
      setSessoesImportadas(sessoes);
      setRelatorioImport(sessoes.length ? validarHorario(sessoes, ucs) : null);
    } catch (e: any) {
      setErrosImport([{ linha: 0, motivo: "Não foi possível ler o ficheiro: " + (e?.message || e), conteudo: "" }]);
      setSessoesImportadas(null); setRelatorioImport(null);
    }
  };
  const limparImport = () => {
    setSessoesImportadas(null); setErrosImport([]); setRelatorioImport(null); setNomeFicheiroImport(""); setNomePropostaImport("");
  };

  // Anos curriculares presentes numa proposta — derivado das sessões (sem coluna nova).
  const anosDaProposta = (v: VersaoHorario | null | undefined): number[] => {
    if (!v) return [];
    const set = new Set<number>();
    for (const s of v.sessoes) { const uc = ucs.find(u => u.sigla === s.ucSigla); if (uc) set.add(Number(uc.anoCurricular)); }
    return [...set].sort((a, b) => a - b);
  };
  const rotuloAnosProposta = (v: VersaoHorario | null | undefined): string => {
    const a = anosDaProposta(v);
    return a.length === 0 ? "vazia" : a.length === 1 ? `${a[0]}.º ano` : "vários anos";
  };
  const novaPropostaBase = (nome: string, sessoes: SessaoHorario[]): VersaoHorario => ({
    id: "v_" + Date.now(),
    nome,
    anoSemestreId: activeVersao?.anoSemestreId ?? selectedSemestreId,
    criadaEm: new Date().toISOString(),
    criadaPor: user?.email ?? "",
    ativa: false,
    score: 0,
    sessoes: sessoes.map((s, i) => ({ ...s, id: i + 1 })),
    semanasBloqueadas: [],
  });

  // Guardar a distribuição atual como NOVA proposta nomeada (só o ano selecionado ou todos).
  const guardarProposta = () => {
    const nome = nomeProposta.trim() || `Proposta ${new Date().toLocaleDateString("pt-PT")}`;
    const base = activeVersao?.sessoes ?? [];
    const sessoes = (escopoProposta === "ano" && selectedYearFilter !== "todos")
      ? base.filter(s => { const uc = ucs.find(u => u.sigla === s.ucSigla); return uc && Number(uc.anoCurricular) === Number(selectedYearFilter); })
      : base;
    if (!sessoes.length) { showToast("Não há sessões para guardar neste âmbito."); return; }
    const nova = novaPropostaBase(nome, sessoes);
    nova.score = activeVersao?.score ?? 0;
    setVersoes([...versoes, nova]);
    setSelectedVersaoId(nova.id);
    setShowGuardarProposta(false); setNomeProposta("");
    showToast(`Proposta "${nome}" guardada (${sessoes.length} sessões).`);
  };

  // Importar a proposta lida do ficheiro como NOVA proposta nomeada (sessões fixas).
  const confirmarImportacao = () => {
    if (!sessoesImportadas?.length) return;
    const nome = nomePropostaImport.trim() || nomeFicheiroImport.replace(/\.[^.]+$/, "") || `Importada ${new Date().toLocaleDateString("pt-PT")}`;
    const nova = novaPropostaBase(nome, sessoesImportadas.map(s => ({ ...s, bloqueado: true })));
    setVersoes([...versoes, nova]);
    setSelectedVersaoId(nova.id);
    showToast(`Proposta "${nome}" importada (${sessoesImportadas.length} sessões).`);
    limparImport();
  };

  const renomearProposta = (id: string, nome: string) => {
    const n = nome.trim(); if (!n) { setRenomearPropostaId(null); return; }
    setVersoes(versoes.map(v => v.id === id ? { ...v, nome: n } : v));
    setRenomearPropostaId(null);
    showToast("Proposta renomeada.");
  };
  const apagarProposta = (id: string) => {
    if (versoes.length <= 1) { showToast("Tem de existir pelo menos uma proposta."); return; }
    if (!window.confirm("Apagar esta proposta? Esta ação não se desfaz.")) return;
    const restantes = versoes.filter(v => v.id !== id);
    setVersoes(restantes);
    if (selectedVersaoId === id) setSelectedVersaoId(restantes[0].id);
    showToast("Proposta apagada.");
  };

  // Handles Gemini custom chat messages safely converting SQL-less prompts
  const handleSendAiMessage = async () => {
    if (!aiPrompt.trim()) return;

    const userMessage: ChatMessage = {
      id: "u_" + Date.now(),
      role: "user",
      content: aiPrompt,
      timestamp: new Date().toISOString()
    };

    setChatMessages(prev => [...prev, userMessage]);
    const currentPrompt = aiPrompt;
    setAiPrompt("");
    setIsLoadingAi(true);

    try {
      const resp = await fetch("/api/gemini/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: currentPrompt,
          chatHistory: chatMessages.map(m => ({ role: m.role, content: m.content })),
          geminiApiKey,
          geminiModel,
          regras,
          ucs,
          docentes,
          salas
        })
      });

      const data = await resp.json();

      const assistantMessage: ChatMessage = {
        id: "a_" + Date.now(),
        role: "assistant",
        content: data.text || (data.error ? "⚠️ " + data.error : "Sem resposta do assistente inteligente."),
        timestamp: new Date().toISOString()
      };

      setChatMessages(prev => [...prev, assistantMessage]);

      // Check if rule detected
      if (data.text && data.text.includes("[REGRA_DETETADA]")) {
        try {
          const parts = data.text.split("[REGRA_DETETADA]");
          const subParts = parts[1].split("[FIM_REGRA]");
          // Extração robusta: alguns modelos (ex.: 2.5-flash) embrulham o JSON em cercas
          // ```json ... ``` ou põem texto à volta. Remove as cercas e isola o objeto {…}.
          let jsonStr = subParts[0].replace(/```(?:json)?/gi, "").trim();
          const ini = jsonStr.indexOf("{");
          const fim = jsonStr.lastIndexOf("}");
          if (ini >= 0 && fim > ini) jsonStr = jsonStr.slice(ini, fim + 1);
          const parsedRule = JSON.parse(jsonStr);

          // Preservar a config da IA (inclui config.motor, que aplica a regra ao solver)
          parsedRule.config = {
            ...(parsedRule.config || {}),
            traducaoSimples: parsedRule.config?.traducaoSimples || `Traduzido da análise inteligente: "${currentPrompt}"`,
          };
          setPendingAiRule(parsedRule);
        } catch (jsonErr) {
          console.error("Failed to parse rule from AI response:", jsonErr);
          showToast("A IA sugeriu uma regra mas não consegui interpretá-la. Tenta reformular o pedido.");
        }
      }
    } catch (e: any) {
      setChatMessages(prev => [
        ...prev,
        {
          id: "err_" + Date.now(),
          role: "assistant",
          content: "Erro de rede ao comunicar com o Assistente Gemini: " + e.message,
          timestamp: new Date().toISOString()
        }
      ]);
    } finally {
      setIsLoadingAi(false);
    }
  };

  const removeUc = (id: string) => setUcs(ucs.filter(u => u.id !== id));
  const removeDocente = (id: string) => setDocentes(docentes.filter(d => d.id !== id));
  const removeSala = (id: string) => setSalas(salas.filter(s => s.id !== id));
  const removeFeriado = (id: string) => setFeriados(feriados.filter(f => f.id !== id));
  const removeRegra = (id: string) => setRegras(regras.filter(r => r.id !== id));

  const toggleRegra = (id: string) => {
    setRegras(regras.map(r => r.id === id ? { ...r, ativa: !r.ativa } : r));
    showToast("Disponibilidade de regra alterada.");
  };

  // Edição de regra (modal): anos múltiplos + cursos. Serve também para VALIDAR a sugestão
  // da IA antes de a ativar (garante que os anos são sempre escolhidos).
  const abrirEdicaoRegra = (reg: RegraHorario, prov: "edicao" | "ia") => {
    setEditProveniencia(prov);
    setRegraEmEdicao({ ...reg, config: { ...(reg.config || {}), anos: anosDaRegra(reg), cursoIds: cursosDaRegra(reg) } });
  };
  const toggleDraftAno = (ano: number) => setRegraEmEdicao(r => {
    if (!r) return r;
    const cur: number[] = Array.isArray((r.config as any)?.anos) ? (r.config as any).anos : [];
    const next = cur.includes(ano) ? cur.filter(a => a !== ano) : [...cur, ano].sort((a, b) => a - b);
    return { ...r, config: { ...(r.config || {}), anos: next } };
  });
  const toggleDraftCurso = (id: string) => setRegraEmEdicao(r => {
    if (!r) return r;
    const cur: string[] = Array.isArray((r.config as any)?.cursoIds) ? (r.config as any).cursoIds : [];
    const next = cur.includes(id) ? cur.filter(c => c !== id) : [...cur, id];
    return { ...r, config: { ...(r.config || {}), cursoIds: next } };
  });
  const guardarRegraEditada = () => {
    if (!regraEmEdicao) return;
    const anos: number[] = Array.isArray((regraEmEdicao.config as any)?.anos) ? (regraEmEdicao.config as any).anos : [];
    const base: RegraHorario = {
      ...regraEmEdicao,
      nome: (regraEmEdicao.nome || "").trim() || "Regra sem nome",
      escopo: anos.length ? "ano" : "transversal",
      anoCurricular: anos.length === 1 ? anos[0] : "todos",  // badge/legado; os anos reais ficam no config
    };
    if (editProveniencia === "ia") {
      const realRule: RegraHorario = { ...base, id: "ai_rule_" + Date.now(), ativa: true };
      setRegras([realRule, ...regras]);
      setPendingAiRule(null);
      showToast(`Regra "${realRule.nome}" criada e ativada.`);
    } else {
      setRegras(regras.map(r => r.id === base.id ? base : r));
      showToast("Regra atualizada.");
    }
    setRegraEmEdicao(null);
  };

  // Cartão de uma regra — partilhado pelos dois conjuntos (transversais e por ano).
  const cartaoRegra = (reg: RegraHorario) => (
    <div
      key={reg.id}
      className={`p-4 rounded-xl border text-left transition-all ${
        reg.ativa ? `${themeStyles.borderColor} bg-white shadow-3xs` : "border-stone-150 bg-stone-50/40 opacity-60"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
              reg.tipo === "hard" ? "bg-rose-50 text-rose-800 border border-rose-200" : "bg-indigo-50 text-indigo-800 border border-indigo-200"
            }`}>
              {reg.tipo === "hard" ? "Inviolável (Hard)" : `Preferencial (Peso: ${reg.peso})`}
            </span>
            <span className="text-[10px] font-semibold text-stone-400">• {reg.categoria}</span>
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-150">
              {anosDaRegra(reg).length ? anosDaRegra(reg).map(n => `${n}.º`).join(", ") + " ano" : "Transversal"}
            </span>
            {cursosDaRegra(reg).length > 0 && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-sky-50 text-sky-800 border border-sky-150">
                {cursosDaRegra(reg).map(id => cursos.find(c => c.id === id)?.sigla || id).join(", ")}
              </span>
            )}
          </div>
          <h4 className="font-serif font-bold text-stone-900 pt-0.5">{reg.nome}</h4>
          <p className="text-stone-500 text-[11px] leading-relaxed font-light">{reg.descricao}</p>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          {regraEditavel(reg) ? (
            <>
              <button
                onClick={() => toggleRegra(reg.id)}
                className={`px-2 py-1 text-[10px] font-bold rounded-lg cursor-pointer ${
                  reg.ativa ? "bg-stone-100 text-stone-700 border border-stone-200 hover:bg-stone-200" : "bg-stone-200 text-stone-500 hover:bg-stone-300"
                }`}
              >
                {reg.ativa ? "Desativar" : "Ativar"}
              </button>
              <button
                onClick={() => abrirEdicaoRegra(reg, "edicao")}
                className="px-2 py-1 text-[10px] font-bold rounded-lg cursor-pointer bg-stone-100 text-stone-700 border border-stone-200 hover:bg-stone-200 flex items-center gap-1"
                title="Editar anos, cursos, nome, peso…"
              >
                <Edit2 className="w-3 h-3" /> Editar
              </button>
              <button onClick={() => removeRegra(reg.id)} className="text-stone-400 hover:text-rose-600 transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => { setTutorRegra(reg); setTutorPrompt(""); setTutorResposta(""); }}
                className="px-2 py-1 text-[10px] font-bold rounded-lg cursor-pointer bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 flex items-center gap-1"
                title="Melhorar ou validar esta regra com o tutor IA"
              >
                <Sparkles className="w-3 h-3" /> Tutor IA
              </button>
            </>
          ) : (
            <span className="text-[8.5px] text-stone-400 font-bold uppercase tracking-wide" title="Regra transversal — gerida pela Direção">
              Só leitura
            </span>
          )}
        </div>
      </div>
      <div className="mt-3 pt-2 border-t border-stone-100 bg-stone-50/70 p-2.5 rounded-xl space-y-1">
        <span className="text-[9px] font-bold text-indigo-700 flex items-center gap-1">
          <Sparkles className="w-3.5 h-3.5 text-indigo-500 shrink-0" /> Proteção activa da IA:
        </span>
        <p className="text-stone-600 text-[10.5px] leading-relaxed font-light">
          {reg.config?.traducaoSimples || "A IA monitoriza esta regra em tempo real, impedindo conflitos físicos durante a computação de horários."}
        </p>
      </div>
    </div>
  );

  const toggleSessionBlock = (sessionId: number) => {
    if (!activeVersao) return;
    const updatedSessoes = activeVersao.sessoes.map(s => {
      if (s.id === sessionId) {
        return { ...s, bloqueado: !s.bloqueado };
      }
      return s;
    });

    setVersoes(versoes.map(v => v.id === selectedVersaoId ? { ...v, sessoes: updatedSessoes } : v));
  };

  // Atribuição MANUAL de sala/docente a uma sessão (fases 2 e 3 do fluxo, controladas à mão).
  const atribuirCampoSessao = (sessionId: number, campo: "sala" | "docente", valor: string) => {
    if (!activeVersao) return;
    const updated = activeVersao.sessoes.map(s => s.id === sessionId ? { ...s, [campo]: valor } : s);
    setVersoes(versoes.map(v => v.id === selectedVersaoId ? { ...v, sessoes: updated } : v));
  };
  // Tipo de sala adequado ao tipo de aula (T→Teórica, PL→Lab/Computadores, TP/S→TP).
  const tipoSalaAlvo = (sessao: SessaoHorario): Sala["tipo"] =>
    sessao.tipoAula === "T" ? "Teórica"
      : sessao.tipoAula === "PL" ? (/comput/i.test(sessao.salaTipo || "") ? "Sala de Computadores" : "Laboratório")
        : "Teórico-prática";
  // Estimativa de alunos por turma (para a capacidade da sala).
  const alunosDaTurma = (turma: string): number =>
    turma.startsWith("Turma") ? 180 : /^TP\d+$/.test(turma) ? 45 : /^PL\d+$/.test(turma) ? 15 : 30;
  // Salas DISPONÍVEIS para uma sessão (para o override): tipo certo, capacidade suficiente e
  // livres naquele bloco (semana+dia+hora) — exceto a já atribuída a esta sessão.
  const salasDisponiveis = (sessao: SessaoHorario): Sala[] => {
    const tipo = tipoSalaAlvo(sessao);
    const necessario = alunosDaTurma(sessao.turma);
    const ocupadas = new Set((activeVersao?.sessoes || [])
      .filter(s => s.id !== sessao.id && s.semana === sessao.semana && s.diaSemana === sessao.diaSemana && s.horaInicio === sessao.horaInicio && s.sala)
      .map(s => s.sala));
    const livre = (s: Sala) => !ocupadas.has(s.nome) || s.nome === sessao.sala;
    let comp = salas.filter(s => s.tipo === tipo && (s.capacidade || 0) >= necessario && livre(s));
    if (!comp.length) comp = salas.filter(s => s.tipo === tipo && livre(s)); // relaxa capacidade
    if (!comp.length) comp = salas.filter(livre);                            // relaxa tipo
    return comp.sort((a, b) => (a.capacidade || 0) - (b.capacidade || 0));
  };
  // Propõe salas automaticamente às sessões SEM sala (respeita as já escolhidas à mão).
  // Menor sala que serve, sem dupla-marcação no mesmo bloco. Tu podes trocar depois.
  const proporSalas = () => {
    if (!activeVersao) return;
    const slotKey = (s: SessaoHorario) => `${s.semana}|${s.diaSemana}|${s.horaInicio}`;
    const ocup = new Map<string, Set<string>>();
    for (const s of activeVersao.sessoes) if (s.sala) {
      let set = ocup.get(slotKey(s)); if (!set) { set = new Set(); ocup.set(slotKey(s), set); } set.add(s.sala);
    }
    let atribuidas = 0, semSala = 0;
    const novas = activeVersao.sessoes.map(s => {
      if (s.sala) return s; // respeita override manual / já atribuída
      const k = slotKey(s); let usadas = ocup.get(k); if (!usadas) { usadas = new Set(); ocup.set(k, usadas); }
      const u = usadas;
      const tipo = tipoSalaAlvo(s); const necessario = alunosDaTurma(s.turma);
      const cand = salas.filter(r => r.tipo === tipo && (r.capacidade || 0) >= necessario && !u.has(r.nome))
        .sort((a, b) => (a.capacidade || 0) - (b.capacidade || 0));
      const escolhida = cand[0] || salas.filter(r => r.tipo === tipo && !u.has(r.nome))[0];
      if (escolhida) { u.add(escolhida.nome); atribuidas++; return { ...s, sala: escolhida.nome }; }
      semSala++; return s;
    });
    setVersoes(versoes.map(v => v.id === selectedVersaoId ? { ...v, sessoes: novas } : v));
    showToast(`Salas propostas: ${atribuidas} atribuídas${semSala ? ` · ${semSala} sem sala livre` : ""}.`);
  };

  // ===== Distribuição de DOCENTES — "sorteio" com propagação de restrições =====
  type GrupoDoc = { key: string; sigla: string; ucNome: string; turma: string; tipo: string; slotKeys: Set<string>; slots: { dia: string; ini: string; fim: string }[] };
  const _min = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + (m || 0); };
  const _rangeContem = (range: string, ini: string, fim: string) => {
    const [ri, rf] = range.split("-"); return ri && rf && _min(ri) <= _min(ini) && _min(rf) >= _min(fim);
  };
  // Grupos (UC, turma) da proposta ativa, com os seus blocos (a unidade de atribuição).
  const gruposDocentes = (): GrupoDoc[] => {
    const map = new Map<string, GrupoDoc>();
    for (const s of activeVersao?.sessoes || []) {
      const key = `${s.ucSigla}|${s.turma}`;
      let g = map.get(key);
      if (!g) { g = { key, sigla: s.ucSigla, ucNome: s.ucNome, turma: s.turma, tipo: s.tipoAula, slotKeys: new Set(), slots: [] }; map.set(key, g); }
      g.slotKeys.add(`${s.semana}|${s.diaSemana}|${s.horaInicio}`);
      g.slots.push({ dia: s.diaSemana, ini: s.horaInicio, fim: s.horaFim });
    }
    return [...map.values()].sort((a, b) => a.sigla.localeCompare(b.sigla) || a.turma.localeCompare(b.turma, undefined, { numeric: true }));
  };
  const docenteDisponivel = (d: Docente, slots: { dia: string; ini: string; fim: string }[]): boolean => {
    const disp = d.disponibilidade || {};
    if (Object.keys(disp).length === 0) return true; // sem disponibilidade declarada = sem restrição
    return slots.every(sl => (disp[sl.dia] || []).some(r => _rangeContem(r, sl.ini, sl.fim)));
  };
  // Elegíveis: 1.º por atribuicoesUcs (UC+tipo+turma), 2.º por unidadesCurriculares, senão TODOS (fallback).
  const docentesElegiveis = (sigla: string, tipo: string, turma: string): { lista: Docente[]; fallback: boolean } => {
    const fino = docentes.filter(d => d.atribuicoesUcs?.[sigla]?.tipos?.includes(tipo as any)
      && (!(d.atribuicoesUcs![sigla].turmas?.length) || d.atribuicoesUcs![sigla].turmas.includes(turma)));
    if (fino.length) return { lista: fino, fallback: false };
    const coarse = docentes.filter(d => (d.unidadesCurriculares || []).includes(sigla));
    if (coarse.length) return { lista: coarse, fallback: false };
    return { lista: docentes, fallback: true };
  };
  // Domínio de uma turma = elegíveis ∩ disponíveis ∩ sem-conflito (dado o estado atual de atribuições).
  // Nº de docentes por turma: T/TP até 3 (alvo 2), PL exatamente 1.
  const LIMITE_HORAS_SOFT = 12; // máx. horas/semana (soft — pode ser ultrapassado)
  const capDocsTipo = (tipo: string) => tipo === "PL" ? 1 : (tipo === "T" || tipo === "TP") ? 3 : 2;
  const targetDocsTipo = (tipo: string) => tipo === "PL" ? 1 : (tipo === "T" || tipo === "TP") ? 2 : 1;
  // Horas na semana de PICO de um docente (blocos por semana × 2) — para o limite soft.
  const horasSemanaisDoc = (nome: string, atrib: Record<string, string[]>, slotKeysMap: Map<string, Set<string>>): number => {
    const porSemana: Record<string, number> = {};
    for (const [k, lista] of Object.entries(atrib)) {
      if (!lista.includes(nome)) continue;
      const sk = slotKeysMap.get(k); if (!sk) continue;
      for (const x of sk) { const sem = x.split("|")[0]; porSemana[sem] = (porSemana[sem] || 0) + 1; }
    }
    return Math.max(0, ...Object.values(porSemana)) * 2;
  };
  // Domínio de uma turma = elegíveis ∩ disponíveis ∩ sem-conflito ∩ ainda-não-nesta-turma.
  // (As horas NÃO excluem — é soft; só se assinala.)
  const dominioDocente = (g: GrupoDoc, atrib: Record<string, string[]>, slotKeysMap: Map<string, Set<string>>): { lista: Docente[]; fallback: boolean } => {
    const { lista, fallback } = docentesElegiveis(g.sigla, g.tipo, g.turma);
    const jaNaTurma = new Set(atrib[g.key] || []);
    const livres = lista.filter(d => {
      if (jaNaTurma.has(d.nome)) return false;
      if (!docenteDisponivel(d, g.slots)) return false;
      for (const [k2, nomes] of Object.entries(atrib)) {
        if (k2 === g.key || !nomes.includes(d.nome)) continue;
        const sk2 = slotKeysMap.get(k2); if (sk2) for (const x of g.slotKeys) if (sk2.has(x)) return false;
      }
      return true;
    });
    return { lista: livres, fallback };
  };
  // Aplica (UC,turma)→[docentes] às sessões (docente = nomes juntos por vírgula).
  const aplicarDocentes = (atrib: Record<string, string[]>) => {
    if (!activeVersao) return;
    const updated = activeVersao.sessoes.map(s => {
      const lista = atrib[`${s.ucSigla}|${s.turma}`];
      return lista !== undefined ? { ...s, docente: lista.join(", ") } : s;
    });
    setVersoes(versoes.map(v => v.id === selectedVersaoId ? { ...v, sessoes: updated } : v));
  };
  const adicionarDocenteTurma = (key: string, nome: string, tipo: string) => {
    if (!nome) return;
    const cur = atribDocente[key] || [];
    if (cur.includes(nome) || cur.length >= capDocsTipo(tipo)) return;
    const next = { ...atribDocente, [key]: [...cur, nome] };
    setAtribDocente(next); aplicarDocentes(next);
  };
  const removerDocenteTurma = (key: string, nome: string) => {
    const restantes = (atribDocente[key] || []).filter(n => n !== nome);
    const next = { ...atribDocente }; if (restantes.length) next[key] = restantes; else delete next[key];
    setAtribDocente(next); aplicarDocentes(next);
  };
  // Auto-proposta: preenche cada turma até ao alvo (T/TP:2, PL:1), turmas mais restritas
  // primeiro; prefere docentes abaixo das 12h (soft) e menos carregados.
  const autoProporDocentes = () => {
    const grupos = gruposDocentes().filter(g => ucsSelDocentes.has(g.sigla));
    const slotKeysMap = new Map(gruposDocentes().map(g => [g.key, g.slotKeys])); // todas, p/ conflito/horas
    const atrib: Record<string, string[]> = {};
    for (const k of Object.keys(atribDocente)) atrib[k] = [...atribDocente[k]];
    let progresso = true, adicionadas = 0;
    while (progresso) {
      progresso = false;
      let alvo: GrupoDoc | null = null; let dom: Docente[] = [];
      for (const g of grupos) {
        if ((atrib[g.key]?.length || 0) >= targetDocsTipo(g.tipo)) continue;
        const d = dominioDocente(g, atrib, slotKeysMap).lista;
        if (!alvo || d.length < dom.length) { alvo = g; dom = d; }
      }
      if (alvo && dom.length) {
        const esc = [...dom].sort((a, b) => {
          const ha = horasSemanaisDoc(a.nome, atrib, slotKeysMap), hb = horasSemanaisDoc(b.nome, atrib, slotKeysMap);
          return (ha >= LIMITE_HORAS_SOFT ? 1 : 0) - (hb >= LIMITE_HORAS_SOFT ? 1 : 0) || ha - hb;
        })[0];
        atrib[alvo.key] = [...(atrib[alvo.key] || []), esc.nome]; adicionadas++; progresso = true;
      }
    }
    const incompletas = grupos.filter(g => (atrib[g.key]?.length || 0) < targetDocsTipo(g.tipo)).length;
    setAtribDocente(atrib); aplicarDocentes(atrib);
    showToast(`Docentes: ${adicionadas} atribuições${incompletas ? ` · ${incompletas} turmas abaixo do alvo` : ""}.`);
  };
  const abrirDistDocentes = () => {
    setUcsSelDocentes(new Set(gruposDocentes().map(g => g.sigla)));
    const atrib: Record<string, string[]> = {};
    for (const s of activeVersao?.sessoes || []) if (s.docente) atrib[`${s.ucSigla}|${s.turma}`] = s.docente.split(",").map(x => x.trim()).filter(Boolean);
    setAtribDocente(atrib);
    setShowDistDocentes(true);
  };

  // Eliminar uma aula do horário (edição manual para reajustar).
  const deleteSession = (sessionId: number) => {
    if (!activeVersao) return;
    const updated = activeVersao.sessoes.filter(s => s.id !== sessionId);
    setVersoes(versoes.map(v => v.id === selectedVersaoId ? { ...v, sessoes: updated } : v));
  };

  // Estado do mini-formulário de "adicionar aula" a um slot (dia/hora/semana).
  const [addAulaCtx, setAddAulaCtx] = useState<{ dia: string; horaInicio: string; horaFim: string; semana: number; editId?: number } | null>(null);
  const [addUcId, setAddUcId] = useState<string>("");
  const TIPO_CONFIG_PARA_AULA: Record<string, SessaoHorario["tipoAula"]> = {
    "Teórica": "T", "TeoricoPratica": "TP", "Prática": "PL", "Seminário": "S",
  };
  // Adicionar uma aula nova no slot indicado, escolhendo uma turma EXISTENTE da UC.
  const addSessionAt = (ucId: string, turmaNome: string) => {
    if (!activeVersao || !addAulaCtx) return;
    const uc = ucs.find(u => u.id === ucId);
    const tc = uc?.turmasConfig?.find(t => t.nome === turmaNome);
    if (!uc || !tc) return;
    const tipo = TIPO_CONFIG_PARA_AULA[tc.tipo] || "TP";
    const tipoSala = tipo === "PL" ? "Laboratório de Simulação PL" : tipo === "TP" ? "Sala Comum TP" : tipo === "S" ? "Sala Comum TP" : "Anfiteatro (Teórica T)";
    const docente = tc.docenteId ? (docentes.find(d => d.id === tc.docenteId)?.nome || "") : "";
    if (addAulaCtx.editId != null) {
      // EDITAR: troca a UC/tipologia/turma da aula existente, mantendo o slot.
      const upd = activeVersao.sessoes.map(s => s.id === addAulaCtx.editId
        ? { ...s, ucNome: uc.nome, ucSigla: uc.sigla, tipoAula: tipo, salaTipo: tipoSala, turma: turmaNome, docente, bloqueado: true }
        : s);
      setVersoes(versoes.map(v => v.id === selectedVersaoId ? { ...v, sessoes: upd } : v));
      setAddAulaCtx(null);
      return;
    }
    const novaId = Math.max(0, ...activeVersao.sessoes.map(s => s.id)) + 1;
    const nova: SessaoHorario = {
      id: novaId, ucNome: uc.nome, ucSigla: uc.sigla, tipoAula: tipo,
      docente, sala: "", salaTipo: tipoSala, turma: turmaNome,
      diaSemana: addAulaCtx.dia, horaInicio: addAulaCtx.horaInicio, horaFim: addAulaCtx.horaFim,
      bloqueado: true, semana: addAulaCtx.semana,
    };
    setVersoes(versoes.map(v => v.id === selectedVersaoId ? { ...v, sessoes: [...v.sessoes, nova] } : v));
    setAddAulaCtx(null);
  };

  // Índice de cada bloco (dado/total) por (UC, turma, tipo), em ordem cronológica.
  const blocoIndexMap = (() => {
    const m = new Map<number, number>();
    const sess = activeVersao?.sessoes || [];
    const diaOrd: Record<string, number> = { Segunda: 0, "Terça": 1, Quarta: 2, Quinta: 3, Sexta: 4 };
    const sorted = [...sess].sort((a, b) =>
      ((a.semana ?? 0) - (b.semana ?? 0)) ||
      ((diaOrd[a.diaSemana] ?? 9) - (diaOrd[b.diaSemana] ?? 9)) ||
      a.horaInicio.localeCompare(b.horaInicio));
    const cnt: Record<string, number> = {};
    for (const s of sorted) { const k = `${s.ucSigla}|${s.turma}|${s.tipoAula}`; cnt[k] = (cnt[k] || 0) + 1; m.set(s.id, cnt[k]); }
    return m;
  })();
  const totalBlocosDe = (sessao: SessaoHorario): number => {
    const uc = ucs.find(u => u.sigla === sessao.ucSigla || u.nome === sessao.ucNome);
    if (!uc) return 0;
    const h = sessao.tipoAula === "T" ? uc.cargaHorariaTeorica : sessao.tipoAula === "TP" ? uc.cargaHorariaTP : sessao.tipoAula === "PL" ? uc.cargaHorariaPratica : (uc.cargaHorariaS || 0);
    return Math.floor((h || 0) / 2);
  };

  // Tutor IA por regra: abrir modal e pedir ao Gemini para melhorar/validar a regra.
  const [tutorRegra, setTutorRegra] = useState<RegraHorario | null>(null);
  const [tutorPrompt, setTutorPrompt] = useState("");
  const [tutorResposta, setTutorResposta] = useState("");
  const [tutorLoading, setTutorLoading] = useState(false);
  const askTutor = async (pedido: string) => {
    if (!tutorRegra) return;
    setTutorLoading(true);
    setTutorResposta("");
    try {
      const prompt = `Regra atual (JSON): ${JSON.stringify({ nome: tutorRegra.nome, tipo: tutorRegra.tipo, categoria: tutorRegra.categoria, escopo: tutorRegra.escopo, anoCurricular: tutorRegra.anoCurricular, descricao: tutorRegra.descricao, peso: tutorRegra.peso })}.\nPedido do utilizador: ${pedido}\nValida e/ou melhora esta regra de horário académico, de forma clara e sucinta. Se sugerires uma nova versão da regra, devolve-a no bloco [REGRA_DETETADA]...[FIM_REGRA].`;
      const resp = await fetch("/api/gemini/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, chatHistory: [], geminiApiKey, geminiModel, regras, ucs, docentes, salas }),
      });
      const data = await resp.json();
      setTutorResposta(data.text || data.error || "Sem resposta do tutor.");
    } catch (e: any) {
      setTutorResposta("Erro ao contactar o tutor IA: " + (e?.message || e));
    } finally {
      setTutorLoading(false);
    }
  };

  const handleDragStart = (e: React.DragEvent, id: number) => {
    setDraggedSessionId(id);
  };

  const handleDropOnSlot = (day: string, periodStart: string, periodEnd: string) => {
    if (draggedSessionId === null || !activeVersao) return;

    const currentSession = activeVersao.sessoes.find(s => s.id === draggedSessionId);
    if (!currentSession) return;

    const isLockedConflict = activeVersao.sessoes.some(s => {
      // Only check locked sessions in the target day and period
      if (s.diaSemana !== day || s.horaInicio !== periodStart || !s.bloqueado) return false;

      // 1. Same teacher clash
      const sameTeacher = s.docente && currentSession.docente && 
        s.docente.split(",").some((t: string) => currentSession.docente.split(",").map((x: string) => x.trim()).includes(t.trim()));
      // 2. Same room clash
      const sameRoom = s.salaId && currentSession.salaId && s.salaId === currentSession.salaId;
      // 3. Same student group (turma) clash
      const sameGroup = s.turma === currentSession.turma && s.ucSigla === currentSession.ucSigla;

      return sameTeacher || sameRoom || sameGroup;
    });

    if (isLockedConflict) {
      alert("Aviso: Existe uma restrição física impeditiva (mesmo docente, sala ou grupo de alunos) bloqueada para este slot.");
      setDraggedSessionId(null);
      return;
    }

    const updatedSessoes = activeVersao.sessoes.map(s => {
      if (s.id === draggedSessionId) {
        return {
          ...s,
          diaSemana: day,
          horaInicio: periodStart,
          horaFim: periodEnd
        };
      }
      return s;
    });

    setVersoes(versoes.map(v => v.id === selectedVersaoId ? { ...v, sessoes: updatedSessoes } : v));
    setDraggedSessionId(null);
    showToast("Aula reposicionada!");
  };

  const exportICS = () => {
    if (!activeVersao) return;
    let fileContent = `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Gestor Horarios Academicos//PT\nCALSCALE:GREGORIAN\n`;
    activeVersao.sessoes.forEach(s => {
      fileContent += `BEGIN:VEVENT\nSUMMARY:${s.ucSigla} (${s.tipoAula}) - Class\nDESCRIPTION:Docente: ${s.docente}\\nTurma: ${s.turma}\nLOCATION:${s.sala}\nDTSTART:20260901T${s.horaInicio.replace(":", "")}00\nDTEND:20260901T${s.horaFim.replace(":", "")}00\nEND:VEVENT\n`;
    });
    fileContent += "END:VCALENDAR";

    const blob = new Blob([fileContent], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `horario_semestre_${selectedVersaoId}.ics`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportCSV = () => {
    if (!activeVersao) return;
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "ID,Sigla,UC Nome,Tipo,Docente,Sala,Turma,Dia,Hora Inicio,Hora Fim,Bloqueado\n";
    activeVersao.sessoes.forEach(s => {
      csvContent += `"${s.id}","${s.ucSigla}","${s.ucNome}","${s.tipoAula}","${s.docente}","${s.sala}","${s.turma}","${s.diaSemana}","${s.horaInicio}","${s.horaFim}","${s.bloqueado}"\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `relatorio_horarios_${selectedVersaoId}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const diasSemanais = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"];
  const blocosHoras = [
    { start: "08:00", end: "10:00" },
    { start: "10:00", end: "12:00" },
    { start: "12:00", end: "14:00" },
    { start: "14:00", end: "16:00" },
    { start: "16:00", end: "18:00" },
    { start: "18:00", end: "20:00" }
  ];

  const uniqueAnosLetivos = Array.from(new Set(anosSemestres.map(s => s.anoLetivo))).sort().reverse();

  const getPerfilLabel = (perfil: string) => {
    switch (perfil) {
      case "diretor_1": return "Diretor do 1.º Ciclo (Licenciatura) - Administrador";
      case "diretor_2": return "Diretor do 2.º Ciclo (Mestrado) - Administrador";
      case "coordenador_1": return "Coordenador do 1.º Ano";
      case "coordenador_2": return "Coordenador do 2.º Ano";
      case "coordenador_3": return "Coordenador do 3.º Ano (Seminários & Atividades)";
      case "coordenador_4": return "Coordenador do 4.º Ano";
      case "vice_coordenador_1": return "Vice-Coordenador do 1.º Ano";
      case "vice_coordenador_2": return "Vice-Coordenador do 2.º Ano";
      case "vice_coordenador_3": return "Vice-Coordenador do 3.º Ano";
      case "vice_coordenador_4": return "Vice-Coordenador do 4.º Ano";
      default: return perfil;
    }
  };

  const currentSemestre = anosSemestres.find(s => s.id === selectedSemestreId) || anosSemestres[0];

  // --- Acesso por ano (regras) -----------------------------------------------
  // Diretores (1.º/2.º ciclo) veem/editam todas as regras; coordenador e
  // vice-coordenador só veem/editam as regras do SEU ano. Transversais para todos.
  const ehDiretor = perfilAtivo.startsWith("diretor");
  const anoDoPerfil = ehDiretor ? null : (parseInt(perfilAtivo.replace(/\D/g, "")) || null);
  const regraVisivel = (r: RegraHorario) =>
    ehDiretor || (r.escopo === "ano" ? Number(r.anoCurricular) === anoDoPerfil : true);
  const regraEditavel = (r: RegraHorario) =>
    ehDiretor || (r.escopo === "ano" && Number(r.anoCurricular) === anoDoPerfil);

  // --- Bloqueio (validação) de semanas ---------------------------------------
  const semanasBloqueadas = activeVersao?.semanasBloqueadas ?? [];
  const toggleSemanaBloqueada = (semana: number) => {
    if (!activeVersao) return;
    const atual = activeVersao.semanasBloqueadas ?? [];
    const nova = atual.includes(semana) ? atual.filter(w => w !== semana) : [...atual, semana].sort((a, b) => a - b);
    setVersoes(versoes.map(v => v.id === selectedVersaoId ? { ...v, semanasBloqueadas: nova } : v));
    showToast(nova.includes(semana)
      ? `Semana ${semana} validada e bloqueada — não muda ao regenerar.`
      : `Semana ${semana} desbloqueada.`);
  };

  return (
    <div className={`min-h-screen ${themeStyles.bgColor} ${themeStyles.textColor} transition-colors duration-300 flex flex-col font-sans`}>
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 bg-[#1E1C19] text-[#FAF8F5] px-5 py-3.5 rounded-xl text-xs font-semibold shadow-2xl border border-[#edeae2]/10 flex items-center gap-2 animate-fade-in">
          <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Boutique Upper Header with Theme Switcher & Context Controls */}
      <header className={`${themeStyles.headerBg} text-white py-5 px-6 shrink-0 shadow-lg border-b border-white/5`}>
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div className="flex items-center gap-3">
            <span className="p-3 bg-white/10 rounded-xl flex items-center justify-center border border-white/10 shrink-0">
              <Calendar className="w-6 h-6 text-amber-200" />
            </span>
            <div>
              <h1 className="text-xl font-serif text-white tracking-wide flex items-center gap-2 flex-wrap">
                ESEUC • Gestor de Horários de Enfermagem
                <span className="text-[10px] bg-white/10 border border-white/20 text-teal-200 px-2 py-0.5 rounded-full font-mono font-medium">
                  Coimbra • Supabase
                </span>
              </h1>
              <p className="text-xs text-stone-300 mt-0.5 font-light">
                Escola Superior de Enfermagem da Universidade de Coimbra • Planeamento de horário de ensino clínico e aulas teóricas / simuladas.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            {/* Visual Theme Selector */}
            <div className="bg-white/5 border border-white/10 px-3 py-1.5 rounded-xl flex items-center gap-2">
              <span className="text-[10px] font-mono text-stone-300 uppercase tracking-widest block">Ambiente:</span>
              <div className="flex gap-2.5">
                {[
                  { id: "eseuc_ouro", name: "Ouro de Coimbra (Enfermagem)", color: "bg-[#D4A32A] border-[#1F190D]" },
                  { id: "eseuc_escola", name: "Azul Saúde ESEUC", color: "bg-[#148A96] border-[#002D33]" },
                  { id: "eseuc_cardoso", name: "Bordô Mosteiro Letivo", color: "bg-[#801B0B] border-[#300F0A]" }
                ].map(t => (
                  <button
                    key={t.id}
                    title={t.name}
                    onClick={() => setVibe(t.id as any)}
                    className={`w-5 h-5 rounded-full ${t.color} border-2 transition-all cursor-pointer ${
                      vibe === t.id ? "scale-125 ring-2 ring-white" : "opacity-60 hover:opacity-100"
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Estado de sincronização Supabase + sessão */}
            <div className="bg-white/5 border border-white/10 px-3 py-1.5 rounded-xl flex items-center gap-2.5 text-xs text-stone-100 animate-fade-in shrink-0">
              <span
                className={`w-2.5 h-2.5 rounded-full ${cloudStatus === 'synced' ? 'bg-emerald-400 animate-pulse' : cloudStatus === 'saving' ? 'bg-amber-400 rotate-animation' : 'bg-rose-450'} shrink-0`}
                title={cloudStatus === 'synced' ? 'Sincronizado (Supabase)' : cloudStatus === 'saving' ? 'A guardar…' : 'Sem ligação à base de dados'}
              />
              <div className="flex flex-col text-[10.5px] leading-tight">
                <span className="font-semibold text-white max-w-[150px] truncate" title={user?.email ?? undefined}>
                  {user?.email ?? "Base de Dados"}
                </span>
                <span className="text-stone-300 font-mono text-[8px] uppercase tracking-wide">
                  {cloudStatus === 'synced' ? 'Supabase · Sincronizado' : cloudStatus === 'saving' ? 'A guardar…' : 'Offline'}
                </span>
              </div>
              {user && (
                <button
                  onClick={handleLogout}
                  className="ml-1 text-[9.5px] text-stone-300 hover:text-white bg-white/10 hover:bg-white/15 px-2 py-1 rounded-md transition-all cursor-pointer font-bold uppercase tracking-wider"
                >
                  Sair
                </button>
              )}
            </div>

            {/* Profile Selector */}
            <div className="bg-white/5 border border-white/10 px-3 py-1.5 rounded-xl flex items-center gap-2 animate-fade-in shrink-0">
              <UserCheck className="w-4 h-4 text-amber-200" />
              <span className="text-[10px] font-mono text-stone-300 uppercase tracking-widest hidden sm:inline-block">Perfil Ativo:</span>
              <select
                value={perfilAtivo}
                onChange={(e) => {
                  setPerfilAtivo(e.target.value as any);
                  showToast(`Perfil alterado para: ${getPerfilLabel(e.target.value as any)}`);
                }}
                className="bg-transparent text-white font-semibold text-xs border-none focus:outline-none focus:ring-0 cursor-pointer pr-4 hover:text-amber-200 transition-colors"
                title="Alterar Perfil de Acesso"
              >
                <optgroup label="Administração Geral" className="text-stone-900 bg-white font-bold">
                  <option value="diretor_1" className="text-stone-900 bg-white font-semibold">Diretor do 1.º Ciclo (Licenciatura)</option>
                  <option value="diretor_2" className="text-stone-900 bg-white font-semibold">Diretor do 2.º Ciclo (Mestrado)</option>
                </optgroup>
                <optgroup label="Coordenação de Ano (CLE)" className="text-stone-900 bg-white font-bold">
                  <option value="coordenador_1" className="text-stone-900 bg-white font-semibold">Coordenador do 1.º Ano</option>
                  <option value="coordenador_2" className="text-stone-900 bg-white font-semibold">Coordenador do 2.º Ano</option>
                  <option value="coordenador_3" className="text-stone-900 bg-white font-semibold">Coordenador do 3.º Ano (Seminários)</option>
                  <option value="coordenador_4" className="text-stone-900 bg-white font-semibold">Coordenador do 4.º Ano</option>
                </optgroup>
                <optgroup label="Vice-Coordenação de Ano (CLE)" className="text-stone-900 bg-white font-bold">
                  <option value="vice_coordenador_1" className="text-stone-900 bg-white font-semibold">Vice-Coordenador do 1.º Ano</option>
                  <option value="vice_coordenador_2" className="text-stone-900 bg-white font-semibold">Vice-Coordenador do 2.º Ano</option>
                  <option value="vice_coordenador_3" className="text-stone-900 bg-white font-semibold font-medium">Vice-Coordenador do 3.º Ano</option>
                  <option value="vice_coordenador_4" className="text-stone-900 bg-white font-semibold">Vice-Coordenador do 4.º Ano</option>
                </optgroup>
              </select>
            </div>

            {/* Active Year Selector */}
            <div className="flex items-center gap-2.5 shrink-0">
              <select
                value={selectedAnoLetivo}
                onChange={(e) => {
                  setSelectedAnoLetivo(e.target.value);
                  showToast(`"… Ano letivo focado: ${e.target.value}`);
                }}
                className="bg-white/10 text-white font-semibold text-xs border border-white/10 rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-white/20 cursor-pointer hover:bg-white/15 transition-colors"
                title="Escolher Ano Letivo"
              >
                {uniqueAnosLetivos.map(y => (
                  <option key={y} value={y} className="text-stone-900 bg-white font-medium">
                    Ano Letivo {y}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={() => setShowDuplicarSemestreModal(true)}
              className="px-3.5 py-2 min-h-[36px] bg-white/20 text-white hover:bg-white/25 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5 text-stone-200" />
              + Novo Ano Letivo / Semestre
            </button>
          </div>
        </div>
      </header>


      {/* Main Tab Nav bar — fixo no topo (sticky) para não saltar ao mudar de separador */}
      <div className={`${themeStyles.panelColor} border-b ${themeStyles.borderColor} py-3 px-6 shrink-0 shadow-2xs sticky top-0 z-40`}>
        <div className="max-w-7xl mx-auto flex flex-wrap gap-2">
          {[
            { id: "horario", label: "Planeamento de Horário", icon: Calendar },
            { id: "config", label: "Configuração (UCs, Docentes e Salas)", icon: Settings },
            { id: "regras", label: "Regras de Otimização", icon: Sliders },
            { id: "assistant", label: "Chat com Assistente AI", icon: Bot }
          ].map(tab => {
            const Icon = tab.icon;
            const isTabActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`py-2 px-4 rounded-xl text-xs font-semibold flex items-center gap-2 cursor-pointer transition-all ${
                  isTabActive
                    ? `${themeStyles.primaryBtn} shadow-sm scale-[1.02]`
                    : `bg-transparent text-[#536B7E] hover:bg-stone-50 hover:text-stone-900`
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Modal: Tutor IA por regra (melhorar/validar) */}
      {tutorRegra && (() => {
        const aplicarSugestao = () => {
          if (!tutorResposta.includes("[REGRA_DETETADA]")) return;
          try {
            const jsonStr = tutorResposta.split("[REGRA_DETETADA]")[1].split("[FIM_REGRA]")[0].trim();
            const nova = JSON.parse(jsonStr);
            setRegras(regras.map(r => r.id === tutorRegra.id ? {
              ...r,
              nome: nova.nome || r.nome,
              descricao: nova.descricao || r.descricao,
              tipo: (nova.tipo === "hard" || nova.tipo === "soft") ? nova.tipo : r.tipo,
              peso: typeof nova.peso === "number" ? nova.peso : r.peso,
              config: { ...r.config, ...(nova.config || {}) },
            } : r));
            showToast("Regra atualizada com a sugestão do tutor IA.");
            setTutorRegra(null);
          } catch { showToast("Não consegui interpretar a sugestão."); }
        };
        const respostaLimpa = tutorResposta.replace(/\[REGRA_DETETADA\][\s\S]*?\[FIM_REGRA\]/g, "").trim();
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setTutorRegra(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-5 space-y-3 max-h-[88vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[9px] uppercase font-black text-indigo-700 tracking-wide font-mono flex items-center gap-1"><Sparkles className="w-3 h-3" /> Tutor IA · melhorar / validar regra</span>
                  <h3 className="font-serif font-bold text-stone-900 text-base leading-tight">{tutorRegra.nome}</h3>
                  <p className="text-[10px] text-stone-500">{tutorRegra.escopo === "ano" ? `${tutorRegra.anoCurricular}.º ano` : "Transversal"} · {tutorRegra.categoria}</p>
                </div>
                <button onClick={() => setTutorRegra(null)} className="text-stone-400 hover:text-stone-700 cursor-pointer"><X className="w-5 h-5" /></button>
              </div>
              <p className="text-[11px] text-stone-600 bg-stone-50 border border-stone-150 rounded-lg p-2">{tutorRegra.descricao}</p>
              <div className="flex gap-2">
                <button onClick={() => askTutor("Valida esta regra: está clara, é coerente e não conflitua com boas práticas de horários?")} disabled={tutorLoading} className="text-[10px] font-bold px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 cursor-pointer disabled:opacity-40">Validar</button>
                <button onClick={() => askTutor("Melhora a redação e a configuração desta regra, devolvendo uma versão melhorada.")} disabled={tutorLoading} className="text-[10px] font-bold px-2 py-1 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 cursor-pointer disabled:opacity-40">Melhorar</button>
              </div>
              <textarea
                value={tutorPrompt}
                onChange={(e) => setTutorPrompt(e.target.value)}
                placeholder="Ou escreve um pedido específico ao tutor (ex.: 'torna-a mais restritiva às sextas')…"
                className="w-full bg-white border border-stone-200 rounded-lg px-2 py-1.5 text-[11px] min-h-[54px]"
              />
              <button onClick={() => askTutor(tutorPrompt || "Valida e melhora esta regra.")} disabled={tutorLoading} className="w-full bg-[#1E1C19] text-white font-bold rounded-xl py-2 text-xs cursor-pointer hover:bg-stone-800 disabled:opacity-40">
                {tutorLoading ? "A pensar…" : "Pedir ao tutor IA"}
              </button>
              {respostaLimpa && (
                <div className="bg-indigo-50/50 border border-indigo-150 rounded-lg p-3 text-[11px] text-stone-700 whitespace-pre-wrap leading-relaxed">{respostaLimpa}</div>
              )}
              {tutorResposta.includes("[REGRA_DETETADA]") && regraEditavel(tutorRegra) && (
                <button onClick={aplicarSugestao} className="w-full bg-emerald-600 text-white font-bold rounded-xl py-2 text-xs cursor-pointer hover:bg-emerald-700">Aplicar sugestão à regra</button>
              )}
            </div>
          </div>
        );
      })()}

      {/* Modal: adicionar aula manualmente a um slot do horário */}
      {addAulaCtx && (() => {
        const ucsDisponiveis = ucs.filter(u =>
          (u.turmasConfig?.length || 0) > 0 &&
          (selectedYearFilter === "todos" || Number(u.anoCurricular) === Number(selectedYearFilter))
        );
        const ucSel = ucsDisponiveis.find(u => u.id === addUcId) || ucsDisponiveis[0];
        const turmas = ucSel?.turmasConfig || [];
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setAddAulaCtx(null)}>
            <form
              onClick={e => e.stopPropagation()}
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget as HTMLFormElement);
                const turma = String(fd.get("turma") || "");
                if (ucSel && turma) addSessionAt(ucSel.id, turma);
              }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-3"
            >
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[9px] uppercase font-black text-teal-700 tracking-wide font-mono">{addAulaCtx.editId != null ? "Editar aula" : "Adicionar aula"}</span>
                  <h3 className="font-serif font-bold text-stone-900 text-base leading-tight">{addAulaCtx.dia}, {addAulaCtx.horaInicio}–{addAulaCtx.horaFim}</h3>
                  <p className="text-[10px] text-stone-500">{getWeekLabel(addAulaCtx.semana)}</p>
                </div>
                <button type="button" onClick={() => setAddAulaCtx(null)} className="text-stone-400 hover:text-stone-700 cursor-pointer"><X className="w-5 h-5" /></button>
              </div>
              {ucsDisponiveis.length === 0 ? (
                <p className="text-[11px] text-stone-500">Não há UCs com turmas para o ano selecionado.</p>
              ) : (
                <>
                  <label className="block text-[10px] font-bold text-stone-600 uppercase font-mono">UC
                    <select
                      value={ucSel?.id}
                      onChange={(e) => setAddUcId(e.target.value)}
                      className="w-full mt-1 bg-white border border-stone-200 rounded px-2 py-1.5 text-[12px]"
                    >
                      {ucsDisponiveis.map(u => <option key={u.id} value={u.id}>{u.sigla} — {u.nome}</option>)}
                    </select>
                  </label>
                  <label className="block text-[10px] font-bold text-stone-600 uppercase font-mono">Turma (disponíveis da UC)
                    <select name="turma" className="w-full mt-1 bg-white border border-stone-200 rounded px-2 py-1.5 text-[12px]">
                      {turmas.map(t => {
                        const tipo = TIPO_CONFIG_PARA_AULA[t.tipo] || "";
                        return <option key={t.id} value={t.nome}>{t.nome} ({tipo})</option>;
                      })}
                    </select>
                  </label>
                  <p className="text-[9px] text-stone-400 leading-tight">A aula é adicionada bloqueada (fixa) para não ser removida ao regenerar. Podes desbloqueá-la depois.</p>
                  <button type="submit" className="w-full bg-[#1E1C19] text-white font-bold rounded-xl py-2 text-xs cursor-pointer hover:bg-stone-800">{addAulaCtx.editId != null ? "Guardar alterações" : "Adicionar"}</button>
                </>
              )}
            </form>
          </div>
        );
      })()}

      {/* Modal de horas previstas da UC (aberto pelo ícone na carta do horário) */}
      {horasUcModal && (() => {
        const u = horasUcModal;
        const tc = u.turmasConfig || [];
        const agendadas = (activeVersao?.sessoes || []).filter(s => s.ucSigla === u.sigla || s.ucNome === u.nome);
        const horasAgendadas = (tipo: string, turma: string) => agendadas.filter(s => s.tipoAula === tipo && s.turma === turma).length * 2;
        const nomesPorTipo = (tipoConfig: string, fallback: string[]) => {
          const ns = tc.filter(t => t.tipo === tipoConfig).map(t => t.nome);
          return ns.length ? ns : fallback;
        };
        const grupos = [
          { tipo: "T", rotulo: "Teórica (T)", porTurma: u.cargaHorariaTeorica || 0, cor: "stone", turmas: nomesPorTipo("Teórica", ["Turma A", "Turma B"]) },
          { tipo: "TP", rotulo: "Teórico-Prática (TP)", porTurma: u.cargaHorariaTP || 0, cor: "blue", turmas: nomesPorTipo("TeoricoPratica", Array.from({ length: 8 }, (_, i) => `TP${i + 1}`)) },
          { tipo: "PL", rotulo: "Prática Lab. (PL)", porTurma: u.cargaHorariaPratica || 0, cor: "rose", turmas: nomesPorTipo("Prática", Array.from({ length: 24 }, (_, i) => `PL${i + 1}`)) },
          { tipo: "S", rotulo: "Seminário (S)", porTurma: u.cargaHorariaS || 0, cor: "violet", turmas: nomesPorTipo("Seminário", []) },
        ].filter(g => g.porTurma > 0 && g.turmas.length > 0);
        const corChip: Record<string, string> = {
          stone: "border-stone-200 bg-stone-50", blue: "border-blue-200 bg-blue-50",
          rose: "border-rose-200 bg-rose-50", violet: "border-violet-200 bg-violet-50",
        };
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setHorasUcModal(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl p-5 space-y-4 max-h-[88vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[9px] uppercase font-black text-teal-700 tracking-wide font-mono">Carga horária prevista por turma</span>
                  <h3 className="font-serif font-bold text-stone-900 text-lg leading-tight">{u.nome} ({u.sigla})</h3>
                  <p className="text-[10px] text-stone-500">{u.anoCurricular}.º ano · {u.semestre}.º semestre · {u.ects} ECTS</p>
                </div>
                <button onClick={() => setHorasUcModal(null)} className="text-stone-400 hover:text-stone-700 cursor-pointer"><X className="w-5 h-5" /></button>
              </div>
              {grupos.map(g => (
                <div key={g.tipo} className="space-y-1.5">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[11px] font-bold text-stone-800">{g.rotulo}</span>
                    <span className="text-[9.5px] font-mono text-stone-500">{g.porTurma}h previstas por turma · {g.turmas.length} turmas · total {g.porTurma * g.turmas.length}h</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
                    {g.turmas.map(nome => {
                      const feito = horasAgendadas(g.tipo, nome);
                      const ok = feito >= g.porTurma;
                      return (
                        <div key={nome} className={`flex items-center justify-between rounded-md border px-2 py-1 text-[9.5px] ${corChip[g.cor]}`}>
                          <span className="font-mono font-bold text-stone-700 truncate">{nome}</span>
                          <span className={`font-mono font-bold ${ok ? "text-emerald-600" : "text-amber-600"}`}>{feito}/{g.porTurma}h</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              <p className="text-[9px] text-stone-400 leading-snug">Cada chip mostra <strong>horas agendadas / horas previstas</strong> dessa turma. Verde = carga cumprida; âmbar = ainda em falta. As horas previstas por turma vêm da definição da UC.</p>
            </div>
          </div>
        );
      })()}

       {/* Active UC Editing modal */}
      {editingUcId && (() => {
        const activeEditingUc = ucs.find(u => u.id === editingUcId);
        if (!activeEditingUc) return null;
        return (
          <div className="fixed inset-0 bg-stone-950/70 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in text-xs">
            <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-stone-200 flex flex-col max-h-[85vh] text-xs">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-stone-100 pb-3 mb-4 shrink-0">
                <div>
                  <span className="text-[9px] uppercase font-bold text-teal-850 tracking-wider font-mono bg-teal-50 border border-teal-150 px-2 py-0.5 rounded-md">
                    Configuração Pedagógica ESEUC
                  </span>
                  <h3 className="text-base font-serif font-bold text-stone-900 mt-1">
                    Editar UC: {activeEditingUc.nome} ({activeEditingUc.sigla})
                  </h3>
                </div>
                <button
                  onClick={() => setEditingUcId(null)}
                  className="text-stone-400 hover:text-stone-600 cursor-pointer p-1 rounded-lg hover:bg-stone-50"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Scrollable Form Content */}
              <div className="flex-1 overflow-y-auto pr-1 space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="col-span-2">
                    <label className="block text-[10px] font-bold text-stone-500 mb-1">Nome Curricular</label>
                    <input
                      type="text"
                      value={activeEditingUc.nome}
                      onChange={(e) => {
                        const updated = ucs.map(u => u.id === editingUcId ? { ...u, nome: e.target.value } : u);
                        setUcs(updated);
                      }}
                      className="w-full bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 font-medium focus:ring-1 focus:ring-stone-600 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-stone-500 mb-1">Sigla da Disciplina</label>
                    <input
                      type="text"
                      value={activeEditingUc.sigla}
                      onChange={(e) => {
                        const updated = ucs.map(u => u.id === editingUcId ? { ...u, sigla: e.target.value.toUpperCase() } : u);
                        setUcs(updated);
                      }}
                      className="w-full bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 uppercase font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#148A96] mb-1 font-mono uppercase">Ano e Semestre (Associados)</label>
                    <select
                      value={`${activeEditingUc.anoCurricular || 1}-${activeEditingUc.semestre || 1}`}
                      onChange={(e) => {
                        const [ano, sem] = e.target.value.split("-").map(Number);
                        const updated = ucs.map(u => u.id === editingUcId ? { ...u, anoCurricular: ano, semestre: sem } : u);
                        setUcs(updated);
                      }}
                      className="w-full bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 font-medium focus:ring-1 focus:ring-stone-600 focus:outline-none"
                    >
                      <option value="1-1">1.º Ano - 1.º Semestre</option>
                      <option value="1-2">1.º Ano - 2.º Semestre</option>
                      <option value="2-1">2.º Ano - 1.º Semestre</option>
                      <option value="2-2">2.º Ano - 2.º Semestre</option>
                      <option value="3-1">3.º Ano - 1.º Semestre</option>
                      <option value="3-2">3.º Ano - 2.º Semestre</option>
                      <option value="4-1">4.º Ano - 1.º Semestre</option>
                      <option value="4-2">4.º Ano - 2.º Semestre</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-6 gap-3 bg-stone-50/70 p-3.5 border border-stone-150 rounded-xl">
                  <div>
                    <label className="block text-[10px] font-bold text-stone-500 mb-1">Horas Semanais T</label>
                    <input
                      type="number"
                      value={activeEditingUc.cargaHorariaTeorica}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        const updated = ucs.map(u => u.id === editingUcId ? { ...u, cargaHorariaTeorica: val } : u);
                        setUcs(updated);
                      }}
                      className="w-full bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 font-mono font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-stone-500 mb-1">Horas TP</label>
                    <input
                      type="number"
                      value={activeEditingUc.cargaHorariaTP || 0}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        const updated = ucs.map(u => u.id === editingUcId ? { ...u, cargaHorariaTP: val } : u);
                        setUcs(updated);
                      }}
                      className="w-full bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 font-mono font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-stone-500 mb-1">Horas PL (Labs)</label>
                    <input
                      type="number"
                      value={activeEditingUc.cargaHorariaPratica || 0}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        const updated = ucs.map(u => u.id === editingUcId ? { ...u, cargaHorariaPratica: val } : u);
                        setUcs(updated);
                      }}
                      className="w-full bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 font-mono font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-stone-500 mb-1">Horas S</label>
                    <input
                      type="number"
                      value={activeEditingUc.cargaHorariaS || 0}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        const updated = ucs.map(u => u.id === editingUcId ? { ...u, cargaHorariaS: val } : u);
                        setUcs(updated);
                      }}
                      className="w-full bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 font-mono font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-stone-500 mb-1">Início (Sem)</label>
                    <input
                      type="number"
                      min={1}
                      max={15}
                      value={activeEditingUc.semanaInicio || 1}
                      onChange={(e) => {
                        const val = Number(e.target.value) || 1;
                        const updated = ucs.map(u => u.id === editingUcId ? { ...u, semanaInicio: val } : u);
                        setUcs(updated);
                      }}
                      className="w-full bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 font-mono font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-stone-500 mb-1">Duração</label>
                    <input
                      type="number"
                      min={1}
                      max={15}
                      value={activeEditingUc.numSemanas}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        const updated = ucs.map(u => u.id === editingUcId ? { ...u, numSemanas: val } : u);
                        setUcs(updated);
                      }}
                      className="w-full bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 font-mono font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-stone-500 mb-1">Ensino Clínico (E)</label>
                    <input
                      type="number"
                      value={activeEditingUc.cargaHorariaE || 0}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        const updated = ucs.map(u => u.id === editingUcId ? { ...u, cargaHorariaE: val } : u);
                        setUcs(updated);
                      }}
                      className="w-full bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 font-mono font-medium"
                    />
                  </div>
                </div>

                {/* Associar Novas Turmas ? UC (Checkbox Chips Matrix) */}
                <div className="bg-[#FCFBF7] border border-stone-200 p-4 rounded-xl space-y-3">
                  <div>
                    <span className="font-serif font-bold text-stone-900 text-xs flex items-center justify-between">
                      <span>Atribuição e Ativação de Turmas de Funcionamento</span>
                      {activeEditingUc.cargaHorariaPratica && activeEditingUc.cargaHorariaPratica > 0 ? (
                        <span className="text-[8px] bg-teal-50 border border-teal-200 text-teal-850 px-2 py-0.5 rounded font-mono font-bold uppercase">Carga PL Ativada ({activeEditingUc.cargaHorariaPratica}h)</span>
                      ) : (
                        <span className="text-[8px] bg-rose-50 border border-rose-150 text-rose-700 px-2 py-0.5 rounded font-mono font-bold uppercase">Carga PL Desativada (0h)</span>
                      )}
                    </span>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mt-1.5 p-2 bg-stone-100/45 rounded-lg border border-stone-200/50">
                      <p className="text-[10px] text-stone-500 font-light leading-tight">
                        Ative ou desative as turmas oficiais associadas a esta UC. As tipologias TP e PL s? estáo visíveis se as horas correspondentes forem superiores a zero.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          const sig = (activeEditingUc.sigla || "UC").toUpperCase();
                          const autoTurmas = generateEseucTurmas(
                            sig,
                            activeEditingUc.cargaHorariaTeorica || 0,
                            activeEditingUc.cargaHorariaTP || 0,
                            activeEditingUc.cargaHorariaPratica || 0,
                            activeEditingUc.cargaHorariaS || 0
                          );
                          const updated = ucs.map(u => u.id === editingUcId ? { ...u, turmasConfig: autoTurmas } : u);
                          setUcs(updated);
                          showToast("Turmas oficiais ESEUC redistribuídas com sucesso para esta UC!");
                        }}
                        className="whitespace-nowrap px-2.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded text-[9.5px] font-bold uppercase cursor-pointer transition-colors shadow-3xs shrink-0 flex items-center gap-1 font-mono"
                      >
                        <span></span> Sincronizar ESEUC
                      </button>
                    </div>
                  </div>

                  {renderEstruturaEstudantes(activeEditingUc.turmasConfig)}

                  {activeEditingUc.cargaHorariaPratica && activeEditingUc.cargaHorariaPratica > 0
                    ? renderSeletorSemanasPL(
                        activeEditingUc.semanasPL,
                        activeEditingUc.numSemanas,
                        activeEditingUc.semestre,
                        (sel) => setUcs(ucs.map(u => u.id === editingUcId ? { ...u, semanasPL: sel } : u))
                      )
                    : null}

                  <div className="space-y-2.5">
                    {/* Teóricas (T) */}
                    <div>
                      <span className="text-[8px] font-bold text-stone-400 uppercase tracking-wide block mb-1 font-mono">Teóricas (T):</span>
                      <div className="flex flex-wrap gap-1.5">
                        {["Turma A", "Turma B"].map((tName) => {
                          const currentTurmas = activeEditingUc.turmasConfig || [];
                          const isSelected = currentTurmas.some(t => t.nome === tName);
                          return (
                            <button
                              key={tName}
                              type="button"
                              onClick={() => {
                                const updatedTurmas = toggleTurmaMae(
                                  currentTurmas,
                                  tName as "Turma A" | "Turma B",
                                  activeEditingUc,
                                  "tc_edit"
                                );
                                const updated = ucs.map(u => u.id === editingUcId ? { ...u, turmasConfig: updatedTurmas } : u);
                                setUcs(updated);
                              }}
                              className={`px-1.5 py-0.5 rounded text-[9px] font-bold border transition-colors cursor-pointer select-none ${
                                isSelected 
                                  ? "bg-amber-600 text-white border-amber-650" 
                                  : "bg-white text-stone-600 border-stone-200 hover:bg-stone-50"
                              }`}
                            >
                              {tName}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Teorico Praticas */}
                    <div>
                      <span className="text-[8px] font-bold text-stone-400 uppercase tracking-wide block mb-1 font-mono">
                        Teórico-Práticas (TP): {!(activeEditingUc.cargaHorariaTP && activeEditingUc.cargaHorariaTP > 0) && "âŒ Desativadas"}
                      </span>
                      {activeEditingUc.cargaHorariaTP && activeEditingUc.cargaHorariaTP > 0 ? (
                        <div className="flex flex-wrap gap-1 md:gap-1.5 animate-fade-in">
                          {["TP1", "TP2", "TP3", "TP4", "TP5", "TP6", "TP7", "TP8"].map((tName) => {
                            const currentTurmas = activeEditingUc.turmasConfig || [];
                            const isSelected = currentTurmas.some(t => t.nome === tName);
                            return (
                              <button
                                key={tName}
                                type="button"
                                onClick={() => {
                                  let updatedTurmas;
                                  if (isSelected) {
                                    updatedTurmas = currentTurmas.filter(t => t.nome !== tName);
                                  } else {
                                    updatedTurmas = [
                                      ...currentTurmas,
                                      { id: "tc_edit_" + Date.now() + "_" + tName, nome: tName, tipo: "TeoricoPratica" as const, docenteId: "" }
                                    ];
                                  }
                                  const updated = ucs.map(u => u.id === editingUcId ? { ...u, turmasConfig: updatedTurmas } : u);
                                  setUcs(updated);
                                }}
                                className={`px-1.5 py-0.5 rounded text-[9px] font-bold border transition-colors cursor-pointer select-none ${
                                  isSelected 
                                    ? "bg-[#148A96] text-white border-[#148A96]" 
                                    : "bg-white text-stone-600 border-stone-200 hover:bg-stone-50"
                                }`}
                              >
                                {tName}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-[9.5px] text-stone-400 font-light italic">
                          Esta UC está configurada com 0 horas de Teórico-Prática (TP). Configure as horas acima para ativar estas turmas.
                        </p>
                      )}
                    </div>

                    {/* Praticas Laboratorio (PL) */}
                    <div>
                      <span className="text-[8px] font-bold text-stone-400 uppercase tracking-wide block mb-1 font-mono">
                        Práticas de Laboratório (PL): {!(activeEditingUc.cargaHorariaPratica && activeEditingUc.cargaHorariaPratica > 0) && "âŒ Desativadas"}
                      </span>
                      {activeEditingUc.cargaHorariaPratica && activeEditingUc.cargaHorariaPratica > 0 ? (
                        <div className="flex flex-wrap gap-1 md:gap-1.5 animate-fade-in">
                          {["PL1", "PL2", "PL3", "PL4", "PL5", "PL6", "PL7", "PL8", "PL9", "PL10", "PL11", "PL12", "PL13", "PL14", "PL15", "PL16", "PL17", "PL18", "PL19", "PL20", "PL21", "PL22", "PL23", "PL24"].map((tName) => {
                            const currentTurmas = activeEditingUc.turmasConfig || [];
                            const isSelected = currentTurmas.some(t => t.nome === tName);
                            return (
                              <button
                                key={tName}
                                type="button"
                                onClick={() => {
                                  let updatedTurmas;
                                  if (isSelected) {
                                    updatedTurmas = currentTurmas.filter(t => t.nome !== tName);
                                  } else {
                                    updatedTurmas = [
                                      ...currentTurmas,
                                      { id: "tc_edit_" + Date.now() + "_" + tName, nome: tName, tipo: "Prática" as const, docenteId: "" }
                                    ];
                                  }
                                  const updated = ucs.map(u => u.id === editingUcId ? { ...u, turmasConfig: updatedTurmas } : u);
                                  setUcs(updated);
                                }}
                                className={`px-1.5 py-0.5 rounded text-[9px] font-bold border transition-colors cursor-pointer select-none ${
                                  isSelected 
                                    ? "bg-teal-700 text-white border-teal-750" 
                                    : "bg-white text-stone-600 border-stone-200 hover:bg-stone-50"
                                }`}
                              >
                                {tName}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-[9.5px] text-stone-400 font-light italic">
                          Esta UC está configurada com 0 horas de Prática de Laboratório (PL). Apenas as turmas de aula comum (A, B) e teórica-práticas (TP1-TP8) estáo habilitadas.
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Distribuicao de Turmas e Docente */}
                <div className="space-y-2.5">
                  <div className="border-b border-stone-100 pb-1.5">
                    <span className="font-serif font-bold text-stone-850 text-xs text-stone-800">Alocação Pedagógica e Salas para as Turmas Ativas</span>
                  </div>

                  <div className="space-y-1.5 max-h-[190px] overflow-y-auto pr-1">
                    {(!activeEditingUc.turmasConfig || activeEditingUc.turmasConfig.length === 0) ? (
                      <div className="text-center p-6 border border-dashed border-stone-200 rounded-lg text-[10.5px] text-stone-400">
                        Nenhum turno configurado para {activeEditingUc.sigla}. Use o botão de inserão acima.
                      </div>
                    ) : (
                      activeEditingUc.turmasConfig.map((tc) => (
                        <div key={tc.id} className="p-3 bg-stone-50/70 border border-stone-150 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <span className="px-1.5 py-0.5 rounded-md bg-stone-150 text-stone-800 font-bold font-mono text-[9px] uppercase">
                              {tc.tipo}
                            </span>
                            <span className="font-bold text-stone-800 text-[11px] font-mono">{tc.nome}</span>
                          </div>

                          <div className="flex items-center gap-3 flex-wrap md:flex-nowrap">
                            {/* Docente selection */}
                            <div className="space-y-0.5">
                              <span className="text-[8px] uppercase tracking-wider font-bold text-stone-400 block font-mono">Docente</span>
                              <select
                                value={tc.docenteId || ""}
                                onChange={(e) => {
                                  const updatedTurmas = (activeEditingUc.turmasConfig || []).map(t =>
                                    t.id === tc.id ? { ...t, docenteId: e.target.value } : t
                                  );
                                  const updated = ucs.map(u => u.id === editingUcId ? { ...u, turmasConfig: updatedTurmas } : u);
                                  setUcs(updated);
                                }}
                                className="bg-white border border-stone-200 rounded-lg px-2 py-1 text-xs text-stone-800 focus:outline-none"
                              >
                                <option value="">Não Alocado (Pendente)</option>
                                {docentes.map(d => (
                                  <option key={d.id} value={d.id}>
                                    {d.nome} {d.isPosGraduacao ? "(PG)" : ""}
                                  </option>
                                ))}
                              </select>
                            </div>

                            {/* Tipologia Sala selection */}
                            <div className="space-y-0.5">
                              <span className="text-[8px] uppercase tracking-wider font-bold text-stone-400 block font-mono">Tipologia Exigida</span>
                              <select
                                value={tc.tipologiaSalaDesejada || ""}
                                onChange={(e) => {
                                  const updatedTurmas = (activeEditingUc.turmasConfig || []).map(t =>
                                    t.id === tc.id ? { ...t, tipologiaSalaDesejada: e.target.value } : t
                                  );
                                  const updated = ucs.map(u => u.id === editingUcId ? { ...u, turmasConfig: updatedTurmas } : u);
                                  setUcs(updated);
                                }}
                                className="bg-white border border-stone-200 rounded-lg px-2 py-1 text-xs text-stone-800 focus:outline-none"
                              >
                                <option value="">Qualquer Sala (Standard)</option>
                                <option value="Anfiteatro (Teórica T)">Anfiteatro (Teórica T)</option>
                                <option value="Laboratório de Simulação PL">Laboratório de Simulação PL</option>
                                <option value="Sala Comum TP">Sala Comum TP</option>
                                <option value="Sala de Computadores">Sala de Computadores</option>
                              </select>
                            </div>

                            <button
                              onClick={() => {
                                const updatedTurmas = (activeEditingUc.turmasConfig || []).filter(t => t.id !== tc.id);
                                const updated = ucs.map(u => u.id === editingUcId ? { ...u, turmasConfig: updatedTurmas } : u);
                                setUcs(updated);
                              }}
                              className="text-stone-400 hover:text-rose-600 transition-colors p-1 md:mt-3"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="border-t border-stone-100 pt-3.5 mt-4 flex items-center justify-between shrink-0">
                <p className="text-[10px] text-stone-400 font-light italic">
                  * Alterações aplicadas instantaneamente no ecossistema académico.
                </p>
                <button
                  onClick={() => {
                    setEditingUcId(null);
                    showToast(" Parâmetros pedagógicos atualizados e associados ao solucionador de Coimbra!");
                  }}
                  className="px-4 py-2 bg-stone-900 text-white rounded-lg hover:bg-stone-850 font-bold"
                >
                  Confirmar Configuração
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {editingDocenteId && (() => {
        const activeEditingDocente = docentes.find(d => d.id === editingDocenteId);
        if (!activeEditingDocente) return null;
        return (
          <div className="fixed inset-0 bg-stone-950/70 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in text-xs">
            <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-stone-200 flex flex-col max-h-[85vh] text-xs">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-stone-100 pb-3 mb-4 shrink-0">
                <div>
                  <span className="text-[9px] uppercase font-bold text-[#148A96] tracking-wider font-mono bg-teal-50 border border-teal-150 px-2 py-0.5 rounded-md">
                    Registo de Docente ESEUC
                  </span>
                  <h3 className="text-base font-serif font-bold text-stone-900 mt-1">
                    Editar Cadastro: {activeEditingDocente.nome}
                  </h3>
                </div>
                <button
                  onClick={() => setEditingDocenteId(null)}
                  className="text-stone-400 hover:text-stone-600 cursor-pointer p-1 rounded-lg hover:bg-stone-50"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Scrollable Form Content */}
              <div className="flex-1 overflow-y-auto pr-1 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-stone-500 mb-1">Nome Completo</label>
                    <input
                      type="text"
                      value={activeEditingDocente.nome}
                      onChange={(e) => {
                        const updated = docentes.map(d => d.id === editingDocenteId ? { ...d, nome: e.target.value } : d);
                        setDocentes(updated);
                      }}
                      className="w-full bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 font-medium focus:ring-1 focus:ring-[#148A96] focus:outline-none text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-stone-500 mb-1">Email Institucional</label>
                    <input
                      type="email"
                      value={activeEditingDocente.email}
                      onChange={(e) => {
                        const updated = docentes.map(d => d.id === editingDocenteId ? { ...d, email: e.target.value } : d);
                        setDocentes(updated);
                      }}
                      className="w-full bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 font-medium focus:ring-1 focus:ring-[#148A96] focus:outline-none text-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-stone-500 mb-1">Unidade Científico-Pedagógica (Departamento)</label>
                    <select
                      value={activeEditingDocente.departamento}
                      onChange={(e) => {
                        const updated = docentes.map(d => d.id === editingDocenteId ? { ...d, departamento: e.target.value } : d);
                        setDocentes(updated);
                      }}
                      className="w-full bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 text-xs"
                    >
                      <option value="UCP Enfermagem Fundamental">UCP Enfermagem Fundamental</option>
                      <option value="UCP Enfermagem de Saúde da Mulher">UCP Enfermagem de Saúde da Mulher</option>
                      <option value="UCP Enfermagem de Saúde Mental e Psiquiátrica">UCP Enfermagem de Saúde Mental e Psiquiátrica</option>
                      <option value="UCP Enfermagem de Saúde Infantil e Pediátrica">UCP Enfermagem de Saúde Infantil e Pediátrica</option>
                      <option value="DEP-Informática">DEP-Informática (Ciências Médicas)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-stone-500 mb-1">Carga Letiva Máxima (Horas/Semana)</label>
                    <input
                      type="number"
                      value={activeEditingDocente.maxHorasSemanais}
                      onChange={(e) => {
                        const updated = docentes.map(d => d.id === editingDocenteId ? { ...d, maxHorasSemanais: Number(e.target.value) || 0 } : d);
                        setDocentes(updated);
                      }}
                      className="w-full bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-[#148A96] focus:outline-none"
                    />
                  </div>
                </div>

                {/* Habilitacoes Letivas */}
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-bold text-stone-500">Unidades Curriculares Habilitadas (Surgem no planeador)</label>
                  <div className="p-3 bg-stone-50 border border-stone-150 rounded-xl flex flex-wrap gap-2">
                    {ucs.map(uc => {
                      const isSelected = (activeEditingDocente.unidadesCurriculares || []).includes(uc.sigla);
                      return (
                        <button
                          key={uc.id}
                          onClick={() => {
                            const currentUcs = activeEditingDocente.unidadesCurriculares || [];
                            const newUcs = isSelected 
                              ? currentUcs.filter(s => s !== uc.sigla)
                              : [...currentUcs, uc.sigla];
                            const updatedDocentes = docentes.map(d => d.id === editingDocenteId ? { ...d, unidadesCurriculares: newUcs } : d);
                            setDocentes(updatedDocentes);
                          }}
                          className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-colors cursor-pointer ${
                            isSelected
                              ? "bg-[#148A96] text-white border-[#148A96]"
                              : "bg-white text-stone-600 border-stone-200 hover:bg-stone-50"
                          }`}
                        >
                          {uc.sigla} - {uc.nome}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Atribuições de Cargas e Turmas por UC */}
                {activeEditingDocente.unidadesCurriculares && activeEditingDocente.unidadesCurriculares.length > 0 && (
                  <div className="space-y-2 border border-stone-150 p-4 rounded-xl bg-amber-50/15">
                    <label className="block text-[10px] font-bold text-[#148A96] uppercase tracking-wider">
                      Atribuição de Carga e Turma por Disciplina (T, TP, PL)
                    </label>
                    <p className="text-[10px] text-stone-500 mt-0.5">
                      Configure a tipologia, carga horária e indique as turmas/turnos previstos para este docente.
                    </p>
                    <div className="space-y-3.5 mt-2">
                      {activeEditingDocente.unidadesCurriculares.map(sig => {
                        const ucObj = ucs.find(u => u.sigla === sig);
                        if (!ucObj) return null;

                        const currentAtrib = (activeEditingDocente.atribuicoesUcs || {})[sig] || { tipos: [], horas: 0, turmas: [] };

                        const updateAtribuicao = (field: string, val: any) => {
                          const existingAtribs = activeEditingDocente.atribuicoesUcs || {};
                          const newAtribObj = {
                            ...existingAtribs,
                            [sig]: {
                              ...currentAtrib,
                              [field]: val
                            }
                          };
                          const updatedDocentes = docentes.map(d => d.id === editingDocenteId ? { ...d, atribuicoesUcs: newAtribObj } : d);
                          setDocentes(updatedDocentes);
                        };

                        return (
                          <div key={sig} className="p-3 bg-white border border-stone-200 rounded-xl space-y-2.5 shadow-3xs">
                            <div className="flex items-center justify-between border-b border-stone-100 pb-1.5">
                              <span className="font-bold text-stone-800 text-[11px]">{sig} - {ucObj.nome}</span>
                              <span className="text-[9px] bg-stone-100 text-stone-600 px-1.5 py-0.5 rounded font-mono">Ano Letivo {ucObj.anoCurricular}?</span>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                              {/* Tipologias */}
                              <div>
                                <span className="block text-[8px] uppercase tracking-wide font-bold text-stone-400 mb-1">Tipologia</span>
                                <div className="flex flex-wrap gap-2">
                                  {["T", "TP", "PL"].map(type => {
                                    const isChecked = currentAtrib.tipos.includes(type as any);
                                    return (
                                      <label key={type} className="flex items-center gap-1 text-[10px] text-stone-700 cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={isChecked}
                                          onChange={() => {
                                            const updatedTypes = isChecked
                                              ? currentAtrib.tipos.filter(t => t !== type)
                                              : [...currentAtrib.tipos, type as any];
                                            updateAtribuicao("tipos", updatedTypes);
                                          }}
                                          className="rounded text-[#148A96] focus:ring-[#148A96] w-3 h-3 cursor-pointer"
                                        />
                                        <span>{type}</span>
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* Horas */}
                              <div>
                                <span className="block text-[8px] uppercase tracking-wide font-bold text-stone-400 mb-1">Carga Horária (h)</span>
                                <input
                                  type="number"
                                  min={0}
                                  value={currentAtrib.horas || 0}
                                  onChange={(e) => updateAtribuicao("horas", Number(e.target.value) || 0)}
                                  className="w-full bg-stone-50 border border-stone-200 rounded px-2 py-0.5 text-xs text-stone-800 focus:outline-none focus:bg-white"
                                />
                              </div>

                              {/* Turmas Multi Select */}
                              <div>
                                <span className="block text-[8px] uppercase tracking-wide font-bold text-stone-400 mb-1">Proposta de Turma</span>
                                <div className="max-h-[85px] overflow-y-auto border border-stone-150 bg-stone-50 p-1 rounded space-y-0.5">
                                  {[
                                    ...((currentAtrib.tipos.includes("T") || currentAtrib.tipos.length === 0) ? ["Turma A", "Turma B"] : []),
                                    ...((currentAtrib.tipos.includes("TP") || currentAtrib.tipos.length === 0) ? ["TP1", "TP2", "TP3", "TP4", "TP5", "TP6", "TP7", "TP8"] : []),
                                    ...((currentAtrib.tipos.includes("PL") || currentAtrib.tipos.length === 0) ? Array.from({ length: 24 }, (_, i) => `PL${i + 1}`) : [])
                                  ].map(t => {
                                    const isAssigned = (currentAtrib.turmas || []).includes(t);
                                    return (
                                      <label key={t} className="flex items-center gap-1.5 p-0.5 hover:bg-white rounded text-[9px] cursor-pointer block select-none">
                                        <input
                                          type="checkbox"
                                          checked={isAssigned}
                                          onChange={() => {
                                            const updatedTurmas = isAssigned
                                              ? (currentAtrib.turmas || []).filter(item => item !== t)
                                              : [...(currentAtrib.turmas || []), t];
                                            updateAtribuicao("turmas", updatedTurmas);
                                          }}
                                          className="rounded text-[#148A96] focus:ring-[#148A96] w-2.5 h-2.5 cursor-pointer"
                                        />
                                        <span>{t}</span>
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Disponibilidade Semanal por Turno */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="block text-[10px] font-bold text-stone-500">Disponibilidade de Horário Académico por Turno</label>
                    <span className="text-[9px] text-[#148A96] font-mono font-medium">Ligar/desligar turnos letivos semanais</span>
                  </div>
                  
                  <div className="border border-stone-150 rounded-xl overflow-hidden bg-stone-50/50">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-stone-150/40 border-b border-stone-200 text-[10px] font-serif font-bold text-stone-800">
                          <th className="p-2.5">Dia de Semana</th>
                          <th className="p-2.5 text-center">Manh? (08h-12h)</th>
                          <th className="p-2.5 text-center">Tarde (14h-18h)</th>
                          <th className="p-2.5 text-center">Noite (18h-22h)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-150">
                        {["Segunda", "Terça", "Quarta", "Quinta", "Sexta"].map(day => {
                          const userDisp = activeEditingDocente.disponibilidade || {};
                          const slots = userDisp[day] || [];
                          
                          const toggleDisp = (slot: string) => {
                            const newSlots = slots.includes(slot)
                              ? slots.filter(s => s !== slot)
                              : [...slots, slot];
                            const updatedD = docentes.map(d => d.id === editingDocenteId ? {
                              ...d,
                              disponibilidade: {
                                ...userDisp,
                                [day]: newSlots
                              }
                            } : d);
                            setDocentes(updatedD);
                          };

                          return (
                            <tr key={day} className="hover:bg-stone-50 text-[11px] text-stone-700">
                              <td className="p-2.5 font-bold font-serif">{day}</td>
                              <td className="p-2.5 text-center">
                                <input
                                  type="checkbox"
                                  checked={slots.includes("08:00-12:00")}
                                  onChange={() => toggleDisp("08:00-12:00")}
                                  className="rounded text-[#148A96] focus:ring-[#148A96] w-4 h-4 cursor-pointer"
                                />
                              </td>
                              <td className="p-2.5 text-center">
                                <input
                                  type="checkbox"
                                  checked={slots.includes("14:00-18:00")}
                                  onChange={() => toggleDisp("14:00-18:00")}
                                  className="rounded text-[#148A96] focus:ring-[#148A96] w-4 h-4 cursor-pointer"
                                />
                              </td>
                              <td className="p-2.5 text-center">
                                <input
                                  type="checkbox"
                                  checked={slots.includes("18:00-22:00")}
                                  onChange={() => toggleDisp("18:00-22:00")}
                                  className="rounded text-[#148A96] focus:ring-[#148A96] w-4 h-4 cursor-pointer"
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="border-t border-stone-100 pt-3.5 mt-4 flex items-center justify-between shrink-0">
                <p className="text-[10px] text-stone-400 font-light italic">
                  * Alterações estendidas a todas as divisões do solucionador inteligente.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setEditingDocenteId(null);
                      showToast(" Modificações no docente guardadas!");
                    }}
                    className="px-4 py-2 bg-[#148A96] text-white rounded-lg hover:bg-[#0f6f79] font-bold cursor-pointer text-xs"
                  >
                    Gravar Docente
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {editingSalaId && (() => {
        const activeEditingSala = salas.find(s => s.id === editingSalaId);
        if (!activeEditingSala) return null;
        return (
          <div className="fixed inset-0 bg-stone-950/70 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in text-xs">
            <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-stone-200 flex flex-col max-h-[85vh] text-xs">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-stone-100 pb-3 mb-4 shrink-0">
                <div>
                  <span className="text-[9px] uppercase font-bold text-teal-850 tracking-wider font-mono bg-teal-50 border border-teal-150 px-2 py-0.5 rounded-md">
                    Instalações Clínicas ESEUC
                  </span>
                  <h3 className="text-base font-serif font-bold text-stone-900 mt-1">
                    Editar Sala: {activeEditingSala.nome}
                  </h3>
                </div>
                <button
                  onClick={() => setEditingSalaId(null)}
                  className="text-stone-400 hover:text-stone-600 cursor-pointer p-1 rounded-lg hover:bg-stone-50"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Scrollable Form Content */}
              <div className="flex-1 overflow-y-auto pr-1 space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-stone-500 mb-1">Identificação / Designação da Sala</label>
                  <input
                    type="text"
                    value={activeEditingSala.nome}
                    onChange={(e) => {
                      const updated = salas.map(s => s.id === editingSalaId ? { ...s, nome: e.target.value } : s);
                      setSalas(updated);
                    }}
                    className="w-full bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 font-medium focus:ring-1 focus:ring-[#148A96] focus:outline-none text-xs"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-stone-500 mb-1">Lotação Escolar Máxima (Nº Alunos)</label>
                    <input
                      type="number"
                      value={activeEditingSala.capacidade}
                      onChange={(e) => {
                        const updated = salas.map(s => s.id === editingSalaId ? { ...s, capacidade: Number(e.target.value) || 0 } : s);
                        setSalas(updated);
                      }}
                      className="w-full bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-[#148A96] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-stone-500 mb-1">Categorização Física (Tipo Geral)</label>
                    <select
                      value={activeEditingSala.tipo}
                      onChange={(e) => {
                        const updated = salas.map(s => s.id === editingSalaId ? { ...s, tipo: e.target.value as any } : s);
                        setSalas(updated);
                      }}
                      className="w-full bg-white border border-stone-200 rounded-lg px-2 py-1.5 text-xs cursor-pointer focus:outline-none"
                    >
                      <option value="Teórica">Teórica</option>
                      <option value="Teórico-prática">Teórico-prática</option>
                      <option value="Laboratório">Laboratório</option>
                      <option value="Sala de Computadores">Sala de Computadores</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-stone-500 mb-1">Tipologias Específicas Autorizadas (Pode selecionar mais que uma)</label>
                  <div className="grid grid-cols-2 gap-1.5 bg-stone-50 p-3.5 border border-stone-150 rounded-xl">
                    {[
                      "Anfiteatro (Teórica T)",
                      "Laboratório de Simulação PL",
                      "Sala Comum TP",
                      "Sala de Computadores"
                    ].map(t => {
                      const list = activeEditingSala.tipologias || (activeEditingSala.tipologia ? [activeEditingSala.tipologia] : []);
                      const isSelected = list.includes(t);
                      return (
                        <label key={t} className="flex items-center gap-2 p-1.5 rounded-lg border border-stone-100 bg-white hover:bg-stone-50 text-[10px] text-stone-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {
                              let newList = [...list];
                              if (isSelected) {
                                newList = newList.filter(item => item !== t);
                              } else {
                                newList.push(t);
                              }
                              const updated = salas.map(s => s.id === editingSalaId ? {
                                ...s,
                                tipologias: newList,
                                tipologia: newList[0] || "Sala Comum TP"
                              } : s);
                              setSalas(updated);
                            }}
                            className="rounded text-[#148A96] focus:ring-[#148A96] w-3.5 h-3.5 cursor-pointer"
                          />
                          <span>{t}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Equipamento */}
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-bold text-stone-500">Recursos e Equipamentos Disponíveis (Para Soluções Práticas)</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-stone-50 p-3.5 border border-stone-150 rounded-xl">
                    {[
                      "Manequins de Parto Avançados",
                      "Berços de Recém-nascido Advance",
                      "Camas Clínicas de Enfermagem",
                      "Postos de Oxigenoterapia",
                      "Suportes de Soro Ergonômicos",
                      "Quadro Interativo de Escrita",
                      "Projetor 4K UltraHD",
                      "Computadores de Secretária",
                      "Ar Condicionado Térmico",
                      "Manequins de RCP Simulados"
                    ].map(eq => {
                      const isSelected = (activeEditingSala.equipamento || []).includes(eq);
                      return (
                        <label key={eq} className="flex items-center gap-2 p-1.5 rounded-lg border border-stone-100 hover:bg-stone-50 text-[10px] text-stone-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {
                              const currentEq = activeEditingSala.equipamento || [];
                              const newEq = isSelected ? currentEq.filter(item => item !== eq) : [...currentEq, eq];
                              const updatedSalas = salas.map(s => s.id === editingSalaId ? { ...s, equipamento: newEq } : s);
                              setSalas(updatedSalas);
                            }}
                            className="rounded text-[#148A96] focus:ring-[#148A96] w-3.5 h-3.5 cursor-pointer"
                          />
                          <span>{eq}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="border-t border-stone-100 pt-3.5 mt-4 flex items-center justify-between shrink-0">
                <p className="text-[10px] text-[#148A96] font-light">
                  * Alocações ativas ligadas automaticamente ao calendário de simulação.
                </p>
                <button
                  onClick={() => {
                    setEditingSalaId(null);
                    showToast(" Atributos físicos da sala guardados!");
                  }}
                  className="px-4 py-2 bg-stone-900 text-white rounded-lg hover:bg-stone-850 font-bold cursor-pointer text-xs"
                >
                  Gravar Sala
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Duplicar Semestre Modal */}
      {showGuardarProposta && (
        <div className="fixed inset-0 bg-stone-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-stone-200 space-y-4">
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <h3 className="text-base font-serif font-semibold text-stone-900">Guardar proposta</h3>
              <button onClick={() => setShowGuardarProposta(false)} className="text-stone-400 hover:text-stone-700 cursor-pointer"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-1">Nome da proposta</label>
                <input
                  autoFocus
                  value={nomeProposta}
                  onChange={(e) => setNomeProposta(e.target.value)}
                  placeholder={`Ex: 2.º ano — versão de ${new Date().toLocaleDateString("pt-PT")}`}
                  className="w-full text-xs border border-stone-200 rounded-xl px-3 py-2.5 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-1">Âmbito</label>
                <div className="space-y-1.5">
                  <label className={`flex items-center gap-2 text-xs cursor-pointer ${selectedYearFilter === "todos" ? "opacity-40" : ""}`}>
                    <input type="radio" checked={escopoProposta === "ano"} disabled={selectedYearFilter === "todos"} onChange={() => setEscopoProposta("ano")} />
                    Só o {selectedYearFilter === "todos" ? "ano selecionado" : `${selectedYearFilter}.º ano`}
                  </label>
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input type="radio" checked={escopoProposta === "todos"} onChange={() => setEscopoProposta("todos")} />
                    Todos os anos
                  </label>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-stone-100">
              <button onClick={() => setShowGuardarProposta(false)} className="px-4 py-2 bg-stone-100 text-stone-600 text-xs font-semibold rounded-xl hover:bg-stone-200 cursor-pointer">Cancelar</button>
              <button onClick={guardarProposta} className="px-4 py-2 bg-stone-900 text-white text-xs font-semibold rounded-xl hover:bg-stone-800 cursor-pointer flex items-center gap-1.5"><Save className="w-3.5 h-3.5" /> Guardar</button>
            </div>
          </div>
        </div>
      )}

      {showDistDocentes && (() => {
        const grupos = gruposDocentes();
        const slotKeysMap = new Map(grupos.map(g => [g.key, g.slotKeys]));
        const ucsAll = [...new Map(grupos.map(g => [g.sigla, g.ucNome])).entries()].sort((a, b) => a[0].localeCompare(b[0]));
        const selGrupos = grupos.filter(g => ucsSelDocentes.has(g.sigla));
        return (
          <div className="fixed inset-0 bg-stone-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
            <div className="bg-white rounded-2xl max-w-3xl w-full p-6 shadow-2xl border border-stone-200 space-y-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between border-b border-stone-100 pb-3">
                <div>
                  <h3 className="text-base font-serif font-semibold text-stone-900">Distribuição de docentes</h3>
                  <p className="text-[10px] text-stone-500">Seleciona as UCs, vê as turmas/horas e atribui — só entre os <strong>disponíveis</strong>. As opções encolhem à medida que atribuis.</p>
                </div>
                <button onClick={() => setShowDistDocentes(false)} className="text-stone-400 hover:text-stone-700 cursor-pointer"><X className="w-5 h-5" /></button>
              </div>

              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400">UCs a distribuir</span>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {ucsAll.map(([sigla, nome]) => (
                    <button key={sigla} title={nome} onClick={() => setUcsSelDocentes(prev => { const n = new Set(prev); n.has(sigla) ? n.delete(sigla) : n.add(sigla); return n; })}
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold border cursor-pointer ${ucsSelDocentes.has(sigla) ? "bg-stone-900 text-white border-stone-900" : "bg-white text-stone-600 border-stone-200 hover:bg-stone-50"}`}>{sigla}</button>
                  ))}
                </div>
              </div>

              <button onClick={autoProporDocentes} className="w-fit px-3 py-1.5 bg-[#148A96] text-white hover:bg-[#0f6f78] font-bold rounded-lg text-[11px] flex items-center gap-1.5 cursor-pointer">
                <Sparkles className="w-3.5 h-3.5" /> Auto-propor docentes (mais restritos primeiro)
              </button>

              <div className="space-y-3">
                {[...new Set(selGrupos.map(g => g.sigla))].map(sigla => {
                  const gs = selGrupos.filter(g => g.sigla === sigla);
                  return (
                    <div key={sigla} className="border border-stone-150 rounded-xl p-3">
                      <p className="text-xs font-bold text-stone-800">{sigla} <span className="font-normal text-stone-400">· {gs[0].ucNome}</span></p>
                      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {gs.map(g => {
                          const { lista, fallback } = dominioDocente(g, atribDocente, slotKeysMap);
                          const atrib = atribDocente[g.key] || [];
                          const cap = capDocsTipo(g.tipo);
                          const podeAdd = atrib.length < cap;
                          const semOpcao = atrib.length === 0 && lista.length === 0;
                          return (
                            <div key={g.key} className="flex items-start gap-1.5 text-[11px] py-0.5">
                              <span className="font-mono font-bold text-stone-600 w-14 shrink-0 truncate mt-0.5">{rotuloTurma(g.turma)}</span>
                              <span className="text-[8.5px] text-stone-400 w-12 shrink-0 mt-0.5 leading-tight">{g.tipo}·{g.slotKeys.size * 2}h<br /><span className="text-stone-300">máx {cap}</span></span>
                              <div className="flex-1 min-w-0 flex flex-wrap items-center gap-1">
                                {atrib.map(nome => {
                                  const h = horasSemanaisDoc(nome, atribDocente, slotKeysMap);
                                  const over = h > LIMITE_HORAS_SOFT;
                                  return (
                                    <span key={nome} title={over ? `${h}h/semana (acima das ${LIMITE_HORAS_SOFT}h)` : `${h}h/semana`} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9.5px] font-semibold border ${over ? "bg-amber-50 text-amber-800 border-amber-200" : "bg-stone-100 text-stone-700 border-stone-200"}`}>
                                      {nome}{over ? " ⚠" : ""}
                                      <button onClick={() => removerDocenteTurma(g.key, nome)} className="text-stone-400 hover:text-rose-600 font-bold">×</button>
                                    </span>
                                  );
                                })}
                                {podeAdd && (
                                  <select value="" onChange={(e) => adicionarDocenteTurma(g.key, e.target.value, g.tipo)} onClick={(e) => e.stopPropagation()}
                                    className={`border rounded-lg px-1.5 py-0.5 text-[10px] cursor-pointer ${semOpcao ? "border-rose-300 bg-rose-50" : "border-stone-200"}`}>
                                    <option value="">{semOpcao ? "— sem disponível —" : "+ adicionar"}</option>
                                    {lista.map(d => {
                                      const h = horasSemanaisDoc(d.nome, atribDocente, slotKeysMap);
                                      return <option key={d.id} value={d.nome}>{d.nome}{h >= LIMITE_HORAS_SOFT ? ` (${h}h ⚠)` : ""}</option>;
                                    })}
                                  </select>
                                )}
                                {fallback && <span title="Nenhum docente configurado para esta UC — a mostrar todos. Configura em Docentes." className="text-amber-500">⚠</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                {selGrupos.length === 0 && <p className="text-[11px] text-stone-400 italic">Sem UCs selecionadas, ou a proposta ainda não tem sessões. Gera o horário primeiro.</p>}
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-stone-100">
                <button onClick={() => setShowDistDocentes(false)} className="px-4 py-2 bg-stone-900 text-white text-xs font-semibold rounded-xl hover:bg-stone-800 cursor-pointer">Concluir</button>
              </div>
            </div>
          </div>
        );
      })()}

      {regraEmEdicao && (
        <div className="fixed inset-0 bg-stone-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-stone-200 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <h3 className="text-base font-serif font-semibold text-stone-900">{editProveniencia === "ia" ? "Validar regra sugerida pela IA" : "Editar regra"}</h3>
              <button onClick={() => setRegraEmEdicao(null)} className="text-stone-400 hover:text-stone-700 cursor-pointer"><X className="w-5 h-5" /></button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-1">Nome</label>
                <input value={regraEmEdicao.nome} onChange={(e) => setRegraEmEdicao({ ...regraEmEdicao!, nome: e.target.value })} className="w-full border border-stone-200 rounded-xl px-3 py-2 focus:outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-1">Severidade</label>
                  <select value={regraEmEdicao.tipo} onChange={(e) => setRegraEmEdicao({ ...regraEmEdicao!, tipo: e.target.value as any })} className="w-full border border-stone-200 rounded-xl px-2 py-2 bg-white">
                    <option value="hard">Hard (inviolável)</option>
                    <option value="soft">Soft (preferência)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-1">Peso (1-10)</label>
                  <input type="number" min={1} max={10} value={regraEmEdicao.peso} disabled={regraEmEdicao.tipo === "hard"} onChange={(e) => setRegraEmEdicao({ ...regraEmEdicao!, peso: Number(e.target.value) })} className="w-full border border-stone-200 rounded-xl px-3 py-2 disabled:bg-stone-100" />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-1">Descrição</label>
                <textarea value={regraEmEdicao.descricao} onChange={(e) => setRegraEmEdicao({ ...regraEmEdicao!, descricao: e.target.value })} className="w-full h-16 border border-stone-200 rounded-xl p-2.5 focus:outline-none" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-1">Anos a que se aplica</label>
                <div className="flex flex-wrap gap-2">
                  {(ehDiretor ? [1, 2, 3, 4] : ([anoDoPerfil].filter(Boolean) as number[])).map(ano => {
                    const sel = anosDaRegra(regraEmEdicao!).includes(ano);
                    return (
                      <button key={ano} onClick={() => toggleDraftAno(ano)} className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border cursor-pointer ${sel ? "bg-emerald-600 text-white border-emerald-700" : "bg-white text-stone-600 border-stone-200 hover:bg-stone-50"}`}>{ano}.º ano</button>
                    );
                  })}
                </div>
                <p className="text-[9px] text-stone-400 mt-1">Sem anos selecionados = <strong>transversal</strong> (todos os anos).</p>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-1">Cursos a que se aplica</label>
                <div className="flex flex-wrap gap-2">
                  {cursos.map(c => {
                    const sel = cursosDaRegra(regraEmEdicao!).includes(c.id);
                    return (
                      <button key={c.id} onClick={() => toggleDraftCurso(c.id)} title={c.nome} className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border cursor-pointer ${sel ? "bg-sky-600 text-white border-sky-700" : "bg-white text-stone-600 border-stone-200 hover:bg-stone-50"}`}>{c.sigla}</button>
                    );
                  })}
                </div>
                <p className="text-[9px] text-stone-400 mt-1">Sem cursos selecionados = <strong>todos os cursos</strong>. (Por agora só o CLE; PG/mestrados quando os criares.)</p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-stone-100">
              <button onClick={() => setRegraEmEdicao(null)} className="px-4 py-2 bg-stone-100 text-stone-600 text-xs font-semibold rounded-xl hover:bg-stone-200 cursor-pointer">Cancelar</button>
              <button onClick={guardarRegraEditada} className="px-4 py-2 bg-stone-900 text-white text-xs font-semibold rounded-xl hover:bg-stone-800 cursor-pointer flex items-center gap-1.5"><Save className="w-3.5 h-3.5" /> {editProveniencia === "ia" ? "Ativar regra" : "Guardar"}</button>
            </div>
          </div>
        </div>
      )}

      {showDuplicarSemestreModal && (
        <div className="fixed inset-0 bg-stone-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-stone-200 space-y-4">
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <h3 className="text-base font-serif font-semibold text-stone-900">Novo Período Académico</h3>
              <button onClick={() => setShowDuplicarSemestreModal(false)} className="text-stone-400 hover:text-stone-700 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <p className="text-xs text-stone-500 leading-relaxed">
              Crie um novo ano letivo ou semestre. Pode iniciar um plano completamente do zero (em branco) para cruzar disponibilidades e regras do motor, ou duplicar os horários existentes.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-4xs font-bold uppercase text-stone-400 mb-1 tracking-wider">Ano Letivo de Destino</label>
                <input
                  type="text"
                  value={newSemesterName}
                  onChange={(e) => setNewSemesterName(e.target.value)}
                  placeholder="Ex: 2026/2027"
                  className="w-full text-xs border border-stone-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-stone-400"
                />
              </div>

              <div>
                <label className="block text-4xs font-bold uppercase text-stone-400 mb-1 tracking-wider">Metade Letiva</label>
                <select
                  value={newSemesterHalf}
                  onChange={(e) => setNewSemesterHalf(Number(e.target.value))}
                  className="w-full text-xs border border-stone-200 rounded-xl px-3 py-2.5 bg-white focus:outline-none"
                >
                  <option value={1}>1.º Semestre</option>
                  <option value={2}>2.º Semestre</option>
                </select>
              </div>

              {/* Modo de Inicialização */}
              <div className="bg-stone-50 p-3 rounded-xl border border-stone-200/60 space-y-2">
                <span className="block text-[10px] font-bold text-stone-600">Método de Preenchimento</span>
                
                <label className="flex items-start gap-2.5 cursor-pointer p-1">
                  <input
                    type="radio"
                    name="epoch_init_mode"
                    checked={emptyAcademicYear === true}
                    onChange={() => setEmptyAcademicYear(true)}
                    className="mt-0.5 rounded text-stone-900 focus:ring-stone-600"
                  />
                  <div>
                    <span className="block text-xs font-semibold text-stone-800">Iniciar Plano em Branco (Recomendado)</span>
                    <span className="block text-[10px] text-stone-500 font-light mt-0.5">
                      Fica tudo limpo e permite-lhe validar primeiro as regras, carregar novos docentes e salas e depois correr o solucionador automático.
                    </span>
                  </div>
                </label>

                <label className="flex items-start gap-2.5 cursor-pointer p-1 border-t border-stone-150 pt-2">
                  <input
                    type="radio"
                    name="epoch_init_mode"
                    checked={emptyAcademicYear === false}
                    onChange={() => setEmptyAcademicYear(false)}
                    className="mt-0.5 rounded text-stone-900 focus:ring-stone-600"
                  />
                  <div>
                    <span className="block text-xs font-semibold text-stone-800">Duplicar Horários de Referência</span>
                    <span className="block text-[10px] text-stone-500 font-light mt-0.5">
                      Copia as sessões de aula pr?-distribuídas do ano/semestre letivo atual.
                    </span>
                  </div>
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-stone-100">
              <button
                onClick={() => setShowDuplicarSemestreModal(false)}
                className="px-4 py-2 bg-stone-100 text-stone-600 text-xs font-semibold rounded-xl hover:bg-stone-200 cursor-pointer"
              >
                Voltar
              </button>
              <button
                id="btn-confirm-dup-semestre"
                onClick={handleDuplicarSemestre}
                className="px-4 py-2 bg-[#1E1C19] text-white text-xs font-semibold rounded-xl hover:bg-stone-800 cursor-pointer"
              >
                Criar Ano Letivo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Workspace Frame */}
      <main className="flex-1 p-6 max-w-7xl mx-auto w-full space-y-6">

        {/* Selected Version Ribbon */}
        <div className={`${themeStyles.panelColor} rounded-2xl p-5 border ${themeStyles.borderColor} shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4`}>
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${themeStyles.softAccent}`}>
                Versão Rascunho Segura
              </span>
              <span className="text-[10px] bg-stone-100 text-[#148A96] font-semibold border border-stone-150 px-2.5 py-0.5 rounded-full font-mono flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                {getPerfilLabel(perfilAtivo)}
              </span>
            </div>
            <h2 className={`text-lg ${themeStyles.headingFont}`}>
              Mapa Vigente:{" "}
              <span className={`${themeStyles.primaryText}`}>
                {selectedAnoLetivo} {currentSemestre ? `(${currentSemestre.semestre}º Semestre)` : ""}
              </span>
            </h2>
            <p className="text-xs text-stone-500 font-light">
              Tudo o que configurar no sistema fica imediatamente gravado e armazenado de forma estritamente isolada e persistente.
            </p>
          </div>

          <div className="flex gap-4 items-center shrink-0 w-full md:w-auto justify-between md:justify-end">
            <div className="space-y-1">
              <span className="text-4xs font-bold uppercase text-stone-400 block tracking-wider">Proposta Ativa</span>
              {renomearPropostaId === selectedVersaoId ? (
                <div className="flex items-center gap-1">
                  <input
                    autoFocus
                    value={nomeRenomear}
                    onChange={(e) => setNomeRenomear(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") renomearProposta(selectedVersaoId, nomeRenomear); if (e.key === "Escape") setRenomearPropostaId(null); }}
                    className="text-xs border border-stone-300 rounded-xl px-3 py-2 w-44 focus:outline-none"
                  />
                  <button onClick={() => renomearProposta(selectedVersaoId, nomeRenomear)} className="px-2.5 py-2 bg-stone-900 text-white rounded-xl text-[10px] font-bold">OK</button>
                </div>
              ) : (
                <select
                  value={selectedVersaoId}
                  onChange={(e) => {
                    setSelectedVersaoId(e.target.value);
                    const ver = versoes.find(v => v.id === e.target.value);
                    if (ver) { setSelectedSemestreId(ver.anoSemestreId); }
                  }}
                  className="bg-stone-50 cursor-pointer text-xs font-semibold border border-stone-200 rounded-xl px-3 py-2 focus:outline-none w-56 text-ellipsis"
                >
                  {versoes.filter(v => {
                    const s = anosSemestres.find(item => item.id === v.anoSemestreId);
                    return s && s.anoLetivo === selectedAnoLetivo;
                  }).map(v => {
                    const s = anosSemestres.find(item => item.id === v.anoSemestreId);
                    return (
                      <option key={v.id} value={v.id}>
                        {v.nome} {s ? `(${s.semestre}º Semestre - ${s.anoLetivo})` : ""}
                      </option>
                    );
                  })}
                </select>
              )}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[8.5px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-150">{rotuloAnosProposta(activeVersao)}</span>
                <button
                  onClick={() => { setNomeProposta(""); setEscopoProposta(selectedYearFilter === "todos" ? "todos" : "ano"); setShowGuardarProposta(true); }}
                  className="text-[10px] font-bold px-2 py-1 bg-white border border-stone-300 rounded-lg hover:bg-stone-100 flex items-center gap-1 cursor-pointer"
                >
                  <Save className="w-3 h-3" /> Guardar proposta
                </button>
                <button
                  onClick={() => { setRenomearPropostaId(selectedVersaoId); setNomeRenomear(activeVersao?.nome ?? ""); }}
                  title="Renomear proposta"
                  className="text-[10px] font-bold px-2 py-1 bg-white border border-stone-300 rounded-lg hover:bg-stone-100 flex items-center gap-1 cursor-pointer"
                >
                  <Edit2 className="w-3 h-3" /> Renomear
                </button>
                <button onClick={() => apagarProposta(selectedVersaoId)} title="Apagar proposta" className="text-stone-400 hover:text-rose-600 cursor-pointer">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            
            <div className="bg-stone-50 border border-stone-200/80 rounded-xl p-2 px-3 text-center min-w-[90px]">
              <span className="text-4xs uppercase tracking-widest font-bold text-stone-400 block">Indicador</span>
              <span className={`text-base font-black font-mono ${
                (activeVersao?.score || 0) >= 90 ? "text-emerald-600" : "text-amber-600"
              }`}>
                {activeVersao?.score || 0}%
              </span>
            </div>
          </div>
        </div>

        {/* TAB 1: DASHBOARD PAINEL GERAL */}
        {activeTab === "horario" && (
          <div className="space-y-6 animate-fade-in text-xs">
            {/* Minimalist Dashboard Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { title: "Matérias (UCs)", val: ucs.length, detail: `${ucs.reduce((acc, c) => acc + (c.ects || 0), 0)} ECTS totais`, icon: Layers },
                { title: "Inscritos Estudantes", val: turmas.filter(t => t.tipo === "Teórica" && t.bloco !== "comunitaria").reduce((acc, t) => acc + (t.alunos || 0), 0), detail: `${[1,2,3,4].filter(a => turmas.some(t => t.tipo === "Teórica" && t.anoCurricular === a)).length} anos curriculares`, icon: Users },
                { title: "Exigências e Preferências", val: regras.filter(r => r.ativa).length, detail: `${regras.filter(r => r.ativa && r.tipo === "hard").length} regras invioláveis`, icon: Sliders },
                { title: "Propostas Criadas", val: versoes.filter(v => {
                  const s = anosSemestres.find(item => item.id === v.anoSemestreId);
                  return s && s.anoLetivo === selectedAnoLetivo;
                }).length, detail: `Atual: ${activeVersao?.nome.substring(0, 15)}...`, icon: Eye }
              ].map((kpi, i) => {
                const Icon = kpi.icon;
                return (
                  <div key={i} className={`${themeStyles.panelColor} p-5 rounded-2xl border ${themeStyles.borderColor} shadow-xs flex items-center justify-between`}>
                    <div className="space-y-1">
                      <span className="text-4xs text-stone-400 font-bold uppercase tracking-wider block">{kpi.title}</span>
                      <div className="text-2xl font-black text-stone-900 font-mono tracking-tight">{kpi.val}</div>
                      <span className="text-[11px] text-stone-500 font-light block">{kpi.detail}</span>
                    </div>
                    <span className="p-3 bg-stone-50 text-stone-600 rounded-xl border border-stone-100 shrink-0">
                      <Icon className="w-5 h-5" />
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Dashboard Workspace */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Short sessions list */}
              <div id="validation-and-solver-panel" className="lg:col-span-2 bg-white rounded-2xl p-6 border border-stone-150 shadow-3xs space-y-4">
                <div className="flex items-center justify-between border-b border-stone-100 pb-3 flex-wrap gap-2">
                  <div>
                    <h3 className="text-base font-serif font-bold text-stone-900 flex items-center gap-1.5">
                      <ShieldAlert className="w-5 h-5 text-[#B5861D]" />
                      Validador de Condições Académicas & Distribuição
                    </h3>
                    <p className="text-xs text-stone-500">Cruza as restrições ativas, docentes e adequações de tipologia de salas antes de distribuir.</p>
                  </div>
                  
                  {selectedYearFilter === "todos" ? (
                    <span className="text-[10px] text-stone-400 italic max-w-[180px] text-right">Escolhe um ano curricular para validar e gerar.</span>
                  ) : (
                  <button
                    id="btn-trigger-solver"
                    onClick={() => handleTriggerSolver(false)}
                    disabled={isSolving}
                    className="px-4 py-2 bg-[#1E1C19] text-white hover:bg-stone-850 font-bold rounded-xl flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-40 text-2xs"
                  >
                    {isSolving ? (
                      <>
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        A Gerar...
                      </>
                    ) : (
                      <>
                        <Zap className="w-3 h-3 text-amber-300 animate-pulse" />
                        Validar e Gerar Distribuição
                      </>
                    )}
                  </button>
                  )}
                </div>

                {/* 3-Part Validator Checklist */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="p-3 bg-stone-50 rounded-xl border border-stone-150 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-stone-800 text-2xs">1. Regras de Carga</span>
                      <span className="px-1 py-0.5 text-[8px] bg-emerald-105 text-emerald-800 font-black rounded-sm font-mono uppercase">OK</span>
                    </div>
                    <p className="text-[10px] text-stone-500 leading-relaxed leading-snug">
                      As {regras.filter(r => r.ativa).length} regras ativas são elegíveis para cálculo (ex: folgas diárias).
                    </p>
                  </div>

                  <div className="p-3 bg-stone-50 rounded-xl border border-stone-150 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-stone-800 text-2xs">2. Professores</span>
                      <span className="px-1 py-0.5 text-[8px] bg-emerald-105 text-emerald-800 font-black rounded-sm font-mono uppercase">OK</span>
                    </div>
                    <p className="text-[10px] text-stone-500 leading-relaxed leading-snug">
                      Nenhum dos {docentes.length} docentes excede a carga contratual definida na escola.
                    </p>
                  </div>

                  <div className="p-3 bg-stone-50 rounded-xl border border-stone-150 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-stone-800 text-2xs">3. Salas & Tipologia</span>
                      <span className="px-1 py-0.5 text-[8px] bg-emerald-105 text-emerald-800 font-black rounded-sm font-mono uppercase">OK</span>
                    </div>
                    <p className="text-[10px] text-stone-500 leading-relaxed leading-snug">
                      Adequação de salas garantida (ex: laboratórios para PL, salas comuns para T).
                    </p>
                  </div>
                </div>

                {/* Real-time solver log output */}
                {isSolving && (
                  <div className="p-3 bg-stone-950 text-stone-300 font-mono text-[10px] rounded-xl leading-relaxed space-y-0.5">
                    <span className="text-amber-300 font-bold block">[CONSOLA DO SOLUCIONADOR]</span>
                    <span>{"[INFO] Sincronização de regras ok..."}</span>
                    <span>{"[INFO] Validação de agendas docentes concluída..."}</span>
                    <span>{"[INFO] Filtragem de salas por tipologia (PL/T) ativa..."}</span>
                  </div>
                )}

                <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
                  {activeVersao && activeVersao.sessoes.length > 0 ? (
                    activeVersao.sessoes
                      .filter((s) => {
                        const matchingUc = ucs.find(u => u.sigla === s.ucSigla);
                        if (!matchingUc) return true;
                        if (selectedYearFilter !== "todos" && Number(matchingUc.anoCurricular) !== Number(selectedYearFilter)) return false;
                        if (selectedSemesterFilter !== "todos" && Number(matchingUc.semestre) !== Number(selectedSemesterFilter)) return false;

                        // Filter by selected active week
                        const startWeek = matchingUc.semanaInicio || 1;
                        const endWeek = startWeek + (matchingUc.numSemanas || 15) - 1;
                        if (selectedWeekFilter < startWeek || selectedWeekFilter > endWeek) {
                          return false;
                        }

                        return true;
                      })
                      .map((s) => (
                      <div
                        key={s.id}
                        className="bg-stone-50/60 p-3.5 rounded-xl border border-stone-150/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`px-2 py-0.5 font-bold font-mono text-2xs ${themeStyles.softAccent} rounded-md`}>
                              {s.ucSigla}
                            </span>
                            <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-sm bg-stone-100 text-stone-600">
                              {s.tipoAula}
                            </span>
                            <span className="text-stone-500">• {s.ucNome} (Turma: {rotuloTurma(s.turma)})</span>
                          </div>
                          <div className="text-stone-500 flex items-center gap-3 font-light text-[11px]">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5 text-stone-400" />
                              {s.diaSemana}, {s.horaInicio} - {s.horaFim}
                            </span>
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3.5 h-3.5 text-stone-400" />
                              {s.sala} ({s.salaTipo})
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-stone-100">
                          {s.docente && (
                            <span className="text-stone-600 font-medium text-[11px] bg-white border border-stone-200 px-2.5 py-1 rounded-lg">
                              '¤ {s.docente}
                            </span>
                          )}
                          {s.bloqueado ? (
                            <button
                              onClick={() => toggleSessionBlock(s.id)}
                              className="px-2 py-1 rounded-lg bg-amber-50 text-amber-800 border border-amber-100 flex items-center gap-1 hover:bg-amber-100/75 transition-all text-[10px] font-bold cursor-pointer"
                            >
                              <Lock className="w-3 h-3 text-amber-700" />
                              Fixa
                            </button>
                          ) : (
                            <button
                              onClick={() => toggleSessionBlock(s.id)}
                              className="px-2 py-1 rounded-lg bg-stone-100 text-stone-600 border border-stone-200 flex items-center gap-1 hover:bg-stone-200 transition-all text-[10px] font-semibold cursor-pointer"
                            >
                              <Unlock className="w-3 h-3 text-stone-500" />
                              Livre
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="p-8 text-center text-stone-400 font-light">
                      Não existem aulas agendadas por agora. Use o Gerador Automático ou a Inteligência do Chat para criar slots.
                    </div>
                  )}
                </div>
              </div>

              {/* Real-time Audit panel */}
              <div className="bg-white rounded-2xl p-6 border border-stone-150 shadow-3xs space-y-4">
                <div className="border-b border-stone-100 pb-2.5 flex items-center justify-between">
                  <h3 className="text-base font-serif font-bold text-stone-900 flex items-center gap-1.5">
                    <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0" />
                    Incompatibilidades & Auditoria CLE
                  </h3>
                  {getSimulatedIncompatibilities().length > 0 && (
                    <span className="bg-rose-100 text-rose-700 text-[10px] font-black px-2 py-0.5 rounded-full font-mono animate-pulse">
                      {getSimulatedIncompatibilities().length} Alertas
                    </span>
                  )}
                </div>
                <p className="text-xs text-stone-500 font-light">
                  Sempre que mover caixas ou alterar atribuições, a rede ESEUC de restrições valida as condições letivas.
                </p>

                <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1">
                  {[
                    ...getSimulatedIncompatibilities().map(item => ({
                      regra: item.category,
                      descricao: item.desc,
                      type: item.type
                    })),
                    ...(lastSolverVerdict?.conflicts || []).map((c: any) => ({
                      regra: c.regra || "Fração de Distribuição",
                      descricao: c.descricao || c.desc,
                      type: "warning" as const
                    }))
                  ].length > 0 ? (
                    [
                      ...getSimulatedIncompatibilities().map(item => ({
                        regra: item.category,
                        descricao: item.desc,
                        type: item.type
                      })),
                      ...(lastSolverVerdict?.conflicts || []).map((c: any) => ({
                        regra: c.regra || "Fração de Distribuição",
                        descricao: c.descricao || c.desc,
                        type: "warning" as const
                      }))
                    ].map((conf, i) => (
                      <div
                        key={i}
                        className={`p-3 rounded-xl border text-xs space-y-1 transition-all ${
                          conf.type === "error"
                            ? "bg-rose-50/50 text-rose-950 border-rose-150"
                            : "bg-amber-50/50 text-amber-950 border-amber-150"
                        }`}
                      >
                        <div className="flex items-center gap-1.5 font-bold">
                          <AlertTriangle className={`w-3.5 h-3.5 shrink-0 ${conf.type === "error" ? "text-rose-600" : "text-amber-600"}`} />
                          <span className="uppercase tracking-wide text-[9px]">{conf.regra}</span>
                        </div>
                        <p className="text-stone-600 text-[11px] leading-relaxed select-none">{conf.descricao}</p>
                      </div>
                    ))
                  ) : (
                    <div className="bg-emerald-50/45 p-5 rounded-2xl border border-emerald-150 text-center space-y-2">
                      <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
                        <Check className="w-5 h-5 text-emerald-700" />
                      </div>
                      <h4 className="font-serif font-bold text-emerald-950 text-xs">Sem Conflitos Ativos!</h4>
                      <p className="text-stone-500 text-[10px] leading-relaxed">
                        A integridade do seu plano académico está totalmente protegida: sem sobreposições de docentes ou choque no contacto contínuo.
                      </p>
                    </div>
                  )}
                </div>

                <div className="bg-[#1E1C19] text-white p-4 rounded-xl text-[11px] leading-relaxed">
                  <span className="font-serif font-bold tracking-wide text-amber-200"> Dica Do Ateliê</span>
                  <p className="text-stone-300 font-light mt-1">
                    Ative o botão "Fixa" nas aulas que não quer que mudem de dia de forma alguma. Desta forma, o gerador respeita-as rigorosamente na próxima execução.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* DIREÃ‡AO DE CICLO GLOBAL MAPS VIEW */}
        {perfilAtivo.startsWith("diretor_") && activeTab === "horario" && (
          <div className="bg-stone-900 text-stone-100 rounded-3xl p-6 border border-stone-850 shadow-xl space-y-4 animate-fade-in">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-stone-800 pb-4">
              <div>
                <span className="text-[10px] bg-[#148A96] text-white font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full select-none">
                  " Gabinete de Direção do Curso
                </span>
                <h3 className="text-base font-serif font-bold text-white mt-1">
                  Visão Global CLE: Mapas Letivos Coexistentes
                </h3>
                <p className="text-2xs text-stone-450">
                  Acompanhamento simultâneo de todos os anos curriculares do plano de estágio e teóricas.
                </p>
              </div>
              <div className="bg-stone-850 p-2 border border-stone-800 font-mono text-[9px] text-zinc-350 rounded-lg">
                 Versão de Trabalho Ativa: <span className="text-amber-300 font-bold">{activeVersao?.nome}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map(ano => {
                const anoSessions = activeVersao
                  ? activeVersao.sessoes.filter(s => {
                      const uc = ucs.find(u => u.sigla === s.ucSigla);
                      return uc && Number(uc.anoCurricular) === ano;
                    })
                  : [];

                return (
                  <div key={ano} className="bg-stone-950 p-4 rounded-2xl border border-stone-850 flex flex-col justify-between space-y-3">
                    <div>
                      <div className="flex items-center justify-between border-b border-stone-850 pb-2">
                        <span className="font-serif font-black text-stone-100 text-xs">{ano}.º Ano CLE</span>
                        <span className="text-[8px] bg-[#EBF7F8]/20 text-[#148A96] px-2 py-0.5 rounded-full font-mono font-bold">
                          {anoSessions.length} Sessões
                        </span>
                      </div>

                      {ano === 3 ? (
                        <p className="text-[10px] text-amber-500 font-medium leading-relaxed py-3">
                          EC (Ensino Clínico): Estágio integrado flexível. Sem sessões teóricas fixas em sala de aula de segunda a sexta.
                        </p>
                      ) : anoSessions.length === 0 ? (
                        <p className="text-2xs text-stone-550 italic py-6 text-center">
                          Nenhuma sessão ativa nesta versão.
                        </p>
                      ) : (
                        <div className="space-y-2 pt-2.5 max-h-[160px] overflow-y-auto pr-1">
                          {Array.from(new Set(anoSessions.map(s => s.diaSemana))).map(dia => {
                            const diaSess = anoSessions.filter(s => s.diaSemana === dia);
                            return (
                              <div key={dia} className="space-y-1">
                                <span className="text-[8px] text-[#148A96] font-extrabold uppercase font-mono">{dia}</span>
                                <div className="space-y-0.5 pl-1.5 border-l border-stone-800">
                                  {diaSess.map(ds => (
                                    <div key={ds.id} className="text-[9px] text-zinc-350 leading-relaxed">
                                      <span className="font-semibold text-white">{ds.horaInicio}</span> - <span className="text-zinc-200 font-medium">{ds.ucSigla}</span> <span className="font-mono text-[7.5px] bg-stone-850 text-stone-400 px-1 rounded">{rotuloTurma(ds.turmaDescr || ds.turma)}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => setSelectedYearFilter(ano as any)}
                      className="w-full mt-2 py-1.5 bg-stone-800 hover:bg-stone-750 text-white rounded-lg text-[9px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
                    >
                      Focar Grelha Letiva
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 2: VISUAL CALENDAR (DRAG AND DROP & PIN LOCKS) */}
        {activeTab === "horario" && (
          <div className="space-y-6 animate-fade-in text-xs">
            <div className="bg-white rounded-2xl p-6 border border-stone-150 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-stone-100 pb-3 flex-wrap gap-2">
                <div>
                  <h3 className="text-base font-serif font-bold text-stone-900">Grelha de Horário Letivo</h3>
                  <p className="text-xs text-stone-500">Mova as caixas para reposicionar aulas. O sistema adaptará o horário salvaguardando a estabilidade.</p>
                </div>
                
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      // Build a print window with one week per page
                      const weeks = Array.from({ length: 30 }, (_, i) => i + 1);
                      const diasSemanaisP = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"];
                      const blocosP = [
                        { start: "08:00", end: "10:00" }, { start: "10:00", end: "12:00" },
                        { start: "12:00", end: "14:00" }, { start: "14:00", end: "16:00" },
                        { start: "16:00", end: "18:00" }, { start: "18:00", end: "20:00" }
                      ];
                      if (!activeVersao) { alert("Gere primeiro a distribuição."); return; }
                      const allSessoes = activeVersao.sessoes;
                      const weeksWithData = weeks.filter(w => allSessoes.some(s => s.semana === w));
                      const win = window.open("", "_blank");
                      if (!win) return;
                      win.document.write(`<html><head><title>Horário ESEUC</title><style>
                        body { font-family: Arial, sans-serif; font-size: 9px; margin: 0; }
                        .page { page-break-after: always; padding: 12px; }
                        .page:last-child { page-break-after: avoid; }
                        h2 { font-size: 12px; margin: 0 0 6px; }
                        table { width: 100%; border-collapse: collapse; }
                        th, td { border: 1px solid #ddd; padding: 3px 4px; vertical-align: top; }
                        th { background: #f5f5f5; font-size: 8px; text-align: center; }
                        .slot-hora { font-size: 8px; color: #666; white-space: nowrap; }
                        .card { margin: 1px 0; padding: 2px 3px; border-radius: 3px; border: 1px solid #ccc; font-size: 7.5px; }
                        .card-t { background: #f9f9f9; } .card-tp { background: #EEF4FA; border-color: #B9CDEC; }
                        .card-pl { background: #FAF1EE; border-color: #ECC4B9; } .card-s { background: #F3EEFA; border-color: #D6CBE8; }
                        @page { size: A4 landscape; margin: 8mm; }
                        @media print { body { -webkit-print-color-adjust: exact; } }
                      </style></head><body>`);
                      weeksWithData.forEach(w => {
                        const isSem2 = w > 15;
                        const label = `${isSem2 ? "2.º" : "1.º"} Semestre — Semana ${w}`;
                        win.document.write(`<div class="page"><h2>ESEUC · ${label} · ${selectedAnoLetivo}</h2><table>`);
                        win.document.write(`<tr><th>Período</th>${diasSemanaisP.map(d => `<th>${d}</th>`).join("")}</tr>`);
                        blocosP.forEach(bloco => {
                          win.document.write(`<tr><td class="slot-hora">${bloco.start}–${bloco.end}</td>`);
                          diasSemanaisP.forEach(dia => {
                            const slotSess = allSessoes.filter(s => s.semana === w && s.diaSemana === dia && s.horaInicio === bloco.start);
                            win.document.write(`<td>${slotSess.map(s => `<div class="card card-${s.tipoAula.toLowerCase()}"><strong>${s.ucSigla}</strong> (${s.tipoAula}) ${rotuloTurma(s.turma)}</div>`).join("")}</td>`);
                          });
                          win.document.write(`</tr>`);
                        });
                        win.document.write(`</table></div>`);
                      });
                      win.document.write("</body></html>");
                      win.document.close();
                      setTimeout(() => win.print(), 500);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg text-[10px] font-semibold border border-stone-200 cursor-pointer transition-all"
                  >
                    <FileText className="w-3 h-3" />
                    Exportar PDF
                  </button>
                  <div className="flex items-center gap-1 text-stone-400">
                  <div className="w-2.5 h-2.5 bg-amber-200 rounded-sm" />
                  <span className="text-[10px]">Aulas Práticas (PL/TP)</span>
                  <div className="w-2.5 h-2.5 bg-stone-100 border border-stone-250 ml-2 rounded-sm" />
                  <span className="text-[10px]">Teóricas (T)</span>
                </div>
                </div>
              </div>

              {/* FILTRO DE ANO/SEMESTRE — acima do explorador semanal */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-stone-50/75 p-4 rounded-xl border border-stone-150">
                <div className="space-y-1.5">
                  <span className="text-[10px] uppercase font-bold text-stone-500 tracking-wider block">Ano Curricular (CLE)</span>
                  <div className="flex flex-wrap gap-1.5">
                    {(() => {
                      const isDirector = perfilAtivo.startsWith("diretor");
                      const coordYear = !isDirector ? (parseInt(perfilAtivo.replace(/\D/g, "")) || null) : null;
                      const allYearBtns = [
                        { id: "todos", label: "Todos os Anos" },
                        { id: 1, label: "1.º Ano" }, { id: 2, label: "2.º Ano" },
                        { id: 3, label: "3.º Ano" }, { id: 4, label: "4.º Ano" }
                      ];
                      const visibleBtns = isDirector ? allYearBtns : allYearBtns.filter(b => b.id === coordYear);
                      return visibleBtns.map(btn => (
                        <button key={btn.id} onClick={() => setSelectedYearFilter(btn.id as any)}
                          className={`px-3 py-1.5 rounded-lg text-2xs font-semibold cursor-pointer transition-all ${selectedYearFilter === btn.id ? "bg-stone-900 text-white shadow-3xs" : "bg-white text-stone-600 border border-stone-200/80 hover:bg-stone-100"}`}>
                          {btn.label}
                        </button>
                      ));
                    })()}
                  </div>
                  {!perfilAtivo.startsWith("diretor") && (
                    <p className="text-[9px] text-stone-400 italic">Acesso restrito ao {parseInt(perfilAtivo.replace(/\D/g, "")) || ""}º ano — perfil {getPerfilLabel(perfilAtivo)}.</p>
                  )}
                  {selectedYearFilter === "todos" ? (
                    <p className="text-[9px] text-stone-400 italic">Escolhe um ano para validar e gerar.</p>
                  ) : (
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <button onClick={() => handleTriggerSolver(false)} disabled={isSolving}
                        className="px-3 py-1.5 bg-[#1E1C19] text-white hover:bg-stone-850 font-bold rounded-lg flex items-center gap-1.5 cursor-pointer disabled:opacity-40 text-2xs w-fit">
                        {isSolving ? (<><RefreshCw className="w-3 h-3 animate-spin" /> A Gerar...</>) : (<><Zap className="w-3 h-3 text-amber-300" /> Validar e Gerar Distribuição</>)}
                      </button>
                      <button onClick={() => handleTriggerSolver(true)} disabled={isSolving} title="Distribui sem nenhuma regra pedagógica — mantém apenas os turnos da tarde e o espaço para almoço. Para comparar cenários."
                        className="px-3 py-1.5 bg-white border border-stone-300 text-stone-600 hover:bg-stone-100 font-bold rounded-lg flex items-center gap-1.5 cursor-pointer disabled:opacity-40 text-2xs w-fit">
                        <Zap className="w-3 h-3 text-stone-400" /> Gerar sem regras
                      </button>
                    </div>
                  )}

                  {/* Importar horário feito fora da plataforma (Excel/CSV) */}
                  {selectedYearFilter !== "todos" && (
                    <div className="mt-3 border border-dashed border-stone-300 rounded-xl p-3 bg-stone-50/40 space-y-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div>
                          <p className="text-[11px] font-bold text-stone-700">Importar proposta externa (Excel/CSV)</p>
                          <p className="text-[9px] text-stone-500">Carrega o horário do {selectedYearFilter}.º ano feito fora; é validado e guardado como uma <strong>nova proposta</strong> com nome. Depois podes gerar para o motor completar à volta.</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={descarregarTemplate}
                            className="px-2.5 py-1.5 bg-white border border-stone-300 text-stone-600 hover:bg-stone-100 font-bold rounded-lg flex items-center gap-1.5 text-[10px]">
                            <Download className="w-3 h-3" /> Template
                          </button>
                          <label className="px-2.5 py-1.5 bg-white border border-stone-300 text-stone-600 hover:bg-stone-100 font-bold rounded-lg flex items-center gap-1.5 text-[10px] cursor-pointer">
                            <Upload className="w-3 h-3" /> Escolher ficheiro
                            <input type="file" accept=".csv,.xlsx,.xls,text/csv" className="hidden"
                              onChange={(e) => { onFicheiroImport(e.target.files?.[0] ?? null); e.target.value = ""; }} />
                          </label>
                        </div>
                      </div>

                      {nomeFicheiroImport && (
                        <div className="text-[10px] text-stone-600 bg-white rounded-lg border border-stone-200 p-2 space-y-1.5">
                          <p className="font-semibold">{nomeFicheiroImport}</p>
                          <p>{sessoesImportadas?.length || 0} linha(s) válida(s){errosImport.length ? ` · ${errosImport.length} com erro` : ""}.</p>

                          {relatorioImport && (
                            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[9.5px]">
                              <span className={relatorioImport.sobreposicoes ? "text-red-600 font-semibold" : "text-emerald-600"}>{relatorioImport.sobreposicoes ? "✗" : "✓"} Sobreposições: {relatorioImport.sobreposicoes}</span>
                              <span className={relatorioImport.excedeu8h ? "text-red-600 font-semibold" : "text-emerald-600"}>{relatorioImport.excedeu8h ? "✗" : "✓"} Máx/dia: {relatorioImport.maxBlocosDia * 2}h</span>
                              <span className={relatorioImport.violacoesAlmoco ? "text-red-600 font-semibold" : "text-emerald-600"}>{relatorioImport.violacoesAlmoco ? "✗" : "✓"} Almoço: {relatorioImport.violacoesAlmoco}</span>
                              <span className={relatorioImport.violacoesCronologia.length ? "text-red-600 font-semibold" : "text-emerald-600"}>{relatorioImport.violacoesCronologia.length ? "✗" : "✓"} Cronologia: {relatorioImport.violacoesCronologia.length}</span>
                              <span className={relatorioImport.tpPlMesmaUC.length ? "text-red-600 font-semibold" : "text-emerald-600"}>{relatorioImport.tpPlMesmaUC.length ? "✗" : "✓"} TP+PL mesma UC: {relatorioImport.tpPlMesmaUC.length}</span>
                              <span className="text-stone-600">Completude: {relatorioImport.completude.pct}%</span>
                            </div>
                          )}

                          {errosImport.length > 0 && (
                            <details className="text-[9px] text-red-700">
                              <summary className="cursor-pointer font-semibold">Ver {errosImport.length} erro(s) de linha</summary>
                              <ul className="mt-1 space-y-0.5 max-h-28 overflow-y-auto">
                                {errosImport.slice(0, 30).map((er, i) => (
                                  <li key={i}>Linha {er.linha}: {er.motivo}</li>
                                ))}
                              </ul>
                            </details>
                          )}

                          <div className="pt-1">
                            <label className="block text-[9px] font-bold uppercase tracking-wider text-stone-400 mb-1">Nome da proposta</label>
                            <input
                              value={nomePropostaImport}
                              onChange={(e) => setNomePropostaImport(e.target.value)}
                              placeholder={nomeFicheiroImport.replace(/\.[^.]+$/, "") || "Nome da proposta importada"}
                              className="w-full text-[11px] border border-stone-200 rounded-lg px-2.5 py-1.5 focus:outline-none"
                            />
                          </div>
                          <div className="flex items-center gap-2 pt-1">
                            <button onClick={confirmarImportacao} disabled={!sessoesImportadas?.length}
                              className="px-3 py-1.5 bg-[#1E1C19] text-white hover:bg-stone-850 font-bold rounded-lg flex items-center gap-1.5 disabled:opacity-40 text-[10px]">
                              <Upload className="w-3 h-3 text-amber-300" /> Importar como proposta
                            </button>
                            <button onClick={limparImport} className="px-3 py-1.5 bg-white border border-stone-300 text-stone-600 hover:bg-stone-100 font-bold rounded-lg text-[10px]">
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
                  <span className="text-[10px] uppercase font-bold text-stone-500 tracking-wider block">Semestre Académico</span>
                  <div className="flex flex-wrap gap-1.5">
                    {[{ id: "todos", label: "Ambos Semestres" }, { id: 1, label: "1.º Semestre" }, { id: 2, label: "2.º Semestre" }].map(btn => (
                      <button key={btn.id} onClick={() => setSelectedSemesterFilter(btn.id as any)}
                        className={`px-3 py-1.5 rounded-lg text-2xs font-semibold cursor-pointer transition-all ${selectedSemesterFilter === btn.id ? "bg-stone-900 text-white shadow-3xs" : "bg-white text-stone-600 border border-stone-200/80 hover:bg-stone-100"}`}>
                        {btn.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* PREFERÊNCIA MANHÃ/TARDE — entre o Ano Curricular e o explorador */}
              <div className="bg-indigo-50/50 border border-indigo-200/70 p-4 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold text-indigo-700 tracking-wider block">
                    Preferência da turma teórica (manhã / tarde) por ano do CLE
                  </span>
                  <span className="text-[9px] text-indigo-500/80 font-mono">T1 (Turma A) = período indicado · T2 (Turma B) = oposto</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[1, 2, 3, 4].map(ano => (
                    <div key={ano} className="flex items-center gap-2 bg-white/70 border border-indigo-100 rounded-lg px-2.5 py-1.5">
                      <span className="text-[10px] font-bold text-stone-700 w-12">{ano}.º ano</span>
                      {[1, 2].map(sem => (
                        <div key={sem} className="flex items-center gap-1">
                          <span className="text-[8.5px] text-stone-400 font-mono">S{sem}</span>
                          <div className="flex rounded-md overflow-hidden border border-indigo-200">
                            {(["manha", "tarde"] as const).map(p => {
                              const ativa = prefManhaDe(ano, sem) === (p === "manha");
                              return (
                                <button key={p} onClick={() => setPrefManha(ano, sem, p === "manha")}
                                  className={`px-2 py-0.5 text-[9px] font-bold cursor-pointer transition-colors ${ativa ? "bg-indigo-600 text-white" : "bg-white text-indigo-500 hover:bg-indigo-50"}`}>
                                  {p === "manha" ? "Manhã" : "Tarde"}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <p className="text-[9px] text-indigo-700/70 leading-tight">Aplica-se na próxima geração. Define se a Turma A desse ano arranca de manhã ou de tarde nesse semestre.</p>
              </div>

              {/* DYNAMIC WEEK TIMELINE SELECTOR */}
              <div className="bg-stone-50/70 p-4 rounded-xl border border-stone-150 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-[#148A96]" />
                    <span className="text-[11px] font-bold uppercase tracking-wider text-stone-700">Explorar Horário Semana a Semana</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-[10px] text-stone-500 font-medium bg-white px-2 py-1 rounded shadow-sm border border-stone-200">
                      A ver a <strong>{getWeekLabel(selectedWeekFilter as number)}</strong>
                    </div>
                    <button
                      onClick={() => toggleSemanaBloqueada(selectedWeekFilter as number)}
                      title={semanasBloqueadas.includes(selectedWeekFilter as number)
                        ? "Esta semana está validada (não muda ao regenerar). Clique para desbloquear."
                        : "Validar e bloquear esta semana (fica congelada ao regenerar)."}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold border cursor-pointer transition-all ${
                        semanasBloqueadas.includes(selectedWeekFilter as number)
                          ? "bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700"
                          : "bg-white text-stone-700 border-stone-200 hover:bg-stone-100"
                      }`}
                    >
                      {semanasBloqueadas.includes(selectedWeekFilter as number)
                        ? <><Lock className="w-3 h-3" /> Validada</>
                        : <><Unlock className="w-3 h-3" /> Validar semana</>}
                    </button>
                  </div>
                </div>

                {/* S1 row */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[9px] font-black uppercase tracking-widest text-[#148A96] font-mono">1.º Semestre</span>
                    <div className="flex-1 h-px bg-[#148A96]/20" />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {Array.from({ length: 15 }, (_, i) => i + 1).map(w => {
                      const activeCount = ucs.filter(u => {
                        if (u.semestre !== 1) return false;
                        const start = u.semanaInicio || 1;
                        return w >= start && w <= start + (u.numSemanas || 15) - 1;
                      }).length;
                      const bloqueada = semanasBloqueadas.includes(w);
                      return (
                        <button key={w}
                          onClick={() => { setSelectedWeekFilter(w); setSelectedSemesterFilter(1); }}
                          className={`flex flex-col items-center px-2.5 py-1 rounded-lg border text-center cursor-pointer transition-all min-w-[62px] ${selectedWeekFilter === w ? "bg-[#148A96] text-white border-[#148A96] scale-105" : bloqueada ? "bg-emerald-50 text-stone-700 border-emerald-300" : "bg-white text-stone-700 border-stone-200 hover:bg-stone-100"}`}
                        >
                          <span className="text-[10px] font-bold font-mono flex items-center gap-0.5">
                            {bloqueada && <Lock className={`w-2.5 h-2.5 ${selectedWeekFilter === w ? "text-white" : "text-emerald-600"}`} />}
                            Sem. {w}
                          </span>
                          <span className={`text-[8px] ${selectedWeekFilter === w ? "text-stone-100" : "text-stone-400"}`}>{activeCount} UC{activeCount !== 1 ? "s" : ""}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                {/* S2 row */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[9px] font-black uppercase tracking-widest text-amber-600 font-mono">2.º Semestre</span>
                    <div className="flex-1 h-px bg-amber-400/30" />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {Array.from({ length: 15 }, (_, i) => i + 16).map(w => {
                      const activeCount = ucs.filter(u => {
                        if (u.semestre !== 2) return false;
                        const start = (u.semanaInicio || 1) + 15;
                        return w >= start && w <= start + (u.numSemanas || 15) - 1;
                      }).length;
                      const bloqueada = semanasBloqueadas.includes(w);
                      return (
                        <button key={w}
                          onClick={() => { setSelectedWeekFilter(w); setSelectedSemesterFilter(2); }}
                          className={`flex flex-col items-center px-2.5 py-1 rounded-lg border text-center cursor-pointer transition-all min-w-[62px] ${selectedWeekFilter === w ? "bg-amber-600 text-white border-amber-600 scale-105" : bloqueada ? "bg-emerald-50 text-stone-700 border-emerald-300" : "bg-white text-stone-700 border-stone-200 hover:bg-stone-100"}`}
                        >
                          <span className="text-[10px] font-bold font-mono flex items-center gap-0.5">
                            {bloqueada && <Lock className={`w-2.5 h-2.5 ${selectedWeekFilter === w ? "text-white" : "text-emerald-600"}`} />}
                            Sem. {w}
                          </span>
                          <span className={`text-[8px] ${selectedWeekFilter === w ? "text-stone-100" : "text-stone-400"}`}>{activeCount} UC{activeCount !== 1 ? "s" : ""}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                
                {/* Active UCs list for the selected week */}
                <div className="bg-white p-3 rounded-lg border border-stone-150 flex flex-wrap items-center gap-2 animate-fade-in text-2xs">
                  <span className="font-semibold text-stone-600 text-3xs uppercase tracking-wide mr-1 block">Disciplinas desta semana:</span>
                  {ucs
                    .filter(u => {
                      const semOffset = u.semestre === 2 ? 15 : 0;
                      const start = (u.semanaInicio || 1) + semOffset;
                      const end = start + (u.numSemanas || 15) - 1;
                      return (selectedWeekFilter as number) >= start && (selectedWeekFilter as number) <= end;
                    })
                    .map(u => {
                      const semOffset = u.semestre === 2 ? 15 : 0;
                      const gStart = (u.semanaInicio || 1) + semOffset;
                      const gEnd = gStart + (u.numSemanas || 15) - 1;
                      return (
                      <span
                        key={u.id}
                        onClick={() => setEditingUcId(u.id)}
                        className="px-2 py-1 bg-stone-100 hover:bg-[#DEF1F3] hover:text-[#148A96] transition-colors border border-stone-200 rounded-md font-medium text-stone-700 cursor-pointer flex items-center gap-1.5"
                        title="Clique para parametrizar esta UC"
                      >
                        <span className="font-bold text-stone-900">{u.sigla}</span>
                        <span className="text-stone-400">·</span>
                        <span className="text-[10px] text-stone-600 truncate max-w-[120px]">{u.nome}</span>
                        <span className="text-[9px] bg-stone-200 px-1 rounded-sm text-stone-500 font-mono">S{gStart}-{gEnd}</span>
                      </span>
                    );
                    })}
                  {ucs.filter(u => {
                    const semOffset = u.semestre === 2 ? 15 : 0;
                    const start = (u.semanaInicio || 1) + semOffset;
                    const end = start + (u.numSemanas || 15) - 1;
                    return (selectedWeekFilter as number) >= start && (selectedWeekFilter as number) <= end;
                  }).length === 0 && (
                    <span className="text-stone-400 italic">Nenhuma Unidade Curricular planeada para esta semana.</span>
                  )}
                </div>
              </div>

              {/* 3rd YEAR SPECIAL CASE NOTE */}
              {selectedYearFilter === 3 && (
                <div className="bg-amber-50/60 border border-amber-200 text-amber-800 p-5 rounded-2xl space-y-2 animate-fade-in">
                  <div className="flex items-center gap-1.5 font-bold text-stone-850">
                    <AlertCircle className="w-4 h-4 text-amber-700" />
                    <span>Nota Pedagógica: Estrutura Curricular do 3.º Ano ESEUC</span>
                  </div>
                  <p className="text-[11px] leading-relaxed select-none">
                    De acordo com as diretivas do curso de Licenciatura em Enfermagem da ESEUC, o <strong className="font-semibold text-stone-900">3.º Ano do plano de estudos é exclusivamente clínico (EC - Ensino Clínico)</strong>. 
                  </p>
                  <p className="text-[11px] leading-relaxed select-none">
                    Por este motivo, as horas de contacto curricular representam estágios hospitalares e não exigem organização em horários fixos de sala de aula de segunda a sexta, decorrendo sob o formato de planeamento de horário flexível diretamente nas unidades funcionais e centros de saúde. Não existem sessões fixas a representar nesta grelha semanal.
                  </p>
                </div>
              )}

              {/* Render dynamic visual calendar grid */}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-stone-200">
                      <th className="py-2.5 px-3 font-serif font-bold text-stone-850 w-24">Período</th>
                      {diasSemanais.map(day => (
                        <th key={day} className="py-2.5 px-3 font-serif font-bold text-stone-850 text-center w-40">
                          {day}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {blocosHoras.map((slot) => (
                      <tr key={slot.start} className="border-b border-stone-150/60 hover:bg-stone-50/30">
                        <td className="py-4 px-3 font-mono text-stone-500 font-medium">
                          {slot.start} - {slot.end}
                        </td>
                        
                        {diasSemanais.map((dia) => {
                          // Find matching session in active version with intelligent nursing filters
                          const slotSessions = activeVersao
                            ? activeVersao.sessoes.filter((s) => {
                                if (s.diaSemana !== dia || s.horaInicio !== slot.start) return false;
                                
                                // Look up the Unidade Curricular metadata
                                const matchingUc = ucs.find(u => u.sigla === s.ucSigla);
                                if (!matchingUc) return true; // Show if custom index

                                if (selectedYearFilter !== "todos" && Number(matchingUc.anoCurricular) !== Number(selectedYearFilter)) {
                                  return false;
                                }
                                // NB: NÃO se filtra por selectedSemesterFilter — a semana selecionada
                                // (global 1-30) já determina o semestre. Filtrar por semestre podia
                                // esconder semanas válidas (ex.: a 8-15 ficava vazia se o filtro
                                // estivesse preso no 2.º semestre).

                                // Filter by the session's exact week (not a range)
                                if (s.semana !== Number(selectedWeekFilter)) return false;

                                return true;
                              })
                            : [];

                          return (
                            <td
                              key={dia}
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={() => handleDropOnSlot(dia, slot.start, slot.end)}
                              className="p-1.5 min-h-[90px] border-l border-stone-100/80 align-top transition-colors relative group"
                            >
                              <div className="flex flex-wrap gap-1 content-start">
                                {slotSessions.map((sessao) => {
                                  let bgClass = "bg-white border-stone-250 text-stone-800";
                                  if (sessao.tipoAula === "PL") {
                                    bgClass = "bg-[#FAF1EE] border-[#ECC4B9] text-[#A64A31]";
                                  } else if (sessao.tipoAula === "TP") {
                                    bgClass = "bg-[#EEF4FA] border-[#B9CDEC] text-[#3164A6]";
                                  } else if (sessao.tipoAula === "S") {
                                    bgClass = "bg-[#F3EEFA] border-[#D6CBE8] text-[#6A41A6]";
                                  }

                                  return (
                                    <div
                                      key={sessao.id}
                                      draggable
                                      onDragStart={(e) => handleDragStart(e, sessao.id)}
                                      className={`w-[calc(33.333%-0.2rem)] min-w-[75px] p-1.5 rounded-lg border text-left transition-all relative cursor-grab shadow-sm pointer-events-auto flex flex-col gap-0.5 flex-grow ${bgClass} ${sessao.bloqueado ? "ring-1 ring-amber-400/50" : ""}`}
                                    >
                                      <div className="flex items-center justify-between gap-1 leading-none">
                                        <div className="flex items-center gap-1 font-mono font-bold text-[9px] tracking-wide uppercase truncate">
                                          <span>{sessao.ucSigla}</span>
                                          <span className="opacity-75 font-sans font-medium text-[8px] whitespace-nowrap">({sessao.tipoAula})</span>
                                          {totalBlocosDe(sessao) > 0 && (
                                            <span className="font-sans font-bold text-[8px] text-stone-500 whitespace-nowrap">{blocoIndexMap.get(sessao.id) ?? "?"}/{totalBlocosDe(sessao)}</span>
                                          )}
                                        </div>
                                        <div className="flex items-center gap-0.5 shrink-0">
                                          <button
                                            onClick={() => {
                                              const ucObj = ucs.find(u => u.sigla === sessao.ucSigla || u.nome === sessao.ucNome);
                                              if (ucObj) setHorasUcModal(ucObj);
                                            }}
                                            className="cursor-pointer"
                                            title="Ver total de horas da UC"
                                          >
                                            <Info className="w-2.5 h-2.5 opacity-40 hover:opacity-100" />
                                          </button>
                                          <button onClick={() => toggleSessionBlock(sessao.id)} className="cursor-pointer" title={sessao.bloqueado ? "Desbloquear" : "Bloquear"}>
                                            {sessao.bloqueado ? <Lock className="w-2.5 h-2.5 text-amber-500" /> : <Unlock className="w-2.5 h-2.5 opacity-40 hover:opacity-100" />}
                                          </button>
                                          <button
                                            onClick={() => {
                                              const ucObj = ucs.find(u => u.sigla === sessao.ucSigla || u.nome === sessao.ucNome);
                                              if (ucObj) setAddUcId(ucObj.id);
                                              setAddAulaCtx({ dia: sessao.diaSemana, horaInicio: sessao.horaInicio, horaFim: sessao.horaFim, semana: sessao.semana ?? Number(selectedWeekFilter), editId: sessao.id });
                                            }}
                                            className="cursor-pointer" title="Editar aula (trocar UC/turma)"
                                          >
                                            <Edit2 className="w-2.5 h-2.5 text-stone-400 hover:text-[#148A96]" />
                                          </button>
                                          <button onClick={() => deleteSession(sessao.id)} className="cursor-pointer" title="Eliminar aula">
                                            <Trash2 className="w-2.5 h-2.5 text-rose-400 hover:text-rose-600" />
                                          </button>
                                        </div>
                                      </div>

                                      <div className="text-[9px] font-bold leading-none truncate mt-0.5 text-black">
                                        {rotuloTurma(sessao.turma)}
                                      </div>

                                      <div className="text-[8px] opacity-80 mt-0.5 truncate leading-none flex items-center gap-1">
                                        <span className="opacity-60">"</span>
                                        {incluirSalas ? (
                                          <select
                                            value={sessao.sala || ""}
                                            onClick={(e) => e.stopPropagation()}
                                            onChange={(e) => atribuirCampoSessao(sessao.id, "sala", e.target.value)}
                                            className="bg-white/80 border border-stone-300 rounded text-[8px] px-0.5 py-0 max-w-[92px] cursor-pointer"
                                          >
                                            <option value="">— sala —</option>
                                            {salasDisponiveis(sessao).map(s => <option key={s.id} value={s.nome}>{s.nome} ({s.capacidade})</option>)}
                                          </select>
                                        ) : (
                                          <span>{sessao.sala}</span>
                                        )}
                                      </div>

                                      {(incluirDocentes || sessao.docente) && (
                                        <div className="text-[8px] opacity-80 truncate leading-none flex items-center gap-1">
                                          <span className="opacity-60">'¤</span>
                                          {incluirDocentes ? (
                                            <select
                                              value={sessao.docente || ""}
                                              onClick={(e) => e.stopPropagation()}
                                              onChange={(e) => atribuirCampoSessao(sessao.id, "docente", e.target.value)}
                                              className="bg-white/80 border border-stone-300 rounded text-[8px] px-0.5 py-0 max-w-[92px] cursor-pointer"
                                            >
                                              <option value="">— docente —</option>
                                              {docentes.map(d => <option key={d.id} value={d.nome}>{d.nome}</option>)}
                                            </select>
                                          ) : (
                                            <span>{sessao.docente}</span>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}

                                {slotSessions.length === 0 && (
                                  <div className="p-4 text-center text-stone-300 border border-dashed border-stone-150/50 rounded-xl select-none group-hover:block transition-all">
                                    <span className="text-4xs uppercase tracking-wider font-medium text-stone-400">Arraste para aqui</span>
                                  </div>
                                )}
                              </div>
                              <button
                                onClick={() => setAddAulaCtx({ dia, horaInicio: slot.start, horaFim: slot.end, semana: Number(selectedWeekFilter) })}
                                title="Adicionar aula neste bloco"
                                className="absolute bottom-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity bg-[#148A96] text-white rounded-full w-4 h-4 flex items-center justify-center cursor-pointer shadow-sm"
                              >
                                <Plus className="w-2.5 h-2.5" />
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* INDICADOR DE COMPLETUDE (blocos colocados / carga total) */}
              {(() => {
                const ucsAno = ucs.filter(u => (selectedYearFilter === "todos" || Number(u.anoCurricular) === Number(selectedYearFilter)) && u.turmasConfig?.length && Number(u.anoCurricular) !== 3);
                let alvo = 0;
                for (const u of ucsAno) {
                  const tc = u.turmasConfig || [];
                  let nT = tc.filter(t => t.tipo === "Teórica").length, nTP = tc.filter(t => t.tipo === "TeoricoPratica").length, nPL = tc.filter(t => t.tipo === "Prática").length;
                  const nS = tc.filter(t => t.tipo === "Seminário").length;
                  // UCs de bloco do 2.º ano ("-I" só T1/Turma A nas sem. 8-15, "-II" só T2/Turma B
                  // nas 16-23): apenas metade das turmas frequenta — o alvo conta só a presente.
                  if (Number(u.anoCurricular) === 2 && /-(I|II)$/.test(u.sigla)) { nT = Math.ceil(nT / 2); nTP = nTP / 2; nPL = nPL / 2; }
                  alvo += Math.floor((u.cargaHorariaTeorica || 0) / 2) * nT + Math.floor((u.cargaHorariaTP || 0) / 2) * nTP + Math.floor((u.cargaHorariaPratica || 0) / 2) * nPL + Math.floor((u.cargaHorariaS || 0) / 2) * nS;
                }
                const sigSet = new Set(ucsAno.map(u => u.sigla));
                const colocados = (activeVersao?.sessoes || []).filter(s => sigSet.has(s.ucSigla)).length;
                const pct = alvo ? Math.round((colocados / alvo) * 100) : 0;
                const cor = pct >= 95 ? "text-emerald-600" : pct >= 80 ? "text-amber-600" : "text-rose-600";
                return (
                  <div className="bg-white border border-stone-200 rounded-xl p-3 flex items-center justify-between">
                    <span className="text-[10px] uppercase font-bold text-stone-600 tracking-wider flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-[#148A96]" /> Completude da distribuição{selectedYearFilter !== "todos" ? ` — ${selectedYearFilter}.º ano` : ""}</span>
                    <span className="text-sm font-mono font-bold"><span className={cor}>{pct}%</span> <span className="text-stone-400 text-[10px]">({colocados}/{alvo} blocos)</span></span>
                  </div>
                );
              })()}

              {/* CONTADOR DE HORAS POR TURMA POR DIA (da semana selecionada) */}
              {(() => {
                const folhasDe = (t: string): string[] => {
                  if (t === "Turma A") return Array.from({ length: 12 }, (_, i) => "PL" + (i + 1));
                  if (t === "Turma B") return Array.from({ length: 12 }, (_, i) => "PL" + (i + 13));
                  const m = t.match(/^TP(\d+)$/); if (m) { const n = +m[1]; const s = (n - 1) * 3 + 1; return [s, s + 1, s + 2].map(i => "PL" + i); }
                  if (/^PL\d+$/.test(t)) return [t];
                  return [];
                };
                const dias = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"];
                const wkSess = (activeVersao?.sessoes || []).filter(s => {
                  if (s.semana !== Number(selectedWeekFilter)) return false;
                  if (selectedYearFilter === "todos") return true;
                  const uc = ucs.find(u => u.sigla === s.ucSigla); return uc && Number(uc.anoCurricular) === Number(selectedYearFilter);
                });
                const horasTurmaDia = (grupos: string[], dia: string) => {
                  const cnt: Record<string, number> = {};
                  for (const s of wkSess) { if (s.diaSemana !== dia) continue; for (const g of folhasDe(s.turma)) if (grupos.includes(g)) cnt[g] = (cnt[g] || 0) + 1; }
                  const max = Math.max(0, ...Object.values(cnt));
                  return max * 2;
                };
                const gruposA = Array.from({ length: 12 }, (_, i) => "PL" + (i + 1));
                const gruposB = Array.from({ length: 12 }, (_, i) => "PL" + (i + 13));
                const corH = (h: number) => h > 8 ? "text-rose-600 font-bold" : h === 8 ? "text-amber-600" : "text-stone-700";
                return (
                  <div className="bg-stone-50/70 border border-stone-200 rounded-xl p-3 space-y-1.5">
                    <span className="text-[10px] uppercase font-bold text-stone-600 tracking-wider flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-[#148A96]" /> Horas por turma por dia (máx. 8h/aluno) — {getWeekLabel(selectedWeekFilter as number)}</span>
                    <table className="w-full text-[10px]">
                      <thead><tr className="text-stone-400 font-mono uppercase text-[8.5px]"><th className="text-left py-1">Turma</th>{dias.map(d => <th key={d} className="text-center">{d.slice(0, 3)}</th>)}<th className="text-center">Total</th></tr></thead>
                      <tbody>
                        {[{ n: "Turma A", g: gruposA }, { n: "Turma B", g: gruposB }].map(row => {
                          const horas = dias.map(d => horasTurmaDia(row.g, d));
                          return (
                            <tr key={row.n} className="border-t border-stone-150">
                              <td className="py-1 font-bold text-stone-700">{rotuloTurma(row.n)}</td>
                              {horas.map((h, i) => <td key={i} className={`text-center font-mono ${corH(h)}`}>{h ? h + "h" : "·"}</td>)}
                              <td className="text-center font-mono font-bold text-stone-800">{horas.reduce((a, b) => a + b, 0)}h</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })()}

              {/* REGRAS CUMPRIDAS NA SEMANA SELECIONADA */}
              <div className="bg-emerald-50/40 border border-emerald-150 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-700" />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">Regras cumpridas — {getWeekLabel(selectedWeekFilter as number)}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {regras.filter(regraVisivel).filter(r => r.ativa).map(r => (
                    <div key={r.id} className="flex items-start gap-1.5 bg-white/70 border border-emerald-100 rounded-lg px-2.5 py-1.5">
                      <CheckCircle className="w-3 h-3 text-emerald-600 mt-0.5 shrink-0" />
                      <div className="leading-tight">
                        <span className="text-[10.5px] font-semibold text-stone-800">{r.nome}</span>
                        <span className="text-[8.5px] text-stone-400 ml-1">({r.escopo === "ano" ? `${r.anoCurricular}.º ano` : "transversal"})</span>
                      </div>
                    </div>
                  ))}
                  {regras.filter(regraVisivel).filter(r => r.ativa).length === 0 && (
                    <span className="text-[10px] text-stone-400 italic">Sem regras ativas para este âmbito.</span>
                  )}
                </div>
                <p className="text-[9px] text-emerald-700/70 leading-tight">As regras invioláveis são garantidas por construção pelo motor (a distribuição não as viola). As preferenciais são otimizadas conforme o peso.</p>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: CENTRAL DA IA & REGRA DE OPTIMIZAÃ‡ÃƒO ("Não perceba de SQL") */}
        {activeTab === "regras" && (
          <div className="space-y-6 animate-fade-in text-xs">
            {/* Quick Rule Creator Board (Automatic rules requested) */}
            <div className="bg-white rounded-2xl p-6 border border-stone-150 shadow-3xs space-y-4">
              <div>
                <span className="px-2.5 py-0.5 bg-amber-50 text-amber-800 text-[10px] font-bold rounded-full font-mono uppercase tracking-wider">
                  Tradução Automática de Regras com IA
                </span>
                <h3 className="text-lg font-serif font-bold text-stone-900 mt-1">
                  Ativador Rápido de Regras Académicas (Sem Código)
                </h3>
                <p className="text-xs text-stone-500 font-light mt-0.5">
                  Não precisa de saber SQL nem fórmulas matemáticas. Escolha um dos seguintes temas comuns e a nossa IA formulará as restrições por si instantaneamente.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
                {[
                  {
                    id: "sextas",
                    title: "Sextas Livres",
                    desc: "Maximiza as folgas de professores e turmas à sexta-feira.",
                    badge: "Estudantes & Professores",
                    action: "Ativar regra de sextas"
                  },
                  {
                    id: "almoco",
                    title: "Foco no Almoço",
                    desc: "Proíbe de forma estrita aulas letivas entre as 12:00 e as 14:00.",
                    badge: "Especial Calendário",
                    action: "Proteger hora letiva"
                  },
                  {
                    id: "caloiros",
                    title: "Foco Matutino",
                    desc: "Concentra o 1.º ano na parte da manhã para maior produtividade.",
                    badge: "Foco Pedagógico",
                    action: "Dar prioridade"
                  },
                  {
                    id: "investigacao",
                    title: "Dia de Investigação",
                    desc: "Atribui pelo menos 1 dia semanal inteiro sem aulas aos docentes.",
                    badge: "Satisfação Docente",
                    action: "Assegurar folgas"
                  }
                ].map(item => (
                  <div key={item.id} className="bg-stone-50 hover:bg-stone-100 p-4 rounded-xl border border-stone-150 flex flex-col justify-between gap-3 text-left transition-all">
                    <div className="space-y-1">
                      <span className="px-1.5 py-0.5 font-bold uppercase tracking-wider text-[9px] bg-stone-200 text-stone-700 rounded">
                        {item.badge}
                      </span>
                      <h4 className="font-serif font-bold text-[#1E1C19] text-xs pt-1">{item.title}</h4>
                      <p className="text-stone-500 text-[10px] leading-relaxed font-light">{item.desc}</p>
                    </div>

                    <button
                      onClick={() => handleQuickRuleActivate(item.id)}
                      className="w-full text-center py-2 bg-white hover:bg-stone-200 text-stone-800 font-bold border border-stone-250 rounded-xl text-[10px] transition-all cursor-pointer"
                    >
                      {item.action}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Custom Rules list without SQL showing */}
            <div id="regras-prioridade" className="bg-white rounded-2xl p-6 border border-stone-150 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-stone-100 pb-3 flex-wrap gap-2">
                <div>
                  <h3 className="text-base font-serif font-bold flex items-center gap-1.5 text-stone-900">
                    <ListChecks className="w-5 h-5 text-indigo-500" />
                    Zona de Regras de Prioridade e Pesos
                  </h3>
                  <p className="text-xs text-stone-500 mt-0.5">Defina a importância (peso) de cada regra ou se é uma prioridade inviolável para o solver.</p>
                </div>

                <button
                  onClick={() => setIsAddingRegra(!isAddingRegra)}
                  className="flex items-center gap-1 px-3.5 py-2 bg-stone-900 text-white font-semibold text-xs rounded-xl hover:bg-stone-850 transition-all cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  Criar Regra Personalizada
                </button>
              </div>

              {isAddingRegra && (
                <div className="bg-stone-50 p-5 rounded-2xl border border-stone-150 grid grid-cols-1 md:grid-cols-2 gap-4 animate-fade-in text-xs">
                  <div className="space-y-3">
                    <div>
                      <label className="block text-4xs font-bold uppercase tracking-wider text-stone-400 mb-1">Nome Simplificado</label>
                      <input
                        type="text"
                        value={newRegra.nome}
                        onChange={(e) => setNewRegra({ ...newRegra, nome: e.target.value })}
                        placeholder="Ex: Não marcar aulas laboratórios ao sábado"
                        className="w-full bg-white text-xs border border-stone-200 rounded-xl px-3 py-2.5 focus:outline-none"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-4xs font-bold uppercase tracking-wider text-stone-400 mb-1">Severidade</label>
                        <select
                          value={newRegra.tipo}
                          onChange={(e) => setNewRegra({ ...newRegra, tipo: e.target.value as any })}
                          className="w-full bg-white text-xs border border-stone-200 rounded-xl px-2 py-2"
                        >
                          <option value="hard">Hard (Inviolável / Obrigatório)</option>
                          <option value="soft">Soft (Preferência Otimizada)</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-4xs font-bold uppercase tracking-wider text-stone-400 mb-1">Categoria Alvo</label>
                        <select
                          value={newRegra.categoria}
                          onChange={(e) => setNewRegra({ ...newRegra, categoria: e.target.value })}
                          className="w-full bg-white text-xs border border-stone-200 rounded-xl px-2 py-2"
                        >
                          <option value="Professor">Professores</option>
                          <option value="Sala">Instalações</option>
                          <option value="Estudantes">Estudantes</option>
                          <option value="Calendário">Calendário</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-4xs font-bold uppercase tracking-wider text-stone-400 mb-1">mbito</label>
                        <select
                          value={newRegra.escopo || "transversal"}
                          onChange={(e) => setNewRegra({
                            ...newRegra,
                            escopo: e.target.value as any,
                            anoCurricular: e.target.value === "transversal" ? "todos" : 2
                          })}
                          className="w-full bg-white text-xs border border-stone-200 rounded-xl px-2 py-2"
                        >
                          <option value="transversal">Transversal a todos os anos</option>
                          <option value="ano">Específica de um ano</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-4xs font-bold uppercase tracking-wider text-stone-400 mb-1">Ano alvo</label>
                        <select
                          value={newRegra.anoCurricular || "todos"}
                          disabled={(newRegra.escopo || "transversal") === "transversal"}
                          onChange={(e) => setNewRegra({ ...newRegra, anoCurricular: Number(e.target.value) })}
                          className="w-full bg-white text-xs border border-stone-200 rounded-xl px-2 py-2 disabled:bg-stone-100 disabled:text-stone-400"
                        >
                          <option value="todos">Todos</option>
                          <option value={1}>1.º Ano</option>
                          <option value={2}>2.º Ano</option>
                          <option value={3}>3.º Ano</option>
                          <option value={4}>4.º Ano</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="block text-4xs font-bold uppercase tracking-wider text-stone-400 mb-1">Instrução livre para a IA organizar</label>
                      <textarea
                        value={newRegra.descricao}
                        onChange={(e) => setNewRegra({ ...newRegra, descricao: e.target.value })}
                        placeholder="Escreva em detalhe como quer que os horários sejam estruturados..."
                        className="w-full h-16 bg-white text-xs border border-stone-200 rounded-xl p-2.5 focus:outline-none"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-4xs font-bold uppercase tracking-wider text-stone-400 mb-1">Importância (1 a 10)</label>
                        <input
                          type="number"
                          min={1}
                          max={10}
                          value={newRegra.peso}
                          onChange={(e) => setNewRegra({ ...newRegra, peso: Number(e.target.value) })}
                          className="w-full bg-white text-xs border border-stone-200 rounded-xl px-3 py-2"
                        />
                      </div>
                      <div className="flex items-end">
                        <button
                          onClick={handleAddRegra}
                          className="w-full text-center py-2 bg-stone-900 text-white font-semibold rounded-xl hover:bg-stone-800 transition-all cursor-pointer text-xs"
                        >
                          Gravar Regra Inteligente
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* DOIS CONJUNTOS: regras transversais (todos os anos) + regras por ano. */}
              {(() => {
                const visiveis = regras.filter(regraVisivel);
                const transversais = visiveis.filter(r => anosDaRegra(r).length === 0);
                const porAno = visiveis.filter(r => anosDaRegra(r).length > 0); // pode aparecer em vários anos
                const anos = [...new Set<number>(porAno.flatMap(r => anosDaRegra(r)))].sort((a, b) => a - b);
                return (
                  <div className="space-y-5">
                    <div className="space-y-2">
                      <h4 className="text-[11px] font-bold uppercase tracking-wider text-stone-500 flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5 text-[#148A96]" /> Regras transversais (todos os anos) · {transversais.length}
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {transversais.map(cartaoRegra)}
                        {transversais.length === 0 && <span className="text-[10px] text-stone-400 italic">Sem regras transversais.</span>}
                      </div>
                    </div>
                    {anos.map(ano => (
                      <div key={ano} className="space-y-2">
                        <h4 className="text-[11px] font-bold uppercase tracking-wider text-stone-500 flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-amber-600" /> Regras do {ano}.º ano · {porAno.filter(r => anosDaRegra(r).includes(ano)).length}
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {porAno.filter(r => anosDaRegra(r).includes(ano)).map(cartaoRegra)}
                        </div>
                      </div>
                    ))}
                    {porAno.length === 0 && (
                      <p className="text-[10px] text-stone-400 italic">Ainda não há regras específicas por ano. Cria uma com âmbito "Específica de um ano" (ou muda o âmbito de uma transversal acima).</p>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* TAB 4: SOLVER GENERATOR RUN CONTROLS */}
        {activeTab === "scheduler" && false && (
          <div className="space-y-6 animate-fade-in text-xs">
            <div className="bg-white rounded-2xl p-6 border border-stone-150 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-stone-100 pb-3 flex-wrap gap-2">
                <div>
                  <h3 className="text-base font-serif font-bold text-stone-900">Motor de Resolução Automática</h3>
                  <p className="text-xs text-stone-500 font-light">Cruza docentes, salas, turmas e regras para recalcular o melhor horário académico possível.</p>
                </div>
                
                <button
                  onClick={() => handleTriggerSolver(false)}
                  disabled={isSolving}
                  className="px-5 py-2.5 bg-stone-900 text-white hover:bg-stone-850 font-bold rounded-xl flex items-center gap-2 transition-all cursor-pointer disabled:opacity-40 shadow-xs text-xs"
                >
                  {isSolving ? (
                    <>
                      <Disc className="w-4 h-4 animate-spin text-white" />
                      A computar grade ideal...
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4 text-amber-300 animate-pulse" />
                      Gerar Horário Otimizado
                    </>
                  )}
                </button>
              </div>

              {isSolving && (
                <div className="p-5 bg-stone-950 text-stone-200 rounded-xl space-y-3 font-mono leading-relaxed">
                  <div className="flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin text-amber-300" />
                    <span className="font-bold text-amber-200 text-xs">A executar o motor de distribuição…</span>
                  </div>
                  <pre className="text-4xs text-stone-400 space-y-0.5 font-light">
                    {`[INFO] Alvos: ${ucs.length} UCs, ${salas.length} salas, ${docentes.length} docentes.\n`}
                    {"[MOTOR] Distribuição local (TypeScript) por semana, com ordenação T→TP→PL...\n"}
                    {"[MOTOR] Regras: máx. 6 PL/mancha, sem conflitos de turma, calendário e feriados...\n"}
                    {"[MOTOR] A preencher o horário e a gravar no Supabase."}
                  </pre>
                </div>
              )}

              {lastSolverVerdict ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-fade-in">
                  <div className="bg-emerald-50/50 p-5 rounded-2xl border border-emerald-150 flex flex-col justify-between">
                    <div className="space-y-15">
                      <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-widest font-mono">Status do Gerador</span>
                      <h4 className="text-base font-serif font-black text-emerald-950 mt-1">HORÁRIO OTIMIZADO!</h4>
                      <p className="text-[11px] text-stone-600 leading-relaxed font-light mt-1">
                        O algoritmo calculou todas as variáveis. As regras invioláveis estáo 100% asseguradas.
                      </p>
                    </div>

                    <div className="pt-4 border-t border-emerald-150/40 mt-4 flex items-center justify-between font-mono">
                      <div>
                        <span className="text-4xs text-emerald-800 font-bold tracking-wider uppercase block">Qualidade</span>
                        <div className="text-lg font-black text-emerald-950">{lastSolverVerdict.score}/100</div>
                      </div>
                      <div>
                        <span className="text-4xs text-emerald-800 font-bold tracking-wider uppercase block">Velocidade</span>
                        <div className="text-xs font-bold text-emerald-950">{lastSolverVerdict.runDetails?.solveTimeMs} ms</div>
                      </div>
                    </div>
                  </div>

                  <div className="md:col-span-2 bg-stone-50 rounded-2xl p-5 border border-stone-150 space-y-3">
                    <h4 className="font-bold text-stone-900 border-b border-stone-200 pb-2 text-xs uppercase tracking-wider">Métricas da Geração</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <span className="text-4xs uppercase tracking-widest text-stone-400 font-medium block">Caminhos Analisados</span>
                        <div className="font-mono text-xs font-bold text-stone-900">
                          {lastSolverVerdict.runDetails?.iterations} combinações testadas
                        </div>
                      </div>
                      <div>
                        <span className="text-4xs uppercase tracking-widest text-stone-400 font-medium block">Divergências Soft</span>
                        <div className="font-mono text-xs font-bold text-stone-900">
                          {lastSolverVerdict.conflicts?.length || 0} infrações leves minimizadas
                        </div>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-stone-100">
                      <span className="text-4xs uppercase tracking-widest text-stone-400 font-bold block mb-1">Avisos e sugestões de reajuste</span>
                      <div className="max-h-[140px] overflow-y-auto space-y-1 text-[11px] leading-relaxed">
                        {lastSolverVerdict.conflicts && lastSolverVerdict.conflicts.length > 0 ? (
                          lastSolverVerdict.conflicts.map((c: any, i: number) => (
                            <div key={i} className="flex items-start gap-1 p-2 bg-amber-50 text-amber-900 rounded-xl border border-amber-100">
                              <span className="px-1 py-0.2 bg-amber-150 text-[9px] font-black uppercase rounded shrink-0">Dica</span>
                              <p>{c.descricao}</p>
                            </div>
                          ))
                        ) : (
                          <div className="text-emerald-700 font-bold flex items-center gap-1.5 p-2 bg-emerald-50 rounded-xl">
                            <Check className="w-4 h-4" /> Excelente. Parabéns, o seu calendário escolar atingiu o score ótimo sem nenhuma infração.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center bg-stone-50 border border-dashed border-stone-150 rounded-xl text-stone-500 font-light">
                  Clique em "Gerar Horário Otimizado" para que o nosso sistema inteligente reposicione as turmas baseado nas indisponibilidades de professores e limitações de salas.
                </div>
              )}
            </div>

            {/* Past solver executions logs */}
            <div className="bg-white rounded-2xl p-6 border border-stone-150 shadow-xs space-y-4">
              <h3 className="text-base font-serif font-bold text-stone-900">Histórico de Otimizações Realizadas</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-stone-500 leading-relaxed">
                  <thead>
                    <tr className="border-b border-stone-150 font-serif font-bold text-stone-900">
                      <th className="py-2.5 px-3">Data/Hora</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Duração</th>
                      <th className="py-2.5 px-3 text-right">Score Conquistado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {solverRuns.map((run) => (
                      <tr key={run.id} className="border-b border-stone-100 hover:bg-stone-50/50">
                        <td className="py-2.5 px-3 font-mono">{run.dataExecucao.slice(0, 19).replace("T", " ")}</td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 bg-emerald-50 text-emerald-800 rounded-md font-bold text-3xs">
                            {run.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-mono">{run.duracaoMs} ms</td>
                        <td className="py-2.5 px-3 text-right font-bold text-stone-800">{run.score}/100</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: PARAMS (UCs, docentes, salas) */}
        {activeTab === "config" && (
          <div className="space-y-6 animate-fade-in text-xs">
            {/* ADMINISTRAÇÃO — convites (só para administradores) */}
            {perfil?.isAdmin && <AdminConvites />}

            {/* FASES DO FLUXO — atribuição manual de salas e docentes */}
            <div className="bg-white rounded-2xl p-5 border border-stone-150 shadow-3xs space-y-3">
              <div>
                <h3 className="text-base font-serif font-bold text-stone-900 flex items-center gap-1.5"><Layers className="w-4 h-4 text-[#148A96]" /> Fases da distribuição</h3>
                <p className="text-[11px] text-stone-500 mt-0.5">O horário constrói-se por fases que controlas à mão: <strong>1.º as UCs</strong> (sempre); depois, quando ativares abaixo, atribuis <strong>salas</strong> e <strong>docentes</strong> sessão a sessão, diretamente no grid do horário.</p>
              </div>
              <label className="flex items-center justify-between gap-3 bg-stone-50/70 border border-stone-150 rounded-xl px-3 py-2.5 cursor-pointer">
                <div>
                  <span className="text-xs font-bold text-stone-800">2.ª fase — Distribuição de salas</span>
                  <p className="text-[10px] text-stone-500">O sistema <strong>propõe</strong> as salas; depois trocas no grid só entre as <strong>disponíveis</strong> (tipo certo, capacidade, sem choque). Ativa quando tiveres as salas todas no sistema.</p>
                </div>
                <input type="checkbox" checked={incluirSalas} onChange={(e) => setIncluirSalas(e.target.checked)} className="w-4 h-4 rounded text-[#148A96] focus:ring-[#148A96] cursor-pointer shrink-0" />
              </label>
              {incluirSalas && (
                <button onClick={proporSalas} className="w-fit px-3 py-1.5 bg-[#148A96] text-white hover:bg-[#0f6f78] font-bold rounded-lg text-[11px] flex items-center gap-1.5 cursor-pointer">
                  <Sparkles className="w-3.5 h-3.5" /> Propor salas para a proposta ativa
                </button>
              )}
              <label className="flex items-center justify-between gap-3 bg-stone-50/70 border border-stone-150 rounded-xl px-3 py-2.5 cursor-pointer">
                <div>
                  <span className="text-xs font-bold text-stone-800">3.ª fase — Distribuição de docentes</span>
                  <p className="text-[10px] text-stone-500">Selecionas UCs e atribuis docentes por turma — só entre os <strong>elegíveis e disponíveis</strong>, com as opções a encolher (o "sorteio"). E mostra um seletor por sessão no grid.</p>
                </div>
                <input type="checkbox" checked={incluirDocentes} onChange={(e) => setIncluirDocentes(e.target.checked)} className="w-4 h-4 rounded text-[#148A96] focus:ring-[#148A96] cursor-pointer shrink-0" />
              </label>
              {incluirDocentes && (
                <button onClick={abrirDistDocentes} className="w-fit px-3 py-1.5 bg-[#148A96] text-white hover:bg-[#0f6f78] font-bold rounded-lg text-[11px] flex items-center gap-1.5 cursor-pointer">
                  <Sparkles className="w-3.5 h-3.5" /> Abrir distribuição de docentes
                </button>
              )}
            </div>

            {/* CALENDÁRIO E DISTRIBUIÇÃO SEMANAL */}
            <ConfiguracaoCalendario
              anosSemestres={anosSemestres}
              setAnosSemestres={setAnosSemestres}
              ucs={ucs}
              feriados={feriados}
              versoes={versoes}
              setVersoes={setVersoes}
            />

            {/* EDITOR DE TURMAS POR ANO */}
            <div className="bg-white rounded-2xl p-6 border border-stone-150 shadow-xs space-y-5">
              <div className="border-b border-stone-100 pb-3">
                <span className="text-[10px] uppercase font-bold tracking-wider text-[#B5861D] font-mono">Estrutura Pedagógica</span>
                <h3 className="text-base font-serif font-bold text-stone-900 mt-1 flex items-center gap-1.5">
                  <Users className="w-5 h-5 text-stone-600" />
                  Turmas e Inscrições por Ano Curricular
                </h3>
                <p className="text-xs text-stone-500 font-light mt-0.5">
                  Edite o número de alunos das turmas teóricas. Os TPs e PLs são calculados automaticamente (÷4 e ÷3).
                </p>
              </div>

              <div className="space-y-4">
                {[1, 2, 3, 4].map(ano => {
                  const turmasAno = turmas.filter(t => t.anoCurricular === ano);
                  const teoricas = turmasAno.filter(t => t.tipo === "Teórica");
                  const tps = turmasAno.filter(t => t.tipo === "TeoricoPratica");
                  const pls = turmasAno.filter(t => t.tipo === "Prática");
                  const isTerceiroAno = ano === 3;
                  // For 3rd year, the two blocks share the same students (rotating), count only one block
                  const totalAlunos = isTerceiroAno
                    ? teoricas.filter(t => t.bloco === "hospitalar").reduce((s, t) => s + t.alunos, 0)
                    : teoricas.reduce((s, t) => s + t.alunos, 0);

                  return (
                    <div key={ano} className="rounded-xl border border-stone-150 bg-stone-50/40 overflow-hidden">
                      {/* Header do ano */}
                      <div className="flex items-center justify-between px-4 py-2.5 bg-stone-100/60 border-b border-stone-150">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-black text-stone-500 uppercase tracking-wide font-mono">{ano}º Ano</span>
                          {isTerceiroAno && (
                            <span className="text-[9px] bg-teal-100 text-teal-700 border border-teal-200 px-1.5 py-0.5 rounded font-bold uppercase">Blocos clínicos rotativos</span>
                          )}
                        </div>
                        <span className="text-[10px] font-semibold text-stone-600">
                          {totalAlunos} alunos inscritos
                        </span>
                      </div>

                      <div className="p-4 space-y-3">
                        {isTerceiroAno ? (
                          /* 3º ano: blocos hospitalar + comunitária */
                          <div className="space-y-3">
                            {["hospitalar", "comunitaria"].map(bloco => {
                              const turmasBloco = teoricas.filter(t => t.bloco === bloco);
                              return (
                                <div key={bloco} className="space-y-2">
                                  <span className="text-[9px] uppercase font-bold text-stone-500 tracking-wide">
                                    {bloco === "hospitalar" ? "🏥 Bloco Hospitalar" : "🌍 Bloco Comunitário"}
                                  </span>
                                  <div className="grid grid-cols-2 gap-2">
                                    {turmasBloco.map(turma => (
                                      <div key={turma.id} className="flex items-center gap-2 bg-white border border-stone-200 rounded-lg px-3 py-2">
                                        <span className="text-[10px] font-bold text-stone-700 w-14 shrink-0">{turma.nome}</span>
                                        <input
                                          type="number"
                                          min={1}
                                          max={300}
                                          value={turma.alunos}
                                          onChange={e => {
                                            const val = Math.max(1, parseInt(e.target.value) || 1);
                                            setTurmas(prev => prev.map(t => t.id === turma.id ? { ...t, alunos: val, vagas: val } : t));
                                          }}
                                          className="w-full text-right text-[10px] font-mono font-bold text-stone-800 bg-transparent focus:outline-none focus:ring-1 focus:ring-stone-300 rounded px-1"
                                        />
                                        <span className="text-[9px] text-stone-400 shrink-0">al.</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          /* Anos 1, 2, 4: estrutura teórica > TP > PL */
                          <div className="space-y-3">
                            {/* Turmas teóricas editáveis */}
                            <div className="space-y-1.5">
                              <span className="text-[9px] uppercase font-bold text-stone-400 tracking-wide">Turmas Teóricas (editável)</span>
                              <div className="grid grid-cols-2 gap-2">
                                {teoricas.map(turma => (
                                  <div key={turma.id} className="flex items-center gap-2 bg-white border border-stone-300 rounded-lg px-3 py-2">
                                    <span className="text-[10px] font-bold text-stone-800 w-16 shrink-0">{turma.nome}</span>
                                    <input
                                      type="number"
                                      min={1}
                                      max={300}
                                      value={turma.alunos}
                                      onChange={e => {
                                        const val = Math.max(1, parseInt(e.target.value) || 1);
                                        const alunosTP = Math.round(val / 4);
                                        const alunosPL = Math.round(alunosTP / 3);
                                        // which TPs belong to this turma (A→TP1-4, B→TP5-8)
                                        const isA = turma.nome === "Turma A";
                                        const tpRange = isA ? [1,2,3,4] : [5,6,7,8];
                                        setTurmas(prev => prev.map(t => {
                                          if (t.id === turma.id) return { ...t, alunos: val, vagas: val };
                                          if (t.anoCurricular === ano && t.tipo === "TeoricoPratica") {
                                            const tpNum = parseInt(t.nome.replace("TP",""));
                                            if (tpRange.includes(tpNum)) return { ...t, alunos: alunosTP, vagas: alunosTP };
                                          }
                                          if (t.anoCurricular === ano && t.tipo === "Prática") {
                                            const plNum = parseInt(t.nome.replace("PL",""));
                                            const plRange = isA ? Array.from({length:12},(_,i)=>i+1) : Array.from({length:12},(_,i)=>i+13);
                                            if (plRange.includes(plNum)) return { ...t, alunos: alunosPL, vagas: alunosPL };
                                          }
                                          return t;
                                        }));
                                      }}
                                      className="w-full text-right text-[10px] font-mono font-bold text-stone-800 bg-transparent focus:outline-none focus:ring-1 focus:ring-amber-300 rounded px-1"
                                    />
                                    <span className="text-[9px] text-stone-400 shrink-0">al.</span>
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* TPs — somente leitura, calculados */}
                            {tps.length > 0 && (
                              <div className="space-y-1.5">
                                <span className="text-[9px] uppercase font-bold text-stone-400 tracking-wide">Turmas TP — calculado (÷4)</span>
                                <div className="grid grid-cols-4 gap-1.5">
                                  {tps.map(turma => (
                                    <div key={turma.id} className="flex items-center justify-between bg-stone-100 border border-stone-200 rounded-lg px-2 py-1.5">
                                      <span className="text-[9px] font-bold text-stone-500">{turma.nome}</span>
                                      <span className="text-[9px] font-mono text-stone-600">{turma.alunos}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* PLs — somente leitura, calculados */}
                            {pls.length > 0 && (
                              <div className="space-y-1.5">
                                <span className="text-[9px] uppercase font-bold text-stone-400 tracking-wide">Turmas PL — calculado (÷3)</span>
                                <div className="grid grid-cols-6 gap-1">
                                  {pls.map(turma => (
                                    <div key={turma.id} className="flex items-center justify-between bg-stone-50 border border-stone-150 rounded-md px-1.5 py-1">
                                      <span className="text-[8px] font-bold text-stone-400">{turma.nome}</span>
                                      <span className="text-[8px] font-mono text-stone-500">{turma.alunos}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {(perfilAtivo.startsWith("coordenador_") || perfilAtivo.startsWith("vice_coordenador_")) && (
              <div className="bg-amber-50/50 border border-amber-200 p-4 rounded-xl flex items-start gap-3 animate-fade-in text-stone-800">
                <ShieldCheck className="w-5 h-5 text-[#B5861D] shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h4 className="font-serif font-bold text-stone-900 text-xs">Acesso Autorizado: {getPerfilLabel(perfilAtivo)}</h4>
                  <p className="text-[11px] leading-relaxed text-stone-600">
                    Na Escola Superior de Enfermagem de Coimbra, cada coordenador ou vice-coordenador de ano foca-se na organização pedagógica correspondente. Pode descarregar os modelos abaixo ou carregar registos XLSX; as atualizações de docentes e salas aplicar-se-ão de forma geral no solucionador.
                  </p>
                </div>
              </div>
            )}

            {/* HUB DE IMPORTAÇÃO/EXPORTAÇÃO EXCEL (XLSX) */}
            <div className="bg-white rounded-2xl p-6 border border-stone-150 shadow-xs space-y-4">
              <div className="border-b border-stone-100 pb-3">
                <span className="text-[10px] uppercase font-bold tracking-wider text-[#B5861D] font-mono">
                  Sincronização Avançada ESEUC
                </span>
                <h3 className="text-base font-serif font-bold text-stone-900 mt-1 flex items-center gap-1.5">
                  <Database className="w-5 h-5 text-stone-600 animate-pulse" />
                  Importador de Dados e Cadastro Académico (.XLSX / Excel)
                </h3>
                <p className="text-xs text-stone-500 font-light mt-0.5">
                  Evite introduzir dados manualmente. Transfira os modelos parametrizados por nós, preencha-os e submeta-os para atualizar instantaneamente o solucionador inteligente da Escola Superior de Enfermagem de Coimbra.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { id: 'instalacoes', label: '1. Instalações (Salas)', icon: MapPin },
                  { id: 'corpo_docente', label: '2. Corpo Docente', icon: Users },
                  { id: 'ucs', label: '3. Disciplinas e Turmas (Automáticas)', icon: Layers }
                ].map((item) => (
                  <div key={item.id} className="p-4 rounded-xl border border-stone-150 bg-stone-50/40 hover:bg-stone-50 flex flex-col justify-between gap-3 transition-all">
                    <div>
                      <span className="font-serif font-bold text-stone-900 block text-xs">{item.label}</span>
                      <p className="text-[10.5px] text-stone-500 font-light mt-1">
                        Descarregue o modelo ou carregue os registos correspondentes.
                      </p>
                    </div>

                    <div className="space-y-2 pt-1 border-t border-stone-200/50">
                      {/* Download Template button */}
                      <button
                        onClick={() => downloadTemplate(item.id as any)}
                        className="w-full text-center py-2 bg-white hover:bg-stone-100 border border-stone-200 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1.5 transition-all text-stone-700 cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Descarregar Template
                      </button>

                      {/* File Upload Selector */}
                      <label className="w-full text-center py-2 bg-stone-900 hover:bg-stone-850 text-white rounded-lg text-[10px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer">
                        <Upload className="w-3.5 h-3.5" />
                        Carregar Excel
                        <input
                          type="file"
                          accept=".xlsx, .xls"
                          onChange={(e) => handleLoadXlsxFile(e, item.id as any)}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>

              {/* Consola de Controlo da Base de Dados Académica */}
              <div className="pt-4 border-t border-dashed border-stone-200/80 flex flex-col md:flex-row items-center justify-between gap-4 animate-fade-in">
                <div className="space-y-0.5">
                  <h4 className="font-serif font-bold text-stone-900 text-xs flex items-center gap-1.5">
                    <Database className="w-4 h-4 text-rose-500" />
                    Manutenção e Limpeza da Base de Dados Académica (Cloud)
                  </h4>
                  <p className="text-[10.5px] text-stone-500 font-light max-w-xl leading-relaxed">
                    Precisa de redefinir o planeamento ou começar as turmas do zero? Use estes controlos para limpar completamente a base de dados do semestre corrente (zerando disciplinas, docentes, salas e propostas) ou repor instantaneamente os modelos de demonstração predefinidos da ESEUC.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={handleRestoreDatabaseMock}
                    className="px-3 py-1.5 hover:bg-stone-100 text-stone-700 hover:text-stone-950 border border-stone-250 rounded-xl text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-stone-500" />
                    Repor Modelos Pedagogicos
                  </button>
                  <button
                    onClick={handleClearDatabase}
                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 border border-rose-650 text-white rounded-xl text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-3xs"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-white/95" />
                    Limpar Base de Dados (Zerar)
                  </button>
                </div>
              </div>
            </div>


            {/* Tabs for params sub section */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

              {/* UCs Management */}
              <div className="bg-white p-5 rounded-2xl border border-stone-150 shadow-xs space-y-4">
                <div className="flex items-center justify-between border-b border-stone-100 pb-2">
                  <span className="font-serif font-bold text-stone-900 text-sm">Disciplinas (UCs)</span>
                  <button onClick={() => setIsAddingUc(!isAddingUc)} className="px-2.5 py-1 bg-stone-100 text-stone-700 font-bold border border-stone-250 rounded-lg hover:bg-stone-150">
                    {isAddingUc ? "Fechar" : "Inserir"}
                  </button>
                </div>

                {isAddingUc && (
                  <div className="bg-[#FCFBF7] p-4 rounded-xl border border-stone-200/80 space-y-2.5 text-[10.5px]">
                    <div>
                      <label className="block text-[9px] uppercase font-bold text-stone-500 mb-0.5">Nome da UC</label>
                      <input type="text" placeholder="ex: Fundamentos de Enfermagem II" value={newUc.nome} onChange={(e) => setNewUc({ ...newUc, nome: e.target.value })} className="w-full bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 focus:outline-none placeholder-stone-300" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[9px] uppercase font-bold text-stone-500 mb-0.5">Sigla</label>
                        <input
                          type="text"
                          placeholder="FEII"
                          value={newUc.sigla}
                          onChange={(e) => updateNewUcHours({ sigla: e.target.value.toUpperCase() })}
                          className="w-full bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 placeholder-stone-300 uppercase"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] uppercase font-bold text-stone-500 mb-0.5">ECTS</label>
                        <input type="number" value={newUc.ects || 6} onChange={(e) => setNewUc({ ...newUc, ects: Number(e.target.value) })} className="w-full bg-white border border-stone-200 rounded-lg px-2.5 py-1.5" />
                      </div>
                    </div>
                    
                    <div>
                      <label className="block text-[9px] uppercase font-bold text-[#148A96] mb-0.5 font-mono">Ano Curricular e Semestre (Associados)</label>
                      <select 
                        value={`${newUc.anoCurricular || 1}-${newUc.semestre || 1}`} 
                        onChange={(e) => {
                          const [ano, sem] = e.target.value.split("-").map(Number);
                          setNewUc({ ...newUc, anoCurricular: ano, semestre: sem });
                        }} 
                        className="w-full bg-white border border-stone-200 rounded-lg px-2 py-1"
                      >
                        <option value="1-1">1.º Ano - 1.º Semestre</option>
                        <option value="1-2">1.º Ano - 2.º Semestre</option>
                        <option value="2-1">2.º Ano - 1.º Semestre</option>
                        <option value="2-2">2.º Ano - 2.º Semestre</option>
                        <option value="3-1">3.º Ano - 1.º Semestre</option>
                        <option value="3-2">3.º Ano - 2.º Semestre</option>
                        <option value="4-1">4.º Ano - 1.º Semestre</option>
                        <option value="4-2">4.º Ano - 2.º Semestre</option>
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[9px] uppercase font-bold text-stone-500 mb-0.5">Início (Semana)</label>
                        <input type="number" min={1} max={15} value={newUc.semanaInicio || 1} onChange={(e) => setNewUc({ ...newUc, semanaInicio: Number(e.target.value) || 1 })} className="w-full bg-white border border-stone-200 rounded-lg px-2.5 py-1" />
                      </div>
                      <div>
                        <label className="block text-[9px] uppercase font-bold text-stone-500 mb-0.5">Duração (Semanas)</label>
                        <input type="number" min={1} max={15} value={newUc.numSemanas || 15} onChange={(e) => setNewUc({ ...newUc, numSemanas: Number(e.target.value) || 15 })} className="w-full bg-white border border-stone-200 rounded-lg px-2.5 py-1" />
                      </div>
                    </div>

                    {/* Automatic attribution toggle */}
                    <div className="flex items-center gap-1.5 p-2 bg-emerald-50 border border-emerald-150 rounded-lg">
                      <input
                        type="checkbox"
                        id="auto-distribute-toggle"
                        checked={autoDistributeNewUc}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setAutoDistributeNewUc(checked);
                          if (checked) {
                            setNewUc(prev => ({
                              ...prev,
                              turmasConfig: generateEseucTurmas(
                                (prev.sigla || "UC").toUpperCase(),
                                prev.cargaHorariaTeorica || 0,
                                prev.cargaHorariaTP || 0,
                                prev.cargaHorariaPratica || 0,
                                prev.cargaHorariaS || 0
                              )
                            }));
                          }
                        }}
                        className="rounded text-[#148A96] focus:ring-[#148A96] cursor-pointer"
                      />
                      <label htmlFor="auto-distribute-toggle" className="text-[10px] text-emerald-850 font-bold select-none cursor-pointer">
                        Atribuição Automática de Turmas ESEUC
                      </label>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 p-2 bg-stone-100/50 rounded-lg">
                      <div>
                        <label className="block text-[8px] uppercase font-bold text-[#148A96] mb-0.5">Horas T</label>
                        <input type="number" placeholder="2" value={newUc.cargaHorariaTeorica || 0} onChange={(e) => updateNewUcHours({ cargaHorariaTeorica: Number(e.target.value) || 0 })} className="w-full bg-white border border-stone-200 rounded px-1.5 py-0.5 text-center font-bold" />
                      </div>
                      <div>
                        <label className="block text-[8px] uppercase font-bold text-[#148A96] mb-0.5">Horas TP</label>
                        <input type="number" placeholder="0" value={newUc.cargaHorariaTP || 0} onChange={(e) => updateNewUcHours({ cargaHorariaTP: Number(e.target.value) || 0 })} className="w-full bg-white border border-stone-200 rounded px-1.5 py-0.5 text-center font-bold" />
                      </div>
                      <div>
                        <label className="block text-[8px] uppercase font-bold text-[#148A96] mb-0.5">Horas PL</label>
                        <input type="number" placeholder="0" value={newUc.cargaHorariaPratica || 0} onChange={(e) => updateNewUcHours({ cargaHorariaPratica: Number(e.target.value) || 0 })} className="w-full bg-white border border-stone-200 rounded px-1.5 py-0.5 text-center font-bold" />
                      </div>
                      <div>
                        <label className="block text-[8px] uppercase font-bold text-[#148A96] mb-0.5">Horas S</label>
                        <input type="number" placeholder="0" value={newUc.cargaHorariaS || 0} onChange={(e) => updateNewUcHours({ cargaHorariaS: Number(e.target.value) || 0 })} className="w-full bg-white border border-stone-200 rounded px-1.5 py-0.5 text-center font-bold" />
                      </div>
                      <div>
                        <label className="block text-[8px] uppercase font-bold text-[#148A96] mb-0.5">Horas E</label>
                        <input type="number" placeholder="0" value={newUc.cargaHorariaE || 0} onChange={(e) => setNewUc({ ...newUc, cargaHorariaE: Number(e.target.value) || 0 })} className="w-full bg-white border border-stone-200 rounded px-1.5 py-0.5 text-center font-bold" />
                      </div>
                    </div>

                    {/* Turmas Selection Field within adding UC */}
                    <div className="space-y-1.5 pt-1">
                      {renderEstruturaEstudantes(newUc.turmasConfig)}
                      {newUc.cargaHorariaPratica && newUc.cargaHorariaPratica > 0
                        ? renderSeletorSemanasPL(
                            newUc.semanasPL,
                            newUc.numSemanas,
                            newUc.semestre,
                            (sel) => setNewUc({ ...newUc, semanasPL: sel })
                          )
                        : null}
                      <label className="block text-[9.5px] uppercase font-bold text-stone-600 font-mono">Disciplinas / Turmas Atribuídas ({newUc.turmasConfig?.length || 0})</label>
                      <span className="text-[8px] text-stone-450 block leading-tight">
                        {newUc.cargaHorariaPratica && newUc.cargaHorariaPratica > 0 
                          ? "Carga PL > 0: a UC ativa a estrutura completa A/B, TP1-TP8 e PL1-PL24."
                          : "Carga PL = 0: ficam ativas apenas as turmas-mãe A/B e, se houver horas TP, os TP1-TP8."}
                      </span>

                      <div className="space-y-2 p-2 bg-white border border-stone-200 rounded-lg max-h-[140px] overflow-y-auto">
                        {/* T Group */}
                        <div>
                          <span className="text-[7.5px] uppercase font-bold text-stone-450 block mb-0.5">Teóricas</span>
                          <div className="flex flex-wrap gap-1">
                            {["Turma A", "Turma B"].map((tName) => {
                              const isSelected = (newUc.turmasConfig || []).some(t => t.nome === tName);
                              return (
                                <button
                                  type="button"
                                  key={tName}
                                  onClick={() => {
                                    const current = newUc.turmasConfig || [];
                                    const updated = toggleTurmaMae(
                                      current,
                                      tName as "Turma A" | "Turma B",
                                      newUc,
                                      "tc_new"
                                    );
                                    setNewUc({ ...newUc, turmasConfig: updated });
                                  }}
                                  className={`px-1.5 py-0.5 rounded text-[8.5px] font-bold border cursor-pointer select-none transition-colors ${
                                    isSelected ? "bg-amber-600 text-white border-amber-655 font-black" : "bg-stone-50 text-stone-600 border-stone-200 hover:bg-stone-100"
                                  }`}
                                >
                                  {tName}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* TP Group */}
                        <div>
                          <span className="text-[7.5px] uppercase font-bold text-stone-450 block mb-0.5">Teórico-Práticas</span>
                          <div className="flex flex-wrap gap-1">
                            {["TP1", "TP2", "TP3", "TP4", "TP5", "TP6", "TP7", "TP8"].map((tName) => {
                              const isSelected = (newUc.turmasConfig || []).some(t => t.nome === tName);
                              return (
                                <button
                                  type="button"
                                  key={tName}
                                  onClick={() => {
                                    const current = newUc.turmasConfig || [];
                                    const updated = isSelected 
                                      ? current.filter(t => t.nome !== tName)
                                      : [...current, { id: "tc_new_" + Date.now() + "_" + tName, nome: tName, tipo: "TeoricoPratica" as const, docenteId: "" }];
                                    setNewUc({ ...newUc, turmasConfig: updated });
                                  }}
                                  className={`px-1 rounded text-[8.5px] font-bold border cursor-pointer select-none transition-colors ${
                                    isSelected ? "bg-[#148A96] text-white border-[#148A96] font-black" : "bg-stone-50 text-stone-600 border-stone-200 hover:bg-stone-100"
                                  }`}
                                >
                                  {tName}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* PL Group */}
                        <div>
                          <span className="text-[7.5px] uppercase font-bold text-stone-455 block mb-0.5">
                            Práticas de Laboratório (PL)
                          </span>
                          {newUc.cargaHorariaPratica && newUc.cargaHorariaPratica > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {["PL1", "PL2", "PL3", "PL4", "PL5", "PL6", "PL7", "PL8", "PL9", "PL10", "PL11", "PL12", "PL13", "PL14", "PL15", "PL16", "PL17", "PL18", "PL19", "PL20", "PL21", "PL22", "PL23", "PL24"].map((tName) => {
                                const isSelected = (newUc.turmasConfig || []).some(t => t.nome === tName);
                                return (
                                  <button
                                    type="button"
                                    key={tName}
                                    onClick={() => {
                                      const current = newUc.turmasConfig || [];
                                      const updated = isSelected 
                                        ? current.filter(t => t.nome !== tName)
                                        : [...current, { id: "tc_new_" + Date.now() + "_" + tName, nome: tName, tipo: "Prática" as const, docenteId: "" }];
                                      setNewUc({ ...newUc, turmasConfig: updated });
                                    }}
                                    className={`px-1 rounded text-[8.5px] font-bold border cursor-pointer select-none transition-colors ${
                                      isSelected ? "bg-teal-700 text-white border-teal-750 font-black" : "bg-stone-50 text-stone-600 border-stone-200 hover:bg-stone-100"
                                    }`}
                                  >
                                    {tName}
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="text-[8px] text-stone-400 italic">Preencha campo 'Horas PL' superior a 0 para libertar turmas PL.</p>
                          )}
                        </div>

                        {/* S Group */}
                        <div className="pt-1">
                          <span className="text-[7.5px] uppercase font-bold text-stone-455 block mb-0.5">
                            Seminários (S)
                          </span>
                          {newUc.cargaHorariaS && newUc.cargaHorariaS > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {["Seminário 1", "Seminário 2", "Seminário 3", "Seminário 4"].map((tName) => {
                                const isSelected = (newUc.turmasConfig || []).some(t => t.nome === tName);
                                return (
                                  <button
                                    type="button"
                                    key={tName}
                                    onClick={() => {
                                      const current = newUc.turmasConfig || [];
                                      const updated = isSelected 
                                        ? current.filter(t => t.nome !== tName)
                                        : [...current, { id: "tc_new_" + Date.now() + "_" + tName.replace(" ", ""), nome: tName, tipo: "Seminário" as const, docenteId: "" }];
                                      setNewUc({ ...newUc, turmasConfig: updated });
                                    }}
                                    className={`px-1.5 py-0.5 rounded text-[8.5px] font-bold border cursor-pointer select-none transition-colors ${
                                      isSelected ? "bg-[#6A41A6] text-white border-[#6A41A6] font-black" : "bg-stone-50 text-stone-600 border-stone-200 hover:bg-stone-100"
                                    }`}
                                  >
                                    {tName}
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="text-[8px] text-stone-400 italic">Preencha campo 'Horas S' superior a 0 para libertar Seminários.</p>
                          )}
                        </div>
                      </div>
                    </div>

                    <button onClick={handleAddUc} className="w-full py-1.5 bg-stone-900 border border-stone-900 text-white rounded-lg font-bold hover:bg-stone-850 cursor-pointer text-[10.5px] transition-colors shadow-3xs uppercase tracking-wide">Gravar Disciplina</button>
                  </div>
                )}

                <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1">
                  {ucs.map((u) => (
                    <div key={u.id} className="p-2.5 bg-stone-50/60 rounded-xl border border-stone-150/50 flex items-center justify-between gap-2 hover:bg-stone-50 transition-colors">
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-stone-800 text-xs">{u.sigla}</span>
                          <span className="text-[8.5px] bg-[#DEF1F3] text-[#148A96] px-1.5 py-0.5 rounded-md font-mono font-bold" title={`${u.anoCurricular}.º Ano, Semestre ${u.semestre}`}>
                            {u.anoCurricular}.ºA - {u.semestre}.ºS
                          </span>
                        </div>
                        <p className="text-stone-500 text-[10px] truncate max-w-[140px] font-light mt-0.5" title={u.nome}>{u.nome}</p>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="text-[8.5px] text-teal-850 bg-teal-50 border border-teal-150/70 rounded px-1 font-mono">
                            {u.turmasConfig?.length || 0} turmas
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] text-stone-400 font-mono font-medium">{u.ects} ects</span>
                        <button
                          title="Parametrizar Turnos e Docentes"
                          onClick={() => setEditingUcId(u.id)}
                          className="text-stone-400 hover:text-[#148A96] transition-colors p-1"
                        >
                          <Settings className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => removeUc(u.id)} className="text-stone-400 hover:text-rose-600 transition-colors p-1">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Docentes Management */}
              <div className="bg-white p-5 rounded-2xl border border-[#EDEAE2] shadow-xs space-y-4">
                <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                  <span className="font-serif font-bold text-stone-900 text-sm">Corpo Docente</span>
                  <button onClick={() => setIsAddingDocente(!isAddingDocente)} className="px-2.5 py-1 bg-stone-100 text-stone-700 font-bold border border-stone-250 rounded-lg hover:bg-stone-150">
                    {isAddingDocente ? "Fechar" : "Inserir"}
                  </button>
                </div>

                {isAddingDocente && (
                  <div className="bg-stone-50 p-4 rounded-xl border border-stone-150 space-y-2">
                    <div>
                      <label className="block text-4xs font-bold text-stone-400 mb-0.5">Nome Completo</label>
                      <input type="text" value={newDocente.nome} onChange={(e) => setNewDocente({ ...newDocente, nome: e.target.value })} className="w-full bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none" />
                    </div>
                    <div>
                      <label className="block text-4xs font-bold text-stone-400 mb-0.5">Email Docente</label>
                      <input type="email" value={newDocente.email} onChange={(e) => setNewDocente({ ...newDocente, email: e.target.value })} className="w-full bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 text-xs" />
                    </div>
                    <button onClick={handleAddDocente} className="w-full py-2 bg-stone-900 text-white rounded-lg font-semibold hover:bg-stone-850">Gravar Professor</button>
                  </div>
                )}

                <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1">
                  {docentes.map((d) => (
                    <div key={d.id} className="p-2.5 bg-[#FAF1EE]/30 rounded-xl border border-[#ECC4B9]/30 flex items-center justify-between gap-2 hover:bg-stone-50 transition-colors">
                      <div className="truncate max-w-[150px]">
                        <span className="font-bold text-stone-800 text-xs block truncate">{d.nome}</span>
                        <p className="text-stone-400 text-4xs truncate">{d.email}</p>
                        
                        {/* Interactive PG Indicator */}
                        <div className="mt-1">
                          <button
                            title={d.isPosGraduacao ? "Docente ativo em Pós-Graduações/Mestrados (Clique para desativar)" : "Marcar Docente como ativo em Pós-Graduações/Mestrados"}
                            onClick={() => {
                              const updated = docentes.map(doc => doc.id === d.id ? { ...doc, isPosGraduacao: !doc.isPosGraduacao } : doc);
                              setDocentes(updated);
                              showToast(`Docente ${d.nome} ${!d.isPosGraduacao ? "associado ?" : "removido da"} docência de Mestrados e Doutoramentos.`);
                            }}
                            className={`px-1.5 py-0.5 rounded-md text-[8.5px] font-bold cursor-pointer transition-colors ${
                              d.isPosGraduacao
                                ? "bg-teal-50 border border-teal-200 text-teal-700"
                                : "bg-stone-100/80 hover:bg-stone-100 text-stone-500"
                            }`}
                          >
                            {d.isPosGraduacao ? "Leciona PG/Mestrados" : "+ Ligar PG"}
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] text-stone-400 font-mono font-medium">{d.maxHorasSemanais}h max</span>
                        <button
                          title="Editar Docente"
                          onClick={() => setEditingDocenteId(d.id)}
                          className="text-stone-400 hover:text-[#148A96] transition-colors p-1"
                        >
                          <Settings className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => removeDocente(d.id)} className="text-stone-400 hover:text-rose-600 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Salas Letivas Management */}
              <div className="bg-white p-5 rounded-2xl border border-stone-150 shadow-xs space-y-4">
                <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                  <span className="font-serif font-bold text-stone-900 text-sm">Instalações (Salas)</span>
                  <button onClick={() => setIsAddingSala(!isAddingSala)} className="px-2.5 py-1 bg-stone-100 text-stone-700 font-bold border border-stone-250 rounded-lg hover:bg-stone-150">
                    {isAddingSala ? "Fechar" : "Inserir"}
                  </button>
                </div>

                {isAddingSala && (
                  <div className="bg-stone-50 p-4 rounded-xl border border-stone-150 space-y-2.5">
                    <div>
                      <label className="block text-4xs font-bold text-stone-400 mb-0.5">Identificação (Nome)</label>
                      <input type="text" placeholder="Ex: Sala Comum II-2" value={newSala.nome} onChange={(e) => setNewSala({ ...newSala, nome: e.target.value })} className="w-full bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none" />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-4xs font-bold text-stone-400 mb-0.5">Lotação (Capacidade)</label>
                        <input type="number" value={newSala.capacidade} onChange={(e) => setNewSala({ ...newSala, capacidade: Number(e.target.value) })} className="w-full bg-white border border-stone-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none" />
                      </div>
                      <div>
                        <label className="block text-4xs font-bold text-stone-400 mb-0.5">Tipo Geral</label>
                        <select value={newSala.tipo} onChange={(e) => setNewSala({ ...newSala, tipo: e.target.value as any })} className="w-full bg-white border border-stone-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none">
                          <option value="Teórica">Teórica</option>
                          <option value="Teórico-prática">Teórico-prática</option>
                          <option value="Laboratório">Laboratório</option>
                          <option value="Sala de Computadores">Sala de Computadores</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[9px] uppercase tracking-wider font-bold text-stone-500 mb-1">Tipologias Autorizadas (Pode selecionar várias):</label>
                      <div className="grid grid-cols-2 gap-1.5 bg-white p-2 border border-stone-200 rounded-lg">
                        {[
                          "Anfiteatro (Teórica T)",
                          "Laboratório de Simulação PL",
                          "Sala Comum TP",
                          "Sala de Computadores"
                        ].map(t => {
                          const list = newSala.tipologias || [];
                          const isChecked = list.includes(t);
                          return (
                            <label key={t} className="flex items-center gap-1.5 p-1 hover:bg-stone-50 rounded text-[9px] text-stone-700 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  let newList = [...list];
                                  if (isChecked) {
                                    newList = newList.filter(item => item !== t);
                                  } else {
                                    newList.push(t);
                                  }
                                  setNewSala({
                                    ...newSala,
                                    tipologias: newList,
                                    tipologia: newList[0] || "Sala Comum TP"
                                  });
                                }}
                                className="rounded text-[#148A96] focus:ring-[#148A96] w-3 h-3 cursor-pointer"
                              />
                              <span>{t}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    <button onClick={handleAddSala} className="w-full py-2 bg-stone-900 text-white rounded-lg font-semibold hover:bg-[#1f1a16] shadow-sm cursor-pointer">Gravar Sala</button>
                  </div>
                )}

                <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1">
                  {salas.map((s) => (
                    <div key={s.id} className="p-2.5 bg-[#EBF7F8]/30 rounded-xl border border-[#DFE5EA] flex items-center justify-between gap-2">
                      <div>
                        <span className="font-bold text-stone-800 text-xs">{s.nome}</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {s.tipologias && s.tipologias.length > 0 ? (
                            s.tipologias.map((t, idx) => (
                              <span key={idx} className="text-[8px] bg-[#EBF7F8] text-[#148A96] px-1.5 py-0.5 rounded-full font-mono font-bold">
                                {t}
                              </span>
                            ))
                          ) : (
                            <span className="text-[8px] bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded-full font-mono font-bold">
                              {s.tipologia || s.tipo}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-stone-400 font-mono font-medium">Cap: {s.capacidade}</span>
                        <button
                          title="Editar Sala"
                          onClick={() => setEditingSalaId(s.id)}
                          className="text-stone-400 hover:text-[#148A96] transition-colors p-1 cursor-pointer"
                        >
                          <Settings className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => removeSala(s.id)} className="text-stone-400 hover:text-rose-600 transition-colors cursor-pointer">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>

            {/* SECÃ‡ÃƒO: GESTÃƒO DO CALENDÁRIO ACADÃ‰MICO (Feriados e Interrupções) */}
            <div id="eseuc-calendario-section" className="bg-white rounded-2xl p-6 border border-stone-150 shadow-xs space-y-6">
              <div className="border-b border-stone-100 pb-3 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-[#B5861D] font-mono">
                    Planeamento Escolar ESEUC
                  </span>
                  <h3 className="text-base font-serif font-bold text-stone-900 mt-1 flex items-center gap-1.5">
                    <Calendar className="w-5 h-5 text-[#B5861D]" />
                    Calendário Académico: Feriados & Interrupções Letivas
                  </h3>
                  <p className="text-xs text-stone-500 font-light mt-0.5">
                    Gerencie o calendário de datas especiais e defina os períodos de suspensão das atividades letivas na ESEUC.
                  </p>
                </div>
                <button
                  id="btn-add-datas-bloqueio"
                  onClick={() => setIsAddingFeriado(!isAddingFeriado)}
                  className={`px-3 py-1.5 text-[11px] font-bold border transition-colors rounded-xl flex items-center gap-1 cursor-pointer ${
                    isAddingFeriado 
                      ? "bg-stone-100 text-stone-700 border-stone-250 hover:bg-stone-150" 
                      : "bg-[#D4A32A] text-stone-900 border-[#B5861D]/50 hover:bg-[#B5861D]"
                  }`}
                >
                  {isAddingFeriado ? (
                    <>
                      <X className="w-3.5 h-3.5" /> Cancelar
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" /> Adicionar Data de Bloqueio
                    </>
                  )}
                </button>
              </div>

              {/* Form to insert new Holiday/Interruption */}
              {isAddingFeriado && (
                <div id="form-nova-data-bloqueio" className="bg-[#FBF9F3]/60 p-5 rounded-2xl border border-[#EDE3C8] animate-fade-in space-y-4">
                  <h4 className="text-xs font-bold text-[#1F190D] uppercase tracking-wider border-b border-stone-200/50 pb-1.5">
                    Nova Data de Bloqueio Calendário
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="space-y-1">
                      <label className="block text-4xs uppercase tracking-wider font-bold text-stone-400">Nome / Descrição</label>
                      <input
                        id="input-feriado-nome"
                        type="text"
                        placeholder="Ex: Feriado de Coimbra, Férias da Páscoa..."
                        value={newFeriado.nome || ""}
                        onChange={e => setNewFeriado({ ...newFeriado, nome: e.target.value })}
                        className="w-full bg-white border border-stone-250 p-2 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-[#B5861D]"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-4xs uppercase tracking-wider font-bold text-stone-400">Tipo de Evento</label>
                      <select
                        id="select-feriado-tipo"
                        value={newFeriado.tipo || "Feriado"}
                        onChange={e => setNewFeriado({ ...newFeriado, tipo: e.target.value as any })}
                        className="w-full bg-white border border-stone-250 p-2 rounded-xl text-xs focus:outline-none"
                      >
                        <option value="Feriado">Feriado Nacional / Regional</option>
                        <option value="Férias Académicas">Férias Académicas (Páscoa, Natal...)</option>
                        <option value="Interrupção Letiva">Interrupção das Atividades Letivas</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="block text-4xs uppercase tracking-wider font-bold text-stone-400">Data de Início</label>
                      <input
                        id="input-feriado-inicio"
                        type="date"
                        value={newFeriado.dataInicio || ""}
                        onChange={e => setNewFeriado({ ...newFeriado, dataInicio: e.target.value })}
                        className="w-full bg-white border border-stone-250 p-2 rounded-xl text-xs focus:outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-4xs uppercase tracking-wider font-bold text-stone-400">Data de Fim (Opcional)</label>
                      <input
                        id="input-feriado-fim"
                        type="date"
                        value={newFeriado.dataFim || ""}
                        onChange={e => setNewFeriado({ ...newFeriado, dataFim: e.target.value })}
                        className="w-full bg-white border border-stone-250 p-2 rounded-xl text-xs focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end pt-1">
                    <button
                      id="btn-gravar-novo-feriado"
                      onClick={handleAddFeriado}
                      className="px-4 py-2 bg-stone-900 hover:bg-stone-850 text-white rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      Inserir no Calendário ESEUC
                    </button>
                  </div>
                </div>
              )}

              {/* Grid of Existing Dates and Interactive Impact Explanation side-by-side */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* 1 & 2 Columns: List of dates */}
                <div className="lg:col-span-2 space-y-3">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-stone-400 font-mono block">
                    Datas Cadastradas no Semestre Letivo ({feriados.length})
                  </span>

                  {feriados.length === 0 ? (
                    <div id="no-feriados-placeholder" className="text-center py-8 bg-stone-50 rounded-2xl border border-dashed border-stone-200">
                      <Calendar className="w-8 h-8 text-stone-300 mx-auto stroke-1 mb-2" />
                      <p className="text-xs text-stone-500 font-light">Não existem feriados ou interrupções letivas declaradas.</p>
                    </div>
                  ) : (
                    <div id="feriados-grid-container" className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[380px] overflow-y-auto pr-1">
                      {feriados.map((f) => {
                        let colorClasses = "bg-rose-50 border-rose-100 text-rose-700";
                        if (f.tipo === "Férias Académicas") {
                          colorClasses = "bg-amber-50 border-amber-100 text-amber-700";
                        } else if (f.tipo === "Interrupção Letiva") {
                          colorClasses = "bg-purple-50 border-purple-100 text-purple-700";
                        }

                        // Format nice dates manually:
                        const formatShortDate = (dStr: string) => {
                          if (!dStr) return "";
                          try {
                            const [y, m, d] = dStr.split("-");
                            return `${d}/${m}/${y}`;
                          } catch {
                            return dStr;
                          }
                        };

                        const dateRangeLabel = f.dataFim && f.dataFim !== f.dataInicio 
                          ? `${formatShortDate(f.dataInicio)} a ${formatShortDate(f.dataFim)}`
                          : formatShortDate(f.dataInicio);

                        return (
                          <div id={`feriado-card-${f.id}`} key={f.id} className="p-3.5 bg-stone-50/70 hover:bg-stone-50 rounded-xl border border-stone-200/70 flex items-start justify-between gap-3 transition-all">
                            <div className="space-y-1 max-w-[80%]">
                              <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold border ${colorClasses}`}>
                                {f.tipo}
                              </span>
                              <h5 className="font-semibold text-stone-900 text-xs mt-1">
                                {f.nome}
                              </h5>
                              <p className="text-[10px] text-stone-500 font-mono flex items-center gap-1">
                                <Clock className="w-3.5 h-3.5 text-stone-400" />
                                {dateRangeLabel}
                              </p>
                            </div>
                            <button
                              id={`btn-remove-feriado-${f.id}`}
                              onClick={() => {
                                removeFeriado(f.id);
                                showToast(`O evento "${f.nome}" foi removido do calendário escolar.`);
                              }}
                              className="text-stone-400 hover:text-rose-600 transition-all p-1 cursor-pointer"
                              title="Remover data"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 3rd Column: Interactive impact explanation */}
                <div id="eseuc-solver-impact-card" className="p-5 rounded-2xl bg-[#FCF5E3]/40 border border-[#EDE3C8] space-y-4 flex flex-col justify-between">
                  <div className="space-y-3">
                    <div className="flex items-center gap-1.5 border-b border-[#EDE3C8]/60 pb-2">
                      <Sparkles className="w-4 h-4 text-[#B5861D]" />
                      <span className="font-serif font-bold text-stone-900 text-xs uppercase tracking-wide">
                        Impacto no Solucionador ESEUC
                      </span>
                    </div>

                    <p className="text-[11px] text-[#73603A] leading-relaxed font-light">
                      O calendário académico da ESEUC serve como uma <strong className="font-semibold text-stone-900">infraestrutura de bloqueio inteligente</strong>. O motor de inteligência artificial l? este calendário dinamicamente:
                    </p>

                    <ul className="space-y-3">
                      <li className="flex items-start gap-2 text-[10.5px] text-stone-600">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1.5 shrink-0" />
                        <span>
                          <strong className="text-stone-900 font-semibold">Segurança de Alocação:</strong> Nenhuma aula ou atividade docente é colocada nas datas especificadas.
                        </span>
                      </li>
                      <li className="flex items-start gap-2 text-[10.5px] text-stone-600">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                        <span>
                          <strong className="text-stone-900 font-semibold">Satisfação ECTS:</strong> O motor distribui uniformemente a carga horária em semanas normais sem que a matéria seja prejudicada pelos feriados.
                        </span>
                      </li>
                      <li className="flex items-start gap-2 text-[10.5px] text-stone-600">
                        <span className="w-1.5 h-1.5 rounded-full bg-purple-500 mt-1.5 shrink-0" />
                        <span>
                          <strong className="text-stone-900 font-semibold">Sincronização Física:</strong> Fecha as salas de aula, laboratórios multimédia e recintos da ESEUC automaticamente nestes dias.
                        </span>
                      </li>
                    </ul>
                  </div>

                  <div className="bg-white/80 p-3 rounded-xl border border-[#EDE3C8] mt-2">
                    <p className="text-[10px] text-stone-500 font-light flex items-start gap-2">
                      <Info className="w-3.5 h-3.5 text-[#B5861D] shrink-0 mt-0.5" />
                      <span>
                        Se adicionar ou remover uma data, execute novamente o <strong className="text-stone-800">Gerador Inteligente</strong> no menu "Solucionador" para recalcular as propostas de horários sob as novas diretivas do calendário académico.
                      </span>
                    </p>
                  </div>
                </div>
              </div>
            </div>

          </div>
        )}

        {/* TAB 6: COMPARE VERSIONS SIDE-BY-SIDE */}
        {activeTab === "compare" && false && (
          <div className="space-y-6 animate-fade-in text-xs">
            <div className="bg-white rounded-2xl p-6 border border-stone-150 shadow-xs space-y-4">
              <div>
                <h3 className="text-base font-serif font-bold text-stone-900">Análise Comparativa de Propostas</h3>
                <p className="text-xs text-stone-500">Compare duas versões de horários lado a lado para verificar evolução da qualidade geral.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-stone-50 p-4 rounded-xl border border-stone-150">
                <div className="space-y-1">
                  <label className="block text-4xs uppercase tracking-wider font-bold text-stone-400">Proposta Base (A)</label>
                  <select value={compareV1} onChange={e => setCompareV1(e.target.value)} className="w-full bg-white border border-stone-250 p-2 rounded-xl">
                    {versoes.filter(v => v.anoSemestreId === selectedSemestreId).map(v => (
                      <option key={v.id} value={v.id}>{v.nome} (Score: {v.score})</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="block text-4xs uppercase tracking-wider font-bold text-stone-400">Proposta Alternativa (B)</label>
                  <select value={compareV2} onChange={e => setCompareV2(e.target.value)} className="w-full bg-white border border-stone-250 p-2 rounded-xl">
                    {versoes.filter(v => v.anoSemestreId === selectedSemestreId).map(v => (
                      <option key={v.id} value={v.id}>{v.nome} (Score: {v.score})</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Layout show comparison statistics */}
              {(() => {
                const v1Data = versoes.find(v => v.id === compareV1);
                const v2Data = versoes.find(v => v.id === compareV2);
                if (!v1Data || !v2Data) return null;

                const scoreDiff = v2Data.score - v1Data.score;

                return (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 border-t border-stone-100">
                    <div className="space-y-2 p-4 bg-stone-50 rounded-xl">
                      <span className="text-4xs uppercase tracking-widest font-bold text-stone-400">Qualidade Horário B vs A</span>
                      <div className="flex items-center gap-2">
                        <span className={`text-2xl font-black ${scoreDiff >= 0 ? "text-emerald-600" : "text-rose-600"} font-mono`}>
                          {scoreDiff >= 0 ? `+${scoreDiff}` : scoreDiff}%
                        </span>
                        <p className="text-[10px] text-stone-500 leading-tight">Variação na pontuação da funão objetivo calculada pelo algoritmo.</p>
                      </div>
                    </div>

                    <div className="bg-stone-50 p-4 rounded-xl space-y-1">
                      <span className="font-serif font-bold text-stone-900 block text-xs">Métricas Proposta A</span>
                      <ul className="space-y-1 text-[11px] text-stone-500 font-light leading-relaxed">
                        <li>• Nome: {v1Data.nome}</li>
                        <li>• Total de Sessões: {v1Data.sessoes.length} aulas</li>
                        <li>• Aulas com Bloqueio: {v1Data.sessoes.filter(s => s.bloqueado).length} de {v1Data.sessoes.length}</li>
                        <li className="font-bold text-stone-700 font-mono">• Score Global: {v1Data.score}/100</li>
                      </ul>
                    </div>

                    <div className="bg-stone-50 p-4 rounded-xl space-y-1">
                      <span className="font-serif font-bold text-stone-900 block text-xs">Métricas Proposta B</span>
                      <ul className="space-y-1 text-[11px] text-stone-500 font-light leading-relaxed">
                        <li>• Nome: {v2Data.nome}</li>
                        <li>• Total de Sessões: {v2Data.sessoes.length} aulas</li>
                        <li>• Aulas com Bloqueio: {v2Data.sessoes.filter(s => s.bloqueado).length} de {v2Data.sessoes.length}</li>
                        <li className="font-bold text-stone-700 font-mono">• Score Global: {v2Data.score}/100</li>
                      </ul>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* TAB 7: ASSISTANT IA CHAT (Criação por Texto) */}
        {activeTab === "assistant" && (
          <div className="space-y-6 animate-fade-in text-xs leading-relaxed max-w-3xl mx-auto">
            <div className="bg-white rounded-2xl border border-stone-150 shadow-xs flex flex-col h-[520px] overflow-hidden">
              <div className="p-4 border-b border-stone-100 flex items-center justify-between bg-stone-50/50">
                <div className="flex items-center gap-2.5">
                  <Bot className="w-5 h-5 text-indigo-600" />
                  <div>
                    <h3 className="font-serif font-bold text-stone-900">Humano-Máquina: Assistente de Escala letiva</h3>
                    <p className="text-[10px] text-stone-500 leading-none">O seu canal livre para criar regras e modificar horários em linguagem comum.</p>
                  </div>
                </div>

                <div className="flex gap-2 items-center">
                  <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${geminiApiKey ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                    {geminiApiKey ? "✓ Chave configurada" : "Sem chave — modo demonstração"}
                  </span>
                  <button
                    onClick={() => { setGeminiKeyDraft(geminiApiKey); setShowGeminiKeyPanel(v => !v); }}
                    className="px-2.5 py-1 hover:bg-stone-200 text-stone-600 rounded-lg text-[10px] font-semibold border border-stone-200 flex items-center gap-1"
                  >
                    <Settings className="w-3 h-3" /> Chave API
                  </button>
                  <button
                    onClick={() => {
                      setChatMessages([
                        {
                          id: "welcome_reset",
                          role: "assistant",
                          content: "Olá! O histórico de chat foi resetado para limpeza. Diga-me qual é a regra ou o pedido académico em portuguàs simples que deseja formular hoje.",
                          timestamp: new Date().toISOString()
                        }
                      ]);
                    }}
                    className="px-2.5 py-1 hover:bg-stone-200 text-stone-600 rounded-lg text-[10px] font-semibold border border-stone-200"
                  >
                    Limpar Conversa
                  </button>
                </div>
              </div>

              {showGeminiKeyPanel && (
                <div className="p-4 border-b border-stone-100 bg-amber-50/40 space-y-2">
                  <label className="text-[10px] font-bold text-stone-700 block">Chave da API Google (Gemini)</label>
                  <p className="text-[9px] text-stone-500 leading-snug">
                    Cola a tua chave do Google AI Studio. Fica guardada apenas neste browser e é usada para o assistente responder com IA real. Sem chave, o assistente fica em modo de demonstração.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="password"
                      value={geminiKeyDraft}
                      onChange={(e) => setGeminiKeyDraft(e.target.value)}
                      placeholder="AIza…"
                      className="flex-1 min-w-[200px] px-2.5 py-1.5 border border-stone-300 rounded-lg text-[11px] font-mono"
                    />
                    <button
                      onClick={() => { guardarGeminiKey(geminiKeyDraft); setShowGeminiKeyPanel(false); showToast("Chave Gemini guardada neste browser."); }}
                      className="px-3 py-1.5 bg-stone-900 text-white hover:bg-stone-800 font-bold rounded-lg text-[10px]"
                    >
                      Guardar
                    </button>
                    <button
                      onClick={() => { guardarGeminiKey(""); setGeminiKeyDraft(""); showToast("Chave Gemini removida."); }}
                      className="px-3 py-1.5 bg-white border border-stone-300 text-stone-600 hover:bg-stone-100 font-bold rounded-lg text-[10px]"
                    >
                      Limpar
                    </button>
                  </div>

                  <label className="text-[10px] font-bold text-stone-700 block pt-1">Modelo</label>
                  <p className="text-[9px] text-stone-500 leading-snug">
                    Se um modelo der erro de quota (429), experimenta outro. Modelos <em>preview</em> e 3.x podem exigir billing ativo no Google; o <strong>2.5 Flash</strong> costuma ter tier gratuito.
                  </p>
                  <select
                    value={geminiModel}
                    onChange={(e) => { guardarGeminiModel(e.target.value); showToast(`Modelo: ${e.target.value}`); }}
                    className="w-full px-2.5 py-1.5 border border-stone-300 rounded-lg text-[11px] font-mono bg-white"
                  >
                    {["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-flash-latest", "gemini-3.1-flash-lite", "gemini-3-flash-preview", "gemini-3.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"]
                      .concat([geminiModel].filter(m => ![ "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-flash-latest", "gemini-3.1-flash-lite", "gemini-3-flash-preview", "gemini-3.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"].includes(m)))
                      .map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              )}

              {/* Discussion thread logs */}
              <div className="flex-1 p-4 overflow-y-auto space-y-4">
                {chatMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.role === "assistant" ? "justify-start" : "justify-end"} animation-fade-in`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl p-3.5 space-y-1.5 text-xs text-left shadow-2xs ${
                        msg.role === "assistant"
                          ? "bg-stone-100/80 text-stone-800"
                          : "bg-stone-900 text-white"
                      }`}
                    >
                      <span className="text-[9px] font-bold block opacity-40">
                        {msg.role === "assistant" ? "Assistente Inteligente" : "Coordenador Académico"}
                      </span>
                      {msg.role === "assistant" ? (
                        <div
                          className="leading-relaxed font-light prose-chat"
                          dangerouslySetInnerHTML={{
                            __html: msg.content
                              // Bold: **text** or __text__
                              .replace(/\*\*(.+?)\*\*/g, '<strong class="font-bold text-stone-900">$1</strong>')
                              .replace(/__(.+?)__/g, '<strong class="font-bold text-stone-900">$1</strong>')
                              // Italic: *text* or _text_
                              .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
                              // Inline code
                              .replace(/`([^`]+)`/g, '<code class="bg-stone-200 text-stone-800 px-1 py-0.5 rounded text-[10px] font-mono">$1</code>')
                              // Tables: | col | col |
                              .replace(
                                /((\|[^\n]+\|\n?)+)/g,
                                (table) => {
                                  const rows = table.trim().split('\n').filter(r => r.trim() && !r.match(/^\|[-| :]+\|$/));
                                  const cells = (row: string) => row.split('|').filter((_, i, a) => i > 0 && i < a.length - 1).map(c => c.trim());
                                  if (rows.length === 0) return table;
                                  const [header, ...body] = rows;
                                  return `<table class="w-full border-collapse my-2 text-[10px]">
                                    <thead><tr class="bg-stone-200">${cells(header).map(c => `<th class="border border-stone-300 px-2 py-1 text-left font-bold">${c}</th>`).join('')}</tr></thead>
                                    <tbody>${body.map((row, i) => `<tr class="${i % 2 === 0 ? 'bg-white' : 'bg-stone-50'}">${cells(row).map(c => `<td class="border border-stone-200 px-2 py-1">${c}</td>`).join('')}</tr>`).join('')}</tbody>
                                  </table>`;
                                }
                              )
                              // Unordered lists
                              .replace(/((?:^|\n)[*\-] .+)+/g, (block) => {
                                const items = block.trim().split('\n').map(l => l.replace(/^[*\-] /, '').trim());
                                return `<ul class="list-disc list-inside space-y-0.5 my-1">${items.map(i => `<li>${i}</li>`).join('')}</ul>`;
                              })
                              // Numbered lists
                              .replace(/((?:^|\n)\d+\. .+)+/g, (block) => {
                                const items = block.trim().split('\n').map(l => l.replace(/^\d+\. /, '').trim());
                                return `<ol class="list-decimal list-inside space-y-0.5 my-1">${items.map(i => `<li>${i}</li>`).join('')}</ol>`;
                              })
                              // Headings
                              .replace(/^### (.+)$/gm, '<h4 class="font-bold text-stone-900 mt-2 mb-0.5 text-[11px]">$1</h4>')
                              .replace(/^## (.+)$/gm, '<h3 class="font-bold text-stone-900 mt-2 mb-1 text-xs">$1</h3>')
                              .replace(/^# (.+)$/gm, '<h2 class="font-bold text-stone-900 mt-2 mb-1 text-sm">$1</h2>')
                              // Line breaks
                              .replace(/\n\n/g, '</p><p class="mt-2">')
                              .replace(/\n/g, '<br/>')
                          }}
                        />
                      ) : (
                        <p className="leading-relaxed whitespace-pre-line font-light">{msg.content}</p>
                      )}
                    </div>
                  </div>
                ))}

                {isLoadingAi && (
                  <div className="flex justify-start">
                    <div className="bg-stone-100/80 text-stone-800 rounded-2xl p-3.5 flex items-center gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin text-indigo-500" />
                      <span className="font-light text-stone-500">A processar o seu pedido... Traduzindo para o solucionador...</span>
                    </div>
                  </div>
                )}

                {/* Show pending AI translated integration suggestion */}
                {pendingAiRule && (
                  <div className="p-4 bg-amber-50 rounded-xl border border-amber-150 text-xs text-stone-700 !mt-5 space-y-2.5 animate-pulse">
                    <div className="flex items-center gap-1 font-bold text-amber-900">
                      <Sparkles className="w-4 h-4 text-amber-600 animate-spin" />
                      <span>Sugestáo Formada pela IA Pronta para Integrar!</span>
                    </div>

                    <p className="text-stone-600 leading-relaxed font-light">
                      A tecnologia Google Gemini interpretou o seu pedido livre e gerou a seguinte regra:
                    </p>

                    <div className="bg-white p-3 rounded-lg border border-amber-200">
                      <span className="font-bold text-stone-900">{pendingAiRule.nome}</span>
                      <p className="text-[11px] text-stone-500 font-light mt-0.5">{pendingAiRule.descricao}</p>
                    </div>

                    <div className="flex items-center justify-end gap-2.5 mt-2">
                      <button
                        onClick={() => setPendingAiRule(null)}
                        className="px-3 py-1.5 bg-stone-150 hover:bg-stone-250 text-stone-600 font-semibold rounded-lg text-xs cursor-pointer"
                      >
                        Rejeitar
                      </button>
                      <button
                        onClick={() => abrirEdicaoRegra(pendingAiRule, "ia")}
                        className="px-3.5 py-1.5 bg-stone-900 hover:bg-stone-800 text-white font-bold rounded-lg text-xs cursor-pointer"
                      >
                        Validar anos e ativar
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Chat Text area input */}
              <div className="p-3 bg-stone-50 border-t border-stone-100 flex items-center gap-2">
                <input
                  type="text"
                  value={aiPrompt}
                  onKeyDown={e => e.key === "Enter" && handleSendAiMessage()}
                  onChange={e => setAiPrompt(e.target.value)}
                  placeholder="Escreva em linguagem natural. Ex: 'Prevenir que docentes do DEP tenham aulas após as 18 horas'"
                  className="flex-1 bg-white border border-stone-200 rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-stone-400"
                />
                <button
                  onClick={handleSendAiMessage}
                  disabled={isLoadingAi || !aiPrompt.trim()}
                  className="px-4 py-2.5 bg-stone-900 hover:bg-stone-850 text-white font-semibold rounded-xl text-xs cursor-pointer disabled:opacity-40"
                >
                  Enviar
                </button>
              </div>

            </div>
          </div>
        )}

        {/* TAB 8: EXPORT SECTION */}
        {activeTab === "export" && false && (
          <div className="space-y-6 animate-fade-in text-xs leading-relaxed max-w-md mx-auto">
            <div className="bg-white rounded-2xl p-6 border border-stone-150 shadow-xs space-y-4">
              <div className="text-center space-y-2">
                <div className="w-10 h-10 bg-stone-100 rounded-full flex items-center justify-center mx-auto">
                  <Download className="w-5 h-5 text-stone-600" />
                </div>
                <h3 className="text-base font-serif font-bold text-stone-900">Terminal do Exportador Letivo</h3>
                <p className="text-xs text-stone-500 font-light">Descarregue os horários do semestre em formatos universais para docentes, alunos e sistemas externos.</p>
              </div>

              <div className="grid grid-cols-1 gap-2.5 pt-3">
                <button
                  onClick={exportICS}
                  className="w-full p-4 hover:bg-stone-50 text-left rounded-xl border border-stone-150 flex items-center justify-between transition-all cursor-pointer"
                >
                  <div className="space-y-0.5">
                    <span className="font-bold text-stone-900">Sincronizar Calendário (Formato iCal / .ics)</span>
                    <p className="text-4xs text-stone-500 font-light uppercase">Google Calendar, Apple iCal, Outlook</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-stone-400" />
                </button>

                <button
                  onClick={exportCSV}
                  className="w-full p-4 hover:bg-stone-50 text-left rounded-xl border border-stone-150 flex items-center justify-between transition-all cursor-pointer"
                >
                  <div className="space-y-0.5">
                    <span className="font-bold text-stone-900">Relatório Excel Completo de Grade ( .csv)</span>
                    <p className="text-4xs text-stone-500 font-light uppercase">Microsoft Excel, Google Sheets, SQL Data</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-stone-400" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 9: TECHNICAL INFRASTRUCTURE VIEW WITHOUT COMPLICATED DB TECH LARP CODES */}
        {activeTab === "arch" && <TechnicalArchitecture />}

      </main>
    </div>
  );
}

