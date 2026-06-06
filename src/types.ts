/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Curso {
  id: string;
  nome: string;
  sigla: string;
  departamento: string;
}

export interface AnoLetivoSemestre {
  id: string;
  anoLetivo: string; // e.g. "2025/2026"
  semestre: number; // 1 or 2
  edicao: string; // e.g. "Regular" or "Pós-Laboral"
  ativo: boolean;
  dataInicioSemestre?: string; // YYYY-MM-DD — Monday of academic week 1
}

export interface UC {
  id: string;
  nome: string;
  sigla: string;
  cursoId: string;
  anoCurricular: number; // 1, 2, 3, 4
  cargaHorariaTeorica: number; // hours/week
  cargaHorariaPratica: number; // hours/week (PL)
  cargaHorariaTP: number; // hours/week (TP)
  cargaHorariaS?: number; // hours/week (Seminários)
  cargaHorariaE: number; // hours of Estágio/Ensino Clínico
  ects: number;
  semestre: number; // 1 or 2
  semanaInicio?: number; // week starting (e.g., 1 to 15)
  semanaFim?: number; // final academic week
  numSemanas: number; // weeks
  dataInicio?: string; // YYYY-MM-DD
  dataFim?: string; // YYYY-MM-DD
  periodo?: string;
  observacoes?: string;
  turmasConfig?: {
    id: string;
    nome: string;
    tipo: "Teórica" | "Prática" | "TeoricoPratica" | "Seminário";
    docenteId?: string; // ID of the allocated teacher
    tipologiaSalaDesejada?: string; // Preferred room typology (e.g. Laboratório PL, Sala de Computadores)
  }[];
}

export interface Docente {
  id: string;
  nome: string;
  email: string;
  departamento: string;
  maxHorasSemanais: number;
  unidadesCurriculares: string[]; // SIGLAs of UCs they can teach
  disponibilidade: {
    [dia: string]: string[]; // "Segunda" -> ["08:00-10:00", "10:00-12:00"]
  };
  isPosGraduacao?: boolean; // If they teach in MSc/PhD programs, limiting some daytime disponibilidade
  atribuicoesUcs?: {
    [ucSigla: string]: {
      tipos: ("T" | "TP" | "PL")[];
      horas: number;
      turmas: string[]; // e.g. ["Turma A", "TP1"]
    };
  };
}

export interface Sala {
  id: string;
  nome: string;
  tipo: "Teórica" | "Teórico-prática" | "Laboratório" | "Sala de Computadores";
  capacidade: number;
  equipamento: string[]; // e.g. ["Computadores", "Projetor", "Ar Condicionado"]
  tipologia?: string; // Room Typology (e.g. Laboratório PL, Sala de Computadores, Sala Teórica T)
  tipologias?: string[]; // Multiple Room Typologies
}

export interface Turma {
  id: string;
  nome: string; // e.g., "EI1-T", "EI1-PL1"
  cursoId: string;
  alunos: number;
  vagas: number;
  tipo: "Teórica" | "Prática" | "TeoricoPratica";
  anoCurricular: number; // 1, 2, 3, 4
  bloco?: "hospitalar" | "comunitaria"; // only for 3rd year
}

export interface FeriadoInterrupcao {
  id: string;
  nome: string;
  tipo: "Feriado" | "Férias Académicas" | "Interrupção Letiva";
  dataInicio: string; // YYYY-MM-DD
  dataFim: string; // YYYY-MM-DD
}

export interface RegraHorario {
  id: string;
  nome: string;
  tipo: "hard" | "soft";
  categoria: string; // e.g. "Docente", "Sala", "Estudante", "Calendário"
  descricao: string;
  escopo?: "transversal" | "ano";
  anoCurricular?: number | "todos";
  config: any; // JSONB parameters
  peso: number; // for soft constraints, 1-10
  ativa: boolean;
}

export interface SessaoHorario {
  id: number;
  ucNome: string;
  ucSigla: string;
  tipoAula: "T" | "TP" | "PL" | "S";
  docente: string;
  sala: string;
  salaTipo: string;
  turma: string;
  diaSemana: string; // "Segunda", "Terça", "Quarta", "Quinta", "Sexta"
  horaInicio: string; // "08:00"
  horaFim: string; // "10:00"
  bloqueado: boolean; // manual pin/lock
  semana?: number; // academic week number within the semester (1-based)
}

export interface VersaoHorario {
  id: string;
  nome: string; // e.g., "v1.0 - Proposta Base", "v1.1 - Sem t_aulas à Sexta"
  anoSemestreId: string;
  criadaEm: string;
  criadaPor: string;
  ativa: boolean;
  score: number; // 0 to 100
  sessoes: SessaoHorario[];
  semanasBloqueadas?: number[]; // semanas globais (1-30) validadas/congeladas — não mudam ao regenerar
}

export interface SolverRun {
  id: string;
  dataExecucao: string;
  versaoId: string;
  status: "Concluído" | "Erro" | "Incomputável";
  duracaoMs: number;
  tentativas: number;
  score: number;
  conflitosContidos: number;
  detalhes: {
    iteracoes: number;
    log: string;
  };
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}
