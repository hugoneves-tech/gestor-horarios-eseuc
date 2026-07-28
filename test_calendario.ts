import { strict as assert } from "node:assert";
import { calcularSemanas, mapearSemanasPedagogicasParaFisicas } from "./src/utils/distribuicao";
import type { SemanaPersonalizada } from "./src/types";

const semanas: SemanaPersonalizada[] = [
  { numero: 1, dataSegunda: "2027-02-08", dataSexta: "2027-02-12", isPausa: false },
  { numero: 7, dataSegunda: "2027-03-22", dataSexta: "2027-03-26", isPausa: true, motivoPausa: "Páscoa" },
  { numero: 14, dataSegunda: "2027-05-17", dataSexta: "2027-05-20", isPausa: false },
];

assert.deepEqual(mapearSemanasPedagogicasParaFisicas(1, 15, semanas), { start: 1, end: 15 });

const calculadas = calcularSemanas("2027-02-08", 1, 14, [], semanas);
assert.equal(calculadas.find(s => s.numero === 7)?.fator, 0);
assert.deepEqual(calculadas.find(s => s.numero === 14)?.diasBloqueados, ["Sexta"]);

console.log("Calendário: pausas não deslocam a numeração e a última semana respeita a data final.");
