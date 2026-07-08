import type {
  Curso, AnoLetivoSemestre, UC, Docente, Sala, Turma,
  FeriadoInterrupcao, RegraHorario, VersaoHorario, SolverRun,
} from "../types";

/**
 * Snapshot de todo o estado académico carregado de uma vez.
 */
export interface DadosAcademicos {
  cursos: Curso[];
  anosSemestres: AnoLetivoSemestre[];
  ucs: UC[];
  docentes: Docente[];
  salas: Sala[];
  turmas: Turma[];
  feriados: FeriadoInterrupcao[];
  regras: RegraHorario[];
  versoes: VersaoHorario[];
  solverRuns: SolverRun[];
}

/**
 * Interface de persistência. A app fala SÓ com isto — a implementação
 * (Supabase hoje, base de dados da escola amanhã) é trocável sem mexer na UI.
 */
export interface Repositorio {
  /** Está ligado e pronto a ler/escrever? */
  disponivel(): boolean;

  /** Carrega todo o catálogo + horários. */
  carregarTudo(): Promise<DadosAcademicos>;

  /** Substitui completamente o conteúdo (seed / importação). */
  guardarTudo(dados: Partial<DadosAcademicos>): Promise<void>;

  /** Grava (upsert) uma versão de horário e as suas sessões. */
  guardarVersao(versao: VersaoHorario): Promise<void>;

  /** Regista uma execução do motor. */
  guardarSolverRun(run: SolverRun): Promise<void>;

  /** Apaga todo o conteúdo (reset). */
  limparTudo(): Promise<void>;
}
