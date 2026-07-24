/**
 * Conversões entre as linhas SQL (snake_case) e os objetos de domínio (camelCase).
 * Mantém o resto da app alheio ao formato da base de dados.
 */
import type {
  Curso, AnoLetivoSemestre, UC, Docente, Sala, Turma,
  FeriadoInterrupcao, RegraHorario, VersaoHorario, SolverRun, SessaoHorario,
  CargaDocenteProvisoria, AtribuicaoAulaDocenteProvisoria,
} from "../types";

// --- Curso ---------------------------------------------------------------
export const cursoToRow = (c: Curso) => ({ id: c.id, nome: c.nome, sigla: c.sigla, departamento: c.departamento });
export const rowToCurso = (r: any): Curso => ({ id: r.id, nome: r.nome, sigla: r.sigla, departamento: r.departamento ?? "" });

// --- AnoLetivoSemestre ---------------------------------------------------
export const anoSemToRow = (a: AnoLetivoSemestre) => ({
  id: a.id, ano_letivo: a.anoLetivo, semestre: a.semestre, edicao: a.edicao,
  ativo: a.ativo, data_inicio_semestre: a.dataInicioSemestre ?? null,
  semanas_personalizadas: a.semanasPersonalizadas ?? null,
  data_inicio_ano1: a.dataInicioAno1 ?? null,
  data_inicio_ano2: a.dataInicioAno2 ?? null,
  data_inicio_ano3: a.dataInicioAno3 ?? null,
  data_inicio_ano4: a.dataInicioAno4 ?? null,
});
export const rowToAnoSem = (r: any): AnoLetivoSemestre => ({
  id: r.id, anoLetivo: r.ano_letivo, semestre: r.semestre, edicao: r.edicao ?? "",
  ativo: !!r.ativo, dataInicioSemestre: r.data_inicio_semestre ?? undefined,
  semanasPersonalizadas: r.semanas_personalizadas ?? undefined,
  dataInicioAno1: r.data_inicio_ano1 ?? undefined,
  dataInicioAno2: r.data_inicio_ano2 ?? undefined,
  dataInicioAno3: r.data_inicio_ano3 ?? undefined,
  dataInicioAno4: r.data_inicio_ano4 ?? undefined,
});

// --- UC ------------------------------------------------------------------
export const ucToRow = (u: UC) => ({
  id: u.id, nome: u.nome, sigla: u.sigla, curso_id: u.cursoId, ano_curricular: u.anoCurricular,
  carga_horaria_teorica: u.cargaHorariaTeorica, carga_horaria_pratica: u.cargaHorariaPratica,
  carga_horaria_tp: u.cargaHorariaTP, carga_horaria_s: u.cargaHorariaS ?? 0,
  carga_horaria_e: u.cargaHorariaE, ects: u.ects, semestre: u.semestre,
  semana_inicio: u.semanaInicio ?? null, semana_fim: u.semanaFim ?? null,
  num_semanas: u.numSemanas, data_inicio: u.dataInicio ?? null, data_fim: u.dataFim ?? null,
  periodo: u.periodo ?? null, observacoes: u.observacoes ?? null,
  semanas_pl: u.semanasPL ?? null,
  max_simultaneo_t: u.maxSimultaneoT ?? null,
  max_simultaneo_tp: u.maxSimultaneoTP ?? null,
  max_simultaneo_pl: u.maxSimultaneoPL ?? null,
  plano_distribuicao: u.planoDistribucao ?? null,
  turmas_config: (u.turmasConfig ?? []).map(t => t.tipo === "Teórica" ? {
    ...t,
    tSimultanea: u.turmasTSimultaneas ?? false,
    horariosTSimultaneos: u.horariosTSimultaneas ?? ["10:00", "16:00"],
  } : t),
});
export const rowToUc = (r: any): UC => {
  const turmasConfig = r.turmas_config ?? [];
  const teoricas = turmasConfig.filter((t: any) => t.tipo === "Teórica");
  const temConfiguracao = teoricas.some((t: any) => typeof t.tSimultanea === "boolean");
  const ehPsiS = String(r.sigla || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase() === "PSIS";
  const primeiraConfig = teoricas.find((t: any) => Array.isArray(t.horariosTSimultaneos));
  return {
    id: r.id, nome: r.nome, sigla: r.sigla, cursoId: r.curso_id, anoCurricular: r.ano_curricular,
    cargaHorariaTeorica: r.carga_horaria_teorica, cargaHorariaPratica: r.carga_horaria_pratica,
    cargaHorariaTP: r.carga_horaria_tp, cargaHorariaS: r.carga_horaria_s ?? 0,
    cargaHorariaE: r.carga_horaria_e, ects: r.ects, semestre: r.semestre,
    semanaInicio: r.semana_inicio ?? undefined, semanaFim: r.semana_fim ?? undefined,
    numSemanas: r.num_semanas, dataInicio: r.data_inicio ?? undefined, dataFim: r.data_fim ?? undefined,
    periodo: r.periodo ?? undefined, observacoes: r.observacoes ?? undefined,
    semanasPL: r.semanas_pl ?? undefined,
    maxSimultaneoT: r.max_simultaneo_t ?? undefined,
    maxSimultaneoTP: r.max_simultaneo_tp ?? undefined,
    maxSimultaneoPL: r.max_simultaneo_pl ?? undefined,
    turmasTSimultaneas: temConfiguracao ? teoricas.some((t: any) => t.tSimultanea === true) : ehPsiS,
    horariosTSimultaneas: primeiraConfig?.horariosTSimultaneos ?? ["10:00", "16:00"],
    planoDistribucao: r.plano_distribuicao ?? undefined,
    turmasConfig,
  };
};

// --- Docente -------------------------------------------------------------
export const docenteToRow = (d: Docente) => ({
  id: d.id, nome: d.nome, email: d.email, departamento: d.departamento,
  max_horas_semanais: d.maxHorasSemanais, unidades_curriculares: d.unidadesCurriculares ?? [],
  disponibilidade: d.disponibilidade ?? {}, is_pos_graduacao: d.isPosGraduacao ?? false,
  atribuicoes_ucs: d.atribuicoesUcs ?? {},
});
export const rowToDocente = (r: any): Docente => ({
  id: r.id, nome: r.nome, email: r.email ?? "", departamento: r.departamento ?? "",
  maxHorasSemanais: r.max_horas_semanais ?? 0, unidadesCurriculares: r.unidades_curriculares ?? [],
  disponibilidade: r.disponibilidade ?? {}, isPosGraduacao: !!r.is_pos_graduacao,
  atribuicoesUcs: r.atribuicoes_ucs ?? {},
});

// --- Distribuição docente provisória --------------------------------------
export const cargaDocenteProvisoriaToRow = (c: CargaDocenteProvisoria) => ({
  id: c.id, docente_id: c.docenteId, uc_id: c.ucId, ano_semestre_id: c.anoSemestreId,
  tipologia: c.tipologia, numero_turmas: c.numeroTurmas, horas_por_turma: c.horasPorTurma,
  modo_turmas: c.modoTurmas, turmas_selecionadas: c.turmasSelecionadas ?? [], provisoria: true,
});
export const rowToCargaDocenteProvisoria = (r: any): CargaDocenteProvisoria => ({
  id: r.id, docenteId: r.docente_id, ucId: r.uc_id, anoSemestreId: r.ano_semestre_id,
  tipologia: r.tipologia, numeroTurmas: r.numero_turmas, horasPorTurma: r.horas_por_turma,
  modoTurmas: r.modo_turmas, turmasSelecionadas: r.turmas_selecionadas ?? [], provisoria: true,
});
export const atribuicaoAulaDocenteProvisoriaToRow = (a: AtribuicaoAulaDocenteProvisoria) => ({
  id: a.id, carga_id: a.cargaId, docente_id: a.docenteId, uc_id: a.ucId,
  ano_semestre_id: a.anoSemestreId, tipologia: a.tipologia, turma: a.turma,
  numero_aula: a.numeroAula, origem: a.origem, bloqueada: a.bloqueada,
});
export const rowToAtribuicaoAulaDocenteProvisoria = (r: any): AtribuicaoAulaDocenteProvisoria => ({
  id: r.id, cargaId: r.carga_id, docenteId: r.docente_id, ucId: r.uc_id,
  anoSemestreId: r.ano_semestre_id, tipologia: r.tipologia, turma: r.turma,
  numeroAula: r.numero_aula, origem: r.origem, bloqueada: !!r.bloqueada,
});

// --- Sala ----------------------------------------------------------------
export const salaToRow = (s: Sala) => ({
  id: s.id, nome: s.nome, tipo: s.tipo, capacidade: s.capacidade,
  equipamento: s.equipamento ?? [], tipologia: s.tipologia ?? null, tipologias: s.tipologias ?? [],
});
export const rowToSala = (r: any): Sala => ({
  id: r.id, nome: r.nome, tipo: r.tipo, capacidade: r.capacidade ?? 0,
  equipamento: r.equipamento ?? [], tipologia: r.tipologia ?? undefined, tipologias: r.tipologias ?? [],
});

// --- Turma ---------------------------------------------------------------
export const turmaToRow = (t: Turma) => ({
  id: t.id, nome: t.nome, curso_id: t.cursoId, alunos: t.alunos, vagas: t.vagas,
  tipo: t.tipo, ano_curricular: t.anoCurricular, bloco: t.bloco ?? null,
});
export const rowToTurma = (r: any): Turma => ({
  id: r.id, nome: r.nome, cursoId: r.curso_id, alunos: r.alunos ?? 0, vagas: r.vagas ?? 0,
  tipo: r.tipo, anoCurricular: r.ano_curricular, bloco: r.bloco ?? undefined,
});

// --- Feriado -------------------------------------------------------------
export const feriadoToRow = (f: FeriadoInterrupcao) => ({
  id: f.id, nome: f.nome, tipo: f.tipo, data_inicio: f.dataInicio, data_fim: f.dataFim,
});
export const rowToFeriado = (r: any): FeriadoInterrupcao => ({
  id: r.id, nome: r.nome, tipo: r.tipo, dataInicio: r.data_inicio, dataFim: r.data_fim,
});

// --- Regra ---------------------------------------------------------------
export const regraToRow = (r: RegraHorario) => ({
  id: r.id, nome: r.nome, tipo: r.tipo, categoria: r.categoria, descricao: r.descricao,
  escopo: r.escopo ?? null, ano_curricular: r.anoCurricular != null ? String(r.anoCurricular) : null,
  config: r.config ?? {}, peso: r.peso, ativa: r.ativa,
});
export const rowToRegra = (r: any): RegraHorario => {
  let config = r.config ?? {};
  // Migração de compatibilidade: versões anteriores gravavam esta preferência
  // como true. A regra atual utiliza a sexta-feira como dia letivo normal e o
  // autosave volta a persistir o valor corrigido no Supabase.
  if (r.id === "h_blocos_ocupacao_100") {
    config = {
      ...config,
      traducaoSimples: "Todos os blocos têm sempre 100% dos estudantes e a sexta-feira utiliza toda a capacidade disponível, incluindo 18h-20h.",
      motor: {
        ...(config.motor || {}),
        blocos100: {
          ...(config.motor?.blocos100 || {}),
          preferirSextaLivre: false,
        },
      },
    };
  }
  return {
    id: r.id, nome: r.nome, tipo: r.tipo, categoria: r.categoria ?? "", descricao: r.descricao ?? "",
    escopo: r.escopo ?? undefined,
    anoCurricular: r.ano_curricular == null ? undefined : (r.ano_curricular === "todos" ? "todos" : Number(r.ano_curricular)),
    config, peso: r.peso ?? 5, ativa: !!r.ativa,
  };
};

// --- Versão (sessões em JSONB) -------------------------------------------
export const versaoToRow = (v: VersaoHorario) => ({
  id: v.id, nome: v.nome, ano_semestre_id: v.anoSemestreId, criada_em: v.criadaEm,
  criada_por: v.criadaPor, ativa: v.ativa, score: v.score, sessoes: v.sessoes ?? [],
  semanas_bloqueadas: v.semanasBloqueadas ?? [],
});
export const rowToVersao = (r: any): VersaoHorario => ({
  id: r.id, nome: r.nome, anoSemestreId: r.ano_semestre_id, criadaEm: r.criada_em,
  criadaPor: r.criada_por ?? "", ativa: !!r.ativa, score: r.score ?? 0,
  sessoes: (r.sessoes ?? []) as SessaoHorario[],
  semanasBloqueadas: (r.semanas_bloqueadas ?? []) as number[],
});

// --- Solver run ----------------------------------------------------------
export const solverRunToRow = (s: SolverRun) => ({
  id: s.id, data_execucao: s.dataExecucao, versao_id: s.versaoId, status: s.status,
  duracao_ms: s.duracaoMs, tentativas: s.tentativas, score: s.score,
  conflitos_contidos: s.conflitosContidos, detalhes: s.detalhes ?? {},
});
export const rowToSolverRun = (r: any): SolverRun => ({
  id: r.id, dataExecucao: r.data_execucao, versaoId: r.versao_id, status: r.status,
  duracaoMs: r.duracao_ms ?? 0, tentativas: r.tentativas ?? 0, score: r.score ?? 0,
  conflitosContidos: r.conflitos_contidos ?? 0, detalhes: r.detalhes ?? { iteracoes: 0, log: "" },
});
