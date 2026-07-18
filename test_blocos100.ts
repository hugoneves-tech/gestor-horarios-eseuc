import { strict as assert } from "node:assert";
import { organizarBlocos100, validarBlocos100, type PadraoBloco100Id } from "./src/utils/blocos100";
import type { SessaoHorario, UC } from "./src/types";

const uc = (id: string): UC => ({
  id, nome: id, sigla: id, cursoId: "CLE", anoCurricular: 1,
  cargaHorariaTeorica: 0, cargaHorariaPratica: 0, cargaHorariaTP: 0,
  cargaHorariaE: 0, ects: 1, semestre: 1, numSemanas: 15,
});
const catalogo = ["U1", "U2", "U3"].map(uc);
let id = 0;
const s = (ucSigla: string, tipoAula: "TP" | "PL", turma: string): SessaoHorario => ({
  id: ++id, ucNome: ucSigla, ucSigla, tipoAula, turma, docente: "", sala: "", salaTipo: "",
  diaSemana: "Sexta", horaInicio: "16:00", horaFim: "18:00", bloqueado: false, semana: 1,
});
const executar = (sessoes: SessaoHorario[], esperado: PadraoBloco100Id) => {
  const r = organizarBlocos100(sessoes, catalogo);
  assert.equal(r.naoAlocadas.length, 0);
  assert.equal(r.blocosPorPadrao[esperado], 1);
  assert.ok(r.sessoes.every(x => x.diaSemana !== "Sexta"));
  assert.deepEqual(validarBlocos100(r.sessoes, catalogo), []);
};

executar([1, 2, 3, 4].map(n => s("U1", "TP", `TP${n}`)), "TP4_MESMA_UC");
executar([s("U1", "TP", "TP1"), s("U1", "TP", "TP2"), s("U2", "TP", "TP3"), s("U2", "TP", "TP4")], "TP2_DUAS_UCS");
executar([
  s("U1", "TP", "TP3"), s("U1", "TP", "TP4"),
  ...[1, 2, 3].map(n => s("U2", "PL", `PL${n}`)),
  ...[4, 5, 6].map(n => s("U3", "PL", `PL${n}`)),
], "TP2_PL3_PL3");
executar([
  s("U1", "TP", "TP2"), s("U1", "TP", "TP3"), s("U1", "TP", "TP4"),
  ...[1, 2, 3].map(n => s("U2", "PL", `PL${n}`)),
], "TP3_PL3");

const incompleto = organizarBlocos100([s("U1", "TP", "TP1")], catalogo);
assert.equal(incompleto.sessoes.length, 0);
assert.equal(incompleto.naoAlocadas.length, 1);

const semanaParcial = organizarBlocos100(
  [1, 2, 3, 4].map(n => s("U1", "TP", `TP${n}`)),
  catalogo,
  {},
  [{ uc: catalogo[0], semanas: [{ numero: 1, diasBloqueados: ["Segunda", "Terça"] }], semanaGlobalOffset: 0 }],
);
assert.equal(semanaParcial.naoAlocadas.length, 0);
assert.ok(semanaParcial.sessoes.every(x => x.diaSemana !== "Segunda" && x.diaSemana !== "Terça"));

const cincoBlocos = Array.from({ length: 5 }, () => [1, 2, 3, 4].map(n => s("U1", "TP", `TP${n}`))).flat();
const cargaPreferida = organizarBlocos100(
  cincoBlocos,
  catalogo,
  {},
  [{ uc: catalogo[0], semanas: [{ numero: 1, diasBloqueados: ["Quarta", "Quinta", "Sexta"] }], semanaGlobalOffset: 0 }],
);
const cargaPorDia = new Map<string, number>();
for (const sessao of cargaPreferida.sessoes.filter(x => x.turma === "TP1")) cargaPorDia.set(sessao.diaSemana, (cargaPorDia.get(sessao.diaSemana) || 0) + 1);
assert.equal(cargaPreferida.naoAlocadas.length, 0);
assert.ok(Math.max(...cargaPorDia.values()) <= 3, "deve preferir até 6h por dia quando há alternativa");

const quatroBlocos = Array.from({ length: 4 }, () => [1, 2, 3, 4].map(n => s("U1", "TP", `TP${n}`))).flat();
const cargaExcecional = organizarBlocos100(
  quatroBlocos,
  catalogo,
  {},
  [{ uc: catalogo[0], semanas: [{ numero: 1, diasBloqueados: ["Segunda", "Terça", "Quinta", "Sexta"] }], semanaGlobalOffset: 0 }],
);
assert.equal(cargaExcecional.naoAlocadas.length, 0);
assert.equal(cargaExcecional.sessoes.filter(x => x.turma === "TP1" && x.diaSemana === "Quarta").length, 4);
console.log("blocos100: 8 cenários validados");
