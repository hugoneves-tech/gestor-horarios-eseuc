import assert from "node:assert/strict";
import type { UC } from "./src/types";
import { gerarSessoesConjunto, type EntradaUC, type SemanaInfo } from "./src/utils/distribuicao";
import { validarHorario } from "./src/utils/validacao";

const uc: UC = {
  id: "uc_psis_test", nome: "Psicologia da Saúde", sigla: "PsiS", cursoId: "c1",
  anoCurricular: 2, semestre: 1, cargaHorariaTeorica: 4, cargaHorariaTP: 0,
  cargaHorariaPratica: 0, cargaHorariaE: 0, ects: 4, numSemanas: 2,
  turmasTSimultaneas: true, horariosTSimultaneas: ["10:00", "16:00"],
  turmasConfig: [
    { id: "ta", nome: "Turma A", tipo: "Teórica" },
    { id: "tb", nome: "Turma B", tipo: "Teórica" },
  ],
};

const semanas: SemanaInfo[] = [1, 2].map(numero => ({
  numero, dataSegunda: `2026-09-${String(7 + (numero - 1) * 7).padStart(2, "0")}`,
  dataSexta: `2026-09-${String(11 + (numero - 1) * 7).padStart(2, "0")}`,
  diasUteis: 5, fator: 1, feriadosNesta: [], diasBloqueados: [], numeroPedagogico: numero,
}));
const entrada: EntradaUC = { uc, semanas, semanaGlobalOffset: 0 };
const sessoes = gerarSessoesConjunto([entrada], 1);

assert.equal(sessoes.length, 4, "2 blocos × 2 turmas T");
assert.ok(sessoes.every(s =>
  ["Segunda", "Quarta"].includes(s.diaSemana)
  || (s.diaSemana === "Sexta" && s.horaInicio === "10:00")
));
assert.ok(sessoes.every(s => ["10:00", "16:00"].includes(s.horaInicio)));

const porMomento = new Map<string, Set<string>>();
for (const s of sessoes) {
  const chave = `${s.semana}|${s.diaSemana}|${s.horaInicio}`;
  if (!porMomento.has(chave)) porMomento.set(chave, new Set());
  porMomento.get(chave)!.add(s.turma);
}
assert.ok([...porMomento.values()].every(turmas => turmas.has("Turma A") && turmas.has("Turma B") && turmas.size === 2));
assert.deepEqual(validarHorario(sessoes, [uc]).violacoesTSimultaneas, []);
const primeiraSemana = sessoes[0].semana;
const primeiroDia = sessoes[0].diaSemana;
const primeiraOcorrencia = sessoes.filter(s =>
  s.semana === primeiraSemana && s.diaSemana === primeiroDia && s.horaInicio === sessoes[0].horaInicio
);
const sextaManha = primeiraOcorrencia.map(s => ({ ...s, diaSemana: "Sexta", horaInicio: "10:00", horaFim: "12:00" }));
assert.deepEqual(validarHorario(sextaManha, [uc]).violacoesTSimultaneas, []);
const sextaTarde = primeiraOcorrencia.map(s => ({ ...s, diaSemana: "Sexta", horaInicio: "16:00", horaFim: "18:00" }));
assert.ok(validarHorario(sextaTarde, [uc]).violacoesTSimultaneas.length > 0);

const incompleto = sessoes.filter(s => s.turma !== "Turma B");
assert.ok(validarHorario(incompleto, [uc]).violacoesTSimultaneas.length > 0);

console.log("Turmas T simultâneas: geração atómica, horários e validação confirmados.");
