// Gera um seed-supabase.sql a partir do mockData do código (dadosIniciais()), reutilizando
// EXATAMENTE os mesmos mappers que a app usa para gravar (src/data/mappers.ts) — logo as
// colunas e a serialização JSON batem certo com o schema. Idempotente: ON CONFLICT (id) DO UPDATE.
// Correr: npx tsx scripts/gerar-sql-supabase.ts  → produz seed-supabase.sql na raiz.
import { writeFileSync } from "fs";
import { dadosIniciais } from "../src/data/seed";
import * as M from "../src/data/mappers";

const d = dadosIniciais();

// Colunas que no schema são Postgres text[] (não jsonb) — ver supabase/schema.sql.
const TEXT_ARRAY_COLS = new Set(["unidades_curriculares", "equipamento", "tipologias"]);

const quote = (s: string) => "'" + s.replace(/'/g, "''") + "'";

function lit(col: string, v: any): string {
  if (v === null || v === undefined) return "NULL";
  if (TEXT_ARRAY_COLS.has(col)) {
    const arr = Array.isArray(v) ? v : [];
    return arr.length ? "ARRAY[" + arr.map((x) => quote(String(x))).join(", ") + "]::text[]" : "'{}'::text[]";
  }
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "string") return quote(v);
  // objeto / array aninhado → jsonb
  return quote(JSON.stringify(v)) + "::jsonb";
}

function tabela(nome: string, rows: any[]): string {
  if (!rows.length) return `-- ${nome}: (sem linhas)\n`;
  const cols = Object.keys(rows[0]);
  const valores = rows
    .map((r) => "  (" + cols.map((c) => lit(c, r[c])).join(", ") + ")")
    .join(",\n");
  const set = cols.filter((c) => c !== "id").map((c) => `${c} = EXCLUDED.${c}`).join(", ");
  return (
    `-- ${nome} (${rows.length})\n` +
    `INSERT INTO ${nome} (${cols.join(", ")}) VALUES\n${valores}\n` +
    `ON CONFLICT (id) DO UPDATE SET ${set};\n`
  );
}

// Ordem respeita as foreign keys (pais → filhos), igual a guardarTudo().
const blocos = [
  tabela("cursos", d.cursos.map(M.cursoToRow)),
  tabela("anos_semestres", d.anosSemestres.map(M.anoSemToRow)),
  tabela("ucs", d.ucs.map(M.ucToRow)),
  tabela("turmas", d.turmas.map(M.turmaToRow)),
  tabela("docentes", d.docentes.map(M.docenteToRow)),
  tabela("salas", d.salas.map(M.salaToRow)),
  tabela("feriados", d.feriados.map(M.feriadoToRow)),
  tabela("regras", d.regras.map(M.regraToRow)),
  tabela("versoes", d.versoes.map(M.versaoToRow)),
  tabela("solver_runs", d.solverRuns.map(M.solverRunToRow)),
];

const sql =
  "-- ===========================================================================\n" +
  "-- Seed Supabase a partir do mockData do código (dadosIniciais()).\n" +
  "-- Idempotente: ON CONFLICT (id) DO UPDATE — podes correr mais que uma vez.\n" +
  "-- NÃO apaga linhas extra já existentes; só insere/atualiza por id.\n" +
  "-- Correr no SQL Editor do Supabase (corre como service role → ignora RLS).\n" +
  "-- Requer as tabelas criadas (supabase/schema.sql).\n" +
  "-- ===========================================================================\n\n" +
  "BEGIN;\n\n" +
  blocos.join("\n") +
  "\nCOMMIT;\n";

writeFileSync("seed-supabase.sql", sql, "utf8");
const n = (a: any[]) => a.length;
console.log("✅ seed-supabase.sql gerado.");
console.log(
  `cursos ${n(d.cursos)} · anosSemestres ${n(d.anosSemestres)} · UCs ${n(d.ucs)} · ` +
  `turmas ${n(d.turmas)} · docentes ${n(d.docentes)} · salas ${n(d.salas)} · ` +
  `feriados ${n(d.feriados)} · regras ${n(d.regras)} · versoes ${n(d.versoes)} · solverRuns ${n(d.solverRuns)}`
);
