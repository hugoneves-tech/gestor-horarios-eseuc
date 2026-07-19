import solver from "javascript-lp-solver";
import type { AtribuicaoAulaDocenteProvisoria, CargaDocenteProvisoria, SessaoHorario, UC } from "../types";

export type TipologiaDocente = "T" | "TP" | "PL" | "S";

export interface LinhaCoberturaDocente {
  ucId: string;
  ucSigla: string;
  tipologia: TipologiaDocente;
  numeroTurmas: number;
  horasDisponiveis: number;
  horasDeclaradas: number;
  diferenca: number;
}

const tipoConfig = (tipo: TipologiaDocente) =>
  tipo === "T" ? "Teórica" : tipo === "TP" ? "TeoricoPratica" : tipo === "PL" ? "Prática" : "Seminário";

export const horasTipologia = (uc: UC, tipo: TipologiaDocente) =>
  tipo === "T" ? uc.cargaHorariaTeorica : tipo === "TP" ? uc.cargaHorariaTP : tipo === "PL" ? uc.cargaHorariaPratica : (uc.cargaHorariaS || 0);

export function calcularCoberturaDocente(
  ucs: UC[],
  cargas: CargaDocenteProvisoria[],
  anoSemestreId: string,
  anoCurricular: number,
): LinhaCoberturaDocente[] {
  const linhas: LinhaCoberturaDocente[] = [];
  for (const uc of ucs.filter(u => Number(u.anoCurricular) === anoCurricular)) {
    for (const tipologia of ["T", "TP", "PL", "S"] as const) {
      const horasPorTurma = horasTipologia(uc, tipologia);
      const numeroTurmas = (uc.turmasConfig || []).filter(t => t.tipo === tipoConfig(tipologia)).length;
      if (!horasPorTurma) continue;
      const horasDisponiveis = horasPorTurma * numeroTurmas;
      const horasDeclaradas = cargas
        .filter(c => c.anoSemestreId === anoSemestreId && c.ucId === uc.id && c.tipologia === tipologia)
        .reduce((total, c) => total + c.numeroTurmas * c.horasPorTurma, 0);
      linhas.push({ ucId: uc.id, ucSigla: uc.sigla, tipologia, numeroTurmas, horasDisponiveis, horasDeclaradas, diferenca: horasDeclaradas - horasDisponiveis });
    }
  }
  return linhas;
}

const chaveSessao = (s: SessaoHorario) => `${s.semana || 0}|${s.diaSemana}|${s.horaInicio}|${s.horaFim}`;
const ordemDia: Record<string, number> = { Segunda: 1, Terça: 2, Quarta: 3, Quinta: 4, Sexta: 5 };

export interface ResultadoDistribuicaoDocente {
  turmasPorCarga: Map<string, string[]>;
  atribuicoes: Omit<AtribuicaoAulaDocenteProvisoria, "id">[];
  incompatibilidadesEstimadas: number;
}

/**
 * Resolve simultaneamente as turmas de um ano completo. A capacidade de cada turma
 * é uma igualdade no modelo: nenhuma UC/tipologia pode ficar com horas em falta ou excesso.
 * As preferências manuais têm prioridade; as mistas funcionam como preferência suave.
 */
export function distribuirTurmasDocentes(
  ucs: UC[],
  cargas: CargaDocenteProvisoria[],
  anoSemestreId: string,
  anoCurricular: number,
  sessoes: SessaoHorario[] = [],
): ResultadoDistribuicaoDocente {
  const ucsAno = ucs.filter(u => Number(u.anoCurricular) === anoCurricular);
  const idsUc = new Set(ucsAno.map(u => u.id));
  const cargasAno = cargas.filter(c => c.anoSemestreId === anoSemestreId && idsUc.has(c.ucId));
  const turmasPorCarga = new Map<string, string[]>();
  const atribuicoes: Omit<AtribuicaoAulaDocenteProvisoria, "id">[] = [];
  const ocupacaoDocente = new Map<string, Set<string>>();
  let incompatibilidadesEstimadas = 0;

  const sessoesOrdenadas = new Map<string, SessaoHorario[]>();
  for (const uc of ucsAno) {
    for (const tipologia of ["T", "TP", "PL", "S"] as const) {
      for (const turma of (uc.turmasConfig || []).filter(t => t.tipo === tipoConfig(tipologia))) {
        const lista = sessoes.filter(s => s.ucSigla === uc.sigla && s.tipoAula === tipologia && s.turma === turma.nome)
          .slice().sort((a, b) => (a.semana || 0) - (b.semana || 0) || (ordemDia[a.diaSemana] || 9) - (ordemDia[b.diaSemana] || 9) || a.horaInicio.localeCompare(b.horaInicio));
        sessoesOrdenadas.set(`${uc.id}|${tipologia}|${turma.nome}`, lista);
      }
    }
  }

  for (const uc of ucsAno) {
    for (const tipologia of ["T", "TP", "PL", "S"] as const) {
      const horasPorTurma = horasTipologia(uc, tipologia);
      const turmas = (uc.turmasConfig || []).filter(t => t.tipo === tipoConfig(tipologia)).map(t => t.nome);
      if (!horasPorTurma || !turmas.length) continue;
      const cargasGrupo = cargasAno.filter(c => c.ucId === uc.id && c.tipologia === tipologia);
      if (!cargasGrupo.length) throw new Error(`${uc.sigla}/${tipologia}: não existem cargas docentes declaradas.`);

      const constraints: Record<string, { min?: number; max?: number }> = {};
      const variables: Record<string, Record<string, number>> = {};
      const binaries: Record<string, 1> = {};
      for (const c of cargasGrupo) constraints[`carga_${c.id}`] = { min: c.numeroTurmas, max: c.numeroTurmas };
      for (const turma of turmas) constraints[`turma_${turma}`] = { min: horasPorTurma, max: horasPorTurma };

      for (const carga of cargasGrupo) {
        const preferencias = new Set((carga.modoTurmas === "automatico" ? [] : carga.turmasSelecionadas || []).filter(t => turmas.includes(t)));
        if (carga.modoTurmas === "manual" && preferencias.size !== carga.numeroTurmas) {
          throw new Error(`${uc.sigla}/${tipologia}: a carga manual precisa de ${carga.numeroTurmas} turma(s) preferida(s).`);
        }
        for (const turma of turmas) {
          if (carga.modoTurmas === "manual" && !preferencias.has(turma)) continue;
          const nome = `x_${carga.id}_${turma}`.replace(/[^a-zA-Z0-9_]/g, "_");
          const penalizacaoPreferencia = preferencias.has(turma) ? 0 : carga.modoTurmas === "misto" ? 20 : 1;
          variables[nome] = { custo: penalizacaoPreferencia, [`carga_${carga.id}`]: 1, [`turma_${turma}`]: carga.horasPorTurma };
          binaries[nome] = 1;
        }
      }

      const resultado = solver.Solve({ optimize: "custo", opType: "min", constraints, variables, binaries } as any) as Record<string, number | boolean>;
      if (!resultado.feasible) throw new Error(`${uc.sigla}/${tipologia}: as cargas não permitem preencher exatamente todas as turmas.`);
      for (const carga of cargasGrupo) {
        const escolhidas = turmas.filter(turma => {
          const nome = `x_${carga.id}_${turma}`.replace(/[^a-zA-Z0-9_]/g, "_");
          return Number(resultado[nome] || 0) > 0.5;
        });
        if (escolhidas.length !== carga.numeroTurmas) throw new Error(`${uc.sigla}/${tipologia}: resultado incompleto para uma carga docente.`);
        turmasPorCarga.set(carga.id, escolhidas);
      }

      // Depois de escolhidas as turmas, atribui os números de aula aos docentes.
      // Quando já existe uma proposta de horário, escolhe primeiro os números que não
      // colidem com sessões já reservadas pelo mesmo docente.
      for (const turma of turmas) {
        const livres = new Set(Array.from({ length: Math.floor(horasPorTurma / 2) }, (_, i) => i + 1));
        const cargasTurma = cargasGrupo.filter(c => (turmasPorCarga.get(c.id) || []).includes(turma))
          .sort((a, b) => b.horasPorTurma - a.horasPorTurma || a.docenteId.localeCompare(b.docenteId));
        const sessoesTurma = sessoesOrdenadas.get(`${uc.id}|${tipologia}|${turma}`) || [];
        for (const carga of cargasTurma) {
          const ocupadas = ocupacaoDocente.get(carga.docenteId) || new Set<string>();
          const quantidade = carga.horasPorTurma / 2;
          const candidatas = [...livres].map(numero => {
            const sessao = sessoesTurma[numero - 1];
            const conflito = sessao && ocupadas.has(chaveSessao(sessao)) ? 1 : 0;
            return { numero, sessao, conflito };
          }).sort((a, b) => a.conflito - b.conflito || a.numero - b.numero);
          if (candidatas.length < quantidade) throw new Error(`${uc.sigla}/${tipologia}/${turma}: faltam números de aula livres.`);
          for (const escolha of candidatas.slice(0, quantidade)) {
            livres.delete(escolha.numero);
            if (escolha.sessao) {
              const chave = chaveSessao(escolha.sessao);
              if (ocupadas.has(chave)) incompatibilidadesEstimadas += 1;
              ocupadas.add(chave);
            }
            atribuicoes.push({
              cargaId: carga.id, docenteId: carga.docenteId, ucId: uc.id, anoSemestreId,
              tipologia, turma, numeroAula: escolha.numero,
              origem: carga.modoTurmas === "manual" ? "manual" : "automatica",
              bloqueada: carga.modoTurmas === "manual",
            });
          }
          ocupacaoDocente.set(carga.docenteId, ocupadas);
        }
      }
    }
  }

  return { turmasPorCarga, atribuicoes, incompatibilidadesEstimadas };
}
