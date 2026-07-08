// Exporta TODO o conteúdo do mockData (dadosIniciais) para um JSON portátil — cópia de
// segurança antes de migrar para Supabase-only. Correr: npx tsx scripts/exportar-mockdata.ts
import { writeFileSync } from "fs";
import { dadosIniciais } from "../src/data/seed";

const dados = dadosIniciais();
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
const nome = `mockdata-backup-${stamp}.json`;
writeFileSync(nome, JSON.stringify(dados, null, 2), "utf8");

const n = (a: any[] | undefined) => a?.length ?? 0;
console.log(`✅ Exportado para ${nome}`);
console.log(
  `cursos ${n(dados.cursos)} · anosSemestres ${n(dados.anosSemestres)} · UCs ${n(dados.ucs)} · ` +
  `docentes ${n(dados.docentes)} · salas ${n(dados.salas)} · turmas ${n(dados.turmas)} · ` +
  `feriados ${n(dados.feriados)} · regras ${n(dados.regras)} · versoes ${n(dados.versoes)} · ` +
  `solverRuns ${n(dados.solverRuns)}`
);
