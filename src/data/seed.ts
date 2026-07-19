import type { DadosAcademicos } from "./repositorio";
import {
  cursosIniciais, anosSemestresIniciais, ucsIniciais, docentesIniciais,
  salasIniciais, turmasIniciais, feriadosIniciais, regrasIniciais,
  versoesIniciais, solverRunsIniciais,
} from "../mockData";

/** Conjunto completo de dados de arranque (mock ESEUC) para semear o Supabase. */
export function dadosIniciais(): DadosAcademicos {
  return {
    cursos: cursosIniciais,
    anosSemestres: anosSemestresIniciais,
    ucs: ucsIniciais,
    docentes: docentesIniciais,
    salas: salasIniciais,
    turmas: turmasIniciais,
    feriados: feriadosIniciais,
    regras: regrasIniciais,
    versoes: versoesIniciais,
    solverRuns: solverRunsIniciais,
    cargasDocentesProvisorias: [],
    atribuicoesAulasDocenteProvisorias: [],
  };
}
