/**
 * TAREFA 3 — protótipo mensurável.
 *
 * Resolve a janela (1.º semestre, semanas 1-7) com CP-SAT e compara TRÊS
 * horários com a MESMA régua — o VALIDADOR INDEPENDENTE de `src/validacao`:
 *   1. a referência do coordenador;
 *   2. a heurística atual (`src/motor/alocador.ts`), recortada à janela;
 *   3. o solver.
 *
 * O protótipo NUNCA se valida a si próprio: o veredicto é sempre do validador.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { carregarContexto } from "./dados";
import { OPCOES_PADRAO, resolver } from "./modelo";
import type { OpcoesModelo } from "./modelo";
import { alocar } from "../src/motor/alocador";
import { validar } from "../src/validacao/validador";
import type { RelatorioValidacao } from "../src/validacao/validador";
import type { SessaoHorario } from "../src/types";

const DE = Number(process.env.JANELA_DE ?? 1);
const ATE = Number(process.env.JANELA_ATE ?? 7);
const TEMPO = Number(process.env.SOLVER_SEGUNDOS ?? 60);

const ctx = carregarContexto();
const r = ctx.regras;
const blocoH = r.grelha.duracaoBlocoHoras;

// ---------------------------------------------------------------------------
// Layout fixo da semana 1 — imposto pelo coordenador, comum aos três horários.
// ---------------------------------------------------------------------------

function sessoesDoLayoutFixo(idBase: number): SessaoHorario[] {
  const out: SessaoHorario[] = [];
  let id = idBase;
  for (const l of r.layoutsFixos) {
    for (const s of l.sessoes) {
      if (s.semana < DE || s.semana > ATE) continue;
      for (const turma of s.turmas) {
        const hh = Number(s.hora.slice(0, 2)) + blocoH;
        out.push({
          id: id++,
          ucNome: s.ucSigla,
          ucSigla: s.ucSigla,
          tipoAula: s.tipo,
          docente: "",
          sala: "",
          salaTipo: "",
          turma,
          diaSemana: s.dia,
          horaInicio: s.hora,
          horaFim: `${String(hh).padStart(2, "0")}:${s.hora.slice(3)}`,
          bloqueado: true,
          semana: s.semana,
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Relatório comum
// ---------------------------------------------------------------------------

function medir(nome: string, sessoes: SessaoHorario[]): RelatorioValidacao {
  const rel = validar(sessoes, ctx.ucs, r);
  const erros = rel.violacoes.filter((v) => v.gravidade === "erro");
  const avisos = rel.violacoes.filter((v) => v.gravidade === "aviso");

  const manchas = new Map<string, Set<string>>();
  const porDia = new Map<string, number>();
  const sexta = new Set<string>();
  const ultimoDia = r.grelha.dias[r.grelha.dias.length - 1];
  const hierarquiaFam = (t: string): string => {
    const e = r.estruturaTurmas;
    let m = t.match(new RegExp(`^${e.prefixos.pl}(\\d+)$`));
    if (m) return ctx.mapa.familias[Math.floor((Number(m[1]) - 1) / (e.tpPorTurmaTeorica * e.plPorTP))] ?? "?";
    m = t.match(new RegExp(`^${e.prefixos.tp}(\\d+)$`));
    if (m) return ctx.mapa.familias[Math.floor((Number(m[1]) - 1) / e.tpPorTurmaTeorica)] ?? "?";
    m = t.match(new RegExp(`^${e.prefixos.teorica}(\\d+)$`));
    if (m) return ctx.mapa.familias[Number(m[1]) - 1] ?? "?";
    const i = e.nomesTurmasTeoricas.indexOf(t);
    return i >= 0 ? (ctx.mapa.familias[i] ?? "?") : "?";
  };
  for (const s of sessoes) {
    const f = hierarquiaFam(s.turma);
    const k = `${s.semana}|${s.diaSemana}|${s.horaInicio}`;
    if (!manchas.has(f)) manchas.set(f, new Set());
    manchas.get(f)!.add(k);
    if (s.diaSemana === ultimoDia) sexta.add(`${f}|${s.semana}`);
  }
  for (const [f, set] of manchas) {
    for (const k of set) {
      const [w, d] = k.split("|");
      porDia.set(`${f}|${w}|${d}`, (porDia.get(`${f}|${w}|${d}`) ?? 0) + 1);
    }
  }
  const dist = new Map<number, number>();
  for (const [, n] of porDia) dist.set(n, (dist.get(n) ?? 0) + 1);

  console.log(`\n### ${nome}`);
  console.log(`  sessões: ${sessoes.length} · manchas por família: ${[...manchas].sort().map(([f, s]) => `${f}=${s.size}`).join(" ")}`);
  console.log(`  completude (validador): ${rel.completude.colocado}/${rel.completude.alvo} = ${rel.completude.pct.toFixed(1)}%`);
  console.log(`  VIOLAÇÕES: ${erros.length} erro(s), ${avisos.length} aviso(s)`);
  const ent = Object.entries(rel.porRegra).sort((a, b) => (b[1] as number) - (a[1] as number));
  for (const [reg, n] of ent) {
    const grav = rel.violacoes.find((v) => v.regra === reg)?.gravidade ?? "?";
    console.log(`      ${String(reg).padEnd(28)} ${String(n).padStart(4)}  (${grav})`);
  }
  console.log(`  dias abertos: ${porDia.size} · distribuição blocos/dia: ${[...dist].sort((a, b) => a[0] - b[0]).map(([n, c]) => `${n}×${c}`).join(" ")}`);
  console.log(`  família|semana com aulas no último dia da semana: ${sexta.size}`);
  console.log(`  equilíbrio semanal (amplitude por ano/família):`);
  for (const e of rel.equilibrio) {
    console.log(`      ano ${e.ano} fam ${e.familia} bloco ${e.bloco}: min ${e.min} max ${e.max} amplitude ${e.amplitude} · semanas no teto: ${e.noTeto.length}`);
  }
  if (erros.length > 0) {
    console.log("  primeiros erros:");
    for (const v of erros.slice(0, 6)) {
      console.log(`      [${v.regra}] s${v.semana} ${v.dia} ${v.hora} ${v.ucSigla} ${v.turma}: ${v.mensagem}`);
    }
  }
  return rel;
}

// ---------------------------------------------------------------------------
// 1. Referência do coordenador
// ---------------------------------------------------------------------------

console.log("=".repeat(78));
console.log(`JANELA: semanas ${DE}-${ATE} · tempo dado ao solver: ${TEMPO}s`);
console.log("=".repeat(78));

const brutoRef = JSON.parse(
  readFileSync(join(import.meta.dirname ?? ".", "..", "referencia_sessoes.json"), "utf8"),
) as { semana: number; diaSemana: string; horaInicio: string; ucSigla: string; tipoAula: string; turma: string }[];

const nomesT = r.estruturaTurmas.nomesTurmasTeoricas;
const prefT = r.estruturaTurmas.prefixos.teorica;
const semanaLayout = Math.min(...brutoRef.map((s) => s.semana));
const sessoesRef: SessaoHorario[] = brutoRef
  .filter((s) => s.semana >= DE && s.semana <= ATE)
  .map((s, i) => {
    const m = s.turma.match(new RegExp(`^${prefT}(\\d+)$`));
    const hh = Number(s.horaInicio.slice(0, 2)) + blocoH;
    return {
      id: i + 1,
      ucNome: s.ucSigla,
      ucSigla: s.ucSigla,
      tipoAula: s.tipoAula as SessaoHorario["tipoAula"],
      docente: "",
      sala: "",
      salaTipo: "",
      turma: m ? (nomesT[Number(m[1]) - 1] ?? s.turma) : s.turma,
      diaSemana: s.diaSemana,
      horaInicio: s.horaInicio,
      horaFim: `${String(hh).padStart(2, "0")}:${s.horaInicio.slice(3)}`,
      bloqueado: s.semana === semanaLayout,
      semana: s.semana,
    };
  });

medir("REFERÊNCIA DO COORDENADOR", sessoesRef);

// ---------------------------------------------------------------------------
// 2. Heurística atual, recortada à janela
// ---------------------------------------------------------------------------

console.log("\n" + "-".repeat(78));
const tH = Date.now();
const heur = alocar(ctx.entrada);
const msHeur = Date.now() - tH;
const sessoesHeur = heur.sessoes.filter((s) => (s.semana ?? 0) >= DE && (s.semana ?? 0) <= ATE);
console.log(`heurística: ${msHeur} ms para as 30 semanas (${heur.sessoes.length} sessões no total)`);
medir("HEURÍSTICA ATUAL (recorte da janela)", sessoesHeur);

// ---------------------------------------------------------------------------
// 3. Solver CP-SAT
// ---------------------------------------------------------------------------

console.log("\n" + "-".repeat(78));
console.log("SOLVER CP-SAT (cpsat-js / OR-Tools WASM)");
const op: OpcoesModelo = { ...OPCOES_PADRAO, de: DE, ate: ATE, tempo: TEMPO };
const res = await resolver(ctx, op);
console.log(
  `  construção ${res.msConstrucao} ms · resolução ${res.msSolve} ms · status ${res.status} · ` +
    `blocos ${res.blocosColocados}/${res.blocosTotais}`,
);

const fixas = sessoesDoLayoutFixo(1_000_000);
const sessoesSolver = [...fixas, ...res.sessoes];
medir("SOLVER CP-SAT", sessoesSolver);

console.log("\n" + "=".repeat(78));
console.log("RESUMO");
console.log("=".repeat(78));
const rr = (nome: string, s: SessaoHorario[], ms: number | string) => {
  const v = validar(s, ctx.ucs, r);
  const e = v.violacoes.filter((x) => x.gravidade === "erro").length;
  const a = v.violacoes.filter((x) => x.gravidade === "aviso").length;
  console.log(
    `  ${nome.padEnd(24)} ${String(s.length).padStart(4)} sessões · ${v.completude.pct.toFixed(1)}% · ` +
      `${String(e).padStart(3)} erros · ${String(a).padStart(3)} avisos · ${ms}`,
  );
};
rr("referência", sessoesRef, "—");
rr("heurística atual", sessoesHeur, `${msHeur} ms`);
rr("solver CP-SAT", sessoesSolver, `${res.msConstrucao + res.msSolve} ms`);
