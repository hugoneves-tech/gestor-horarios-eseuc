import assert from "node:assert/strict";
import type { CargaDocenteProvisoria, UC } from "./src/types";
import { calcularCoberturaDocente, distribuirTurmasDocentes } from "./src/utils/atribuicaoDocentes";

const uc: UC = {
  id: "uc2", nome: "UC Teste", sigla: "UCT", cursoId: "c1", anoCurricular: 2, semestre: 1,
  cargaHorariaTeorica: 0, cargaHorariaTP: 4, cargaHorariaPratica: 0, cargaHorariaE: 0, ects: 4, numSemanas: 15,
  turmasConfig: [
    { id: "tp1", nome: "TP1", tipo: "TeoricoPratica" },
    { id: "tp2", nome: "TP2", tipo: "TeoricoPratica" },
  ],
};
const carga = (id: string, docenteId: string, preferidas: string[] = []): CargaDocenteProvisoria => ({
  id, docenteId, ucId: uc.id, anoSemestreId: "as1", tipologia: "TP", numeroTurmas: 1,
  horasPorTurma: 4, modoTurmas: preferidas.length ? "manual" : "automatico", turmasSelecionadas: preferidas, provisoria: true,
});
const cargas = [carga("c1", "d1", ["TP2"]), carga("c2", "d2")];

const cobertura = calcularCoberturaDocente([uc], cargas, "as1", 2);
assert.equal(cobertura.length, 1);
assert.deepEqual(cobertura[0], { ucId: "uc2", ucSigla: "UCT", tipologia: "TP", numeroTurmas: 2, horasDisponiveis: 8, horasDeclaradas: 8, diferenca: 0 });

const resultado = distribuirTurmasDocentes([uc], cargas, "as1", 2);
assert.deepEqual(resultado.turmasPorCarga.get("c1"), ["TP2"]);
assert.deepEqual(resultado.turmasPorCarga.get("c2"), ["TP1"]);
assert.equal(resultado.atribuicoes.length, 4);
assert.equal(new Set(resultado.atribuicoes.map(a => `${a.turma}|${a.numeroAula}`)).size, 4);

console.log("Atribuição docente: cobertura e distribuição exata validadas.");
