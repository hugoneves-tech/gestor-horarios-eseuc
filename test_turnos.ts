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

const semana16: SemanaInfo = {
  numero: 1,
  dataSegunda: "2027-02-08",
  dataSexta: "2027-02-12",
  diasUteis: 3,
  fator: 3 / 5,
  feriadosNesta: ["8 e 9 de fevereiro"],
  diasBloqueados: ["Segunda", "Terça"],
  numeroPedagogico: 1,
};
const entradasS2: EntradaUC[] = Array.from({ length: 4 }, (_, i) => {
  const ucS2: UC = {
    ...uc,
    id: `uc_s2_${i + 1}`,
    sigla: `S2-${i + 1}`,
    nome: `UC S2 ${i + 1}`,
    anoCurricular: 2,
    semestre: 2,
    cargaHorariaTeorica: 2,
    cargaHorariaTP: 0,
    turmasConfig: [{ id: `tb_${i + 1}`, nome: "Turma B", tipo: "Teórica" }],
  };
  return { uc: ucS2, semanas: [semana16], semanaGlobalOffset: 15 };
});
const arranqueS2 = gerarSessoesConjunto(entradasS2, 2);
const tQuartaS16 = arranqueS2.filter(s => s.semana === 16 && s.diaSemana === "Quarta" && s.tipoAula === "T");
assert.equal(tQuartaS16.length, 3);
assert.equal(new Set(tQuartaS16.map(s => s.ucSigla)).size, 3, "as três T de quarta da semana 16 devem ser de UCs diferentes");

console.log("Turnos rígidos: Turma A de manhã e Turma B de tarde no 1.º semestre.");
