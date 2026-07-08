import { supabase, supabaseConfigured } from "./supabaseClient";
import type { DadosAcademicos, Repositorio } from "./repositorio";
import type { VersaoHorario, SolverRun } from "../types";
import * as M from "./mappers";

/** Ordem de tabelas que respeita as foreign keys ao inserir/apagar. */
const TABELAS_DEPENDENTES = ["solver_runs", "versoes"] as const;
const TABELAS_CATALOGO = [
  "cursos", "anos_semestres", "ucs", "turmas", "docentes", "salas", "feriados", "regras",
] as const;

/**
 * Implementação do Repositorio sobre Supabase (PostgreSQL).
 */
export class SupabaseRepo implements Repositorio {
  disponivel(): boolean {
    return supabaseConfigured && supabase !== null;
  }

  private cli() {
    if (!supabase) throw new Error("Supabase não configurado (.env em falta).");
    return supabase;
  }

  async carregarTudo(): Promise<DadosAcademicos> {
    const db = this.cli();
    const sel = async (t: string) => {
      const { data, error } = await db.from(t).select("*");
      if (error) throw new Error(`[${t}] ${error.message}`);
      return data ?? [];
    };
    const [
      cursos, anosSemestres, ucs, turmas, docentes, salas, feriados, regras, versoes, solverRuns,
    ] = await Promise.all([
      sel("cursos"), sel("anos_semestres"), sel("ucs"), sel("turmas"), sel("docentes"),
      sel("salas"), sel("feriados"), sel("regras"), sel("versoes"), sel("solver_runs"),
    ]);

    return {
      cursos: cursos.map(M.rowToCurso),
      anosSemestres: anosSemestres.map(M.rowToAnoSem),
      ucs: ucs.map(M.rowToUc),
      turmas: turmas.map(M.rowToTurma),
      docentes: docentes.map(M.rowToDocente),
      salas: salas.map(M.rowToSala),
      feriados: feriados.map(M.rowToFeriado),
      regras: regras.map(M.rowToRegra),
      versoes: versoes.map(M.rowToVersao),
      solverRuns: solverRuns.map(M.rowToSolverRun),
    };
  }

  /**
   * Sincroniza um snapshot: faz upsert das linhas dadas E apaga do Supabase as
   * que já não constam (sincronização de remoções). Só toca nas tabelas fornecidas.
   * Passo 1 — upsert (pais→filhos); Passo 2 — apagar em falta (filhos→pais), para
   * não violar foreign keys.
   */
  async guardarTudo(d: Partial<DadosAcademicos>): Promise<void> {
    const db = this.cli();

    const up = async (t: string, rows: any[]) => {
      if (!rows?.length) return;
      const { error } = await db.from(t).upsert(rows);
      if (error) throw new Error(`[${t}] ${error.message}`);
    };
    const apagarEmFalta = async (t: string, items?: { id: string }[]) => {
      if (items === undefined) return; // tabela não fornecida → não mexer
      const ids = items.map(i => i.id);
      let q = db.from(t).delete() as any;
      q = ids.length
        ? q.not("id", "in", `(${ids.map(i => JSON.stringify(i)).join(",")})`)
        : q.neq("id", "__none__"); // sem ids → apaga tudo
      const { error } = await q;
      if (error) throw new Error(`[${t}] delete: ${error.message}`);
    };

    // Passo 1 — upsert por ordem de dependência (pais primeiro).
    if (d.cursos)        await up("cursos", d.cursos.map(M.cursoToRow));
    if (d.anosSemestres) await up("anos_semestres", d.anosSemestres.map(M.anoSemToRow));
    if (d.ucs)           await up("ucs", d.ucs.map(M.ucToRow));
    if (d.turmas)        await up("turmas", d.turmas.map(M.turmaToRow));
    if (d.docentes)      await up("docentes", d.docentes.map(M.docenteToRow));
    if (d.salas)         await up("salas", d.salas.map(M.salaToRow));
    if (d.feriados)      await up("feriados", d.feriados.map(M.feriadoToRow));
    if (d.regras)        await up("regras", d.regras.map(M.regraToRow));
    if (d.versoes)       await up("versoes", d.versoes.map(M.versaoToRow));
    if (d.solverRuns)    await up("solver_runs", d.solverRuns.map(M.solverRunToRow));

    // Passo 2 — apagar em falta por ordem inversa (filhos primeiro).
    await apagarEmFalta("solver_runs", d.solverRuns);
    await apagarEmFalta("versoes", d.versoes);
    await apagarEmFalta("regras", d.regras);
    await apagarEmFalta("feriados", d.feriados);
    await apagarEmFalta("salas", d.salas);
    await apagarEmFalta("docentes", d.docentes);
    await apagarEmFalta("turmas", d.turmas);
    await apagarEmFalta("ucs", d.ucs);
    await apagarEmFalta("anos_semestres", d.anosSemestres);
    await apagarEmFalta("cursos", d.cursos);
  }

  async guardarVersao(v: VersaoHorario): Promise<void> {
    const db = this.cli();
    const { error } = await db.from("versoes").upsert(M.versaoToRow(v));
    if (error) throw new Error(`[versoes] ${error.message}`);
  }

  async guardarSolverRun(s: SolverRun): Promise<void> {
    const db = this.cli();
    const { error } = await db.from("solver_runs").upsert(M.solverRunToRow(s));
    if (error) throw new Error(`[solver_runs] ${error.message}`);
  }

  async limparTudo(): Promise<void> {
    const db = this.cli();
    // Apaga dependentes primeiro, depois catálogo. (neq a um id impossível = "tudo")
    for (const t of [...TABELAS_DEPENDENTES, ...TABELAS_CATALOGO]) {
      const { error } = await db.from(t).delete().neq("id", "__none__");
      if (error) throw new Error(`[${t}] ${error.message}`);
    }
  }
}

/** Instância partilhada. */
export const repo = new SupabaseRepo();
