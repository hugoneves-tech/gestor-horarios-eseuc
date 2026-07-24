import assert from "node:assert/strict";
import type { UC } from "./src/types";
import { gerarSessoesConjunto, type EntradaUC, type SemanaInfo } from "./src/utils/distribuicao";

const uc: UC = {
  id: "uc_turnos",
  nome: "UC de teste de turnos",
  sigla: "TURN",
  cursoId: "c1",
  anoCurricular: 1,
  semestre: 1,
  cargaHorariaTeorica: 2,
  cargaHorariaTP: 2,
  cargaHorariaPratica: 0,
  cargaHorariaE: 0,
  ects: 4,
  numSemanas: 1,
  turmasConfig: [
    { id: "ta", nome: "Turma A", tipo: "Teórica" },
    { id: "tb", nome: "Turma B", tipo: "Teórica" },
    ...Array.from({ length: 8 }, (_, i) => ({
      id: `tp${i + 1}`,
      nome: `TP${i + 1}`,
      tipo: "TeoricoPratica" as const,
    })),
  ],
};

const semana: SemanaInfo = {
  numero: 1,
  dataSegunda: "2026-09-07",
  dataSexta: "2026-09-11",
  diasUteis: 5,
  fator: 1,
  feriadosNesta: [],
  diasBloqueados: [],
  numeroPedagogico: 1,
};
const entrada: EntradaUC = { uc, semanas: [semana], semanaGlobalOffset: 0 };
const sessoes = gerarSessoesConjunto([entrada], 1, 0, new Set(), new Map(), {
  prefTurmaAManha: { "1|1": true },
});

const manha = new Set(["08:00", "10:00", "12:00"]);
const tarde = new Set(["14:00", "16:00", "18:00"]);
const familiaA = sessoes.filter(s => s.turma === "Turma A" || /^TP[1-4]$/.test(s.turma));
const familiaB = sessoes.filter(s => s.turma === "Turma B" || /^TP[5-8]$/.test(s.turma));

assert.ok(familiaA.length > 0 && familiaB.length > 0);
assert.ok(familiaA.every(s => manha.has(s.horaInicio)), "a família A deve ficar exclusivamente de manhã");
assert.ok(familiaB.every(s => tarde.has(s.horaInicio)), "a família B deve ficar exclusivamente de tarde");

console.log("Turnos rígidos: Turma A de manhã e Turma B de tarde no 1.º semestre.");
