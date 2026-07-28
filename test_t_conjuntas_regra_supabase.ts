import assert from "node:assert/strict";
import type { UC } from "./src/types";
import { gerarSessoesConjunto, type EntradaUC, type SemanaInfo } from "./src/utils/distribuicao";
import { validarHorario } from "./src/utils/validacao";

const criarUC = (id: string, sigla: string): UC => ({
  id,
  nome: sigla,
  sigla,
  cursoId: "c1",
  anoCurricular: 2,
  semestre: 1,
  cargaHorariaTeorica: 4,
  cargaHorariaTP: 2,
  cargaHorariaPratica: 0,
  cargaHorariaE: 0,
  ects: 4,
  numSemanas: 1,
  turmasTSimultaneas: sigla === "UC1",
  horariosTSimultaneas: ["10:00", "16:00"],
  turmasConfig: [
    { id: `${id}_a`, nome: "Turma A", tipo: "Teórica" },
    { id: `${id}_b`, nome: "Turma B", tipo: "Teórica" },
    { id: `${id}_tp1`, nome: "TP1", tipo: "TeoricoPratica" },
    { id: `${id}_tp5`, nome: "TP5", tipo: "TeoricoPratica" },
  ],
});

const semana: SemanaInfo = {
  numero: 1,
  numeroPedagogico: 1,
  dataSegunda: "2026-09-07",
  dataSexta: "2026-09-11",
  diasUteis: 3,
  fator: 1,
  feriadosNesta: [],
  diasBloqueados: ["Segunda", "Terça"],
};
const entradas: EntradaUC[] = ["UC1", "UC2"].map((sigla, i) => ({
  uc: criarUC(`uc_${i + 1}`, sigla),
  semanas: [semana],
  semanaGlobalOffset: 0,
}));

const sessoes = gerarSessoesConjunto(entradas, 1, 0, new Set(), new Map(), {
  restricoesUC: [{
    siglas: ["UC1", "UC2"],
    diasProibidos: ["Quarta"],
    periodosProibidos: ["tarde"],
    semanasRestritas: [1],
  }],
  aulasTConjuntas: [{
    anos: [2],
    semanas: [1],
    dias: ["Quarta", "Sexta"],
    horarios: ["08:00", "10:00", "12:00"],
    sala: "Auditório Geral ESEUC",
    obrigatoriaPorDia: true,
    siglasObrigatorias: ["uc1"],
  }],
  precedenciasUC: [{
    siglas: ["uc1"],
    tipoAntes: "T",
    tipoDepois: "TP",
    minimoAntes: 4,
    unidade: "horas",
  }],
});
const regraTConjunta = [{
  anos: [2],
  semanas: [1],
  dias: ["Quarta", "Sexta"],
  horarios: ["08:00", "10:00", "12:00"],
  sala: "Auditório Geral ESEUC",
  obrigatoriaPorDia: true,
  siglasObrigatorias: ["uc1"],
}];

for (const dia of ["Quarta", "Sexta"]) {
  const doDia = sessoes.filter(s => s.semana === 1 && s.diaSemana === dia && s.tipoAula === "T");
  assert.ok(doDia.length >= 2, `${dia} deve ter pelo menos um bloco T conjunto`);
  const porBloco = new Map<string, typeof doDia>();
  for (const s of doDia) {
    const grupo = porBloco.get(s.horaInicio) || [];
    grupo.push(s);
    porBloco.set(s.horaInicio, grupo);
  }
  for (const grupo of porBloco.values()) {
    assert.deepEqual(new Set(grupo.map(s => s.turma)), new Set(["Turma A", "Turma B"]));
    assert.equal(new Set(grupo.map(s => s.ucSigla)).size, 1, `${dia}: nunca podem coexistir UCs T diferentes`);
    assert.deepEqual(new Set(grupo.map(s => s.sala)), new Set(["Auditório Geral ESEUC"]));
  }
  assert.ok(doDia.some(s => s.ucSigla === "UC1"), `${dia} deve reservar a UC obrigatória`);
  assert.ok(doDia.filter(s => s.ucSigla === "UC1").every(s => s.horaInicio === "10:00"), `${dia}: deve cruzar a regra com o horário permitido da UC`);
}

assert.ok(sessoes
  .filter(s => s.semana === 1 && s.diaSemana === "Quarta")
  .every(s => Number(s.horaInicio.slice(0, 2)) < 14), "quarta-feira à tarde continua bloqueada");
assert.deepEqual(
  validarHorario(sessoes, entradas.map(e => e.uc), 6, regraTConjunta).violacoesTConjuntas,
  [],
  "o validador também deve confirmar a regra, não apenas o gerador",
);
const ordem = (s: (typeof sessoes)[number]) =>
  (s.semana || 0) * 1000
  + ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"].indexOf(s.diaSemana) * 10
  + ["08:00", "10:00", "12:00", "14:00", "16:00", "18:00"].indexOf(s.horaInicio);
const primeirasTP = sessoes.filter(s => s.ucSigla === "UC1" && s.tipoAula === "TP");
assert.ok(primeirasTP.length > 0);
for (const turma of ["Turma A", "Turma B"]) {
  const duasT = sessoes
    .filter(s => s.ucSigla === "UC1" && s.tipoAula === "T" && s.turma === turma)
    .sort((a, b) => ordem(a) - ordem(b))
    .slice(0, 2);
  assert.equal(duasT.length, 2, `${turma} deve receber dois blocos, num total de 4h T`);
  const familia = turma === "Turma A" ? /^TP[1-4]$/ : /^TP[5-8]$/;
  assert.ok(
    primeirasTP.filter(tp => familia.test(tp.turma)).every(tp => ordem(tp) > ordem(duasT[1])),
    `nenhuma TP de ${turma} pode anteceder as 4h T`,
  );
}

console.log("OK: regra Supabase cria T conjunta na primeira quarta e sexta.");
