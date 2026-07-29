import { strict as assert } from "node:assert";
import { organizarBlocos100, validarBlocos100, type PadraoBloco100Id } from "./src/utils/blocos100";
import type { SessaoHorario, UC } from "./src/types";
import { rowToRegra } from "./src/data/mappers";
import { validarHorario } from "./src/utils/validacao";

const uc = (id: string): UC => ({
  id, nome: id, sigla: id, cursoId: "CLE", anoCurricular: 1,
  cargaHorariaTeorica: 0, cargaHorariaPratica: 0, cargaHorariaTP: 0,
  cargaHorariaE: 0, ects: 1, semestre: 1, numSemanas: 15,
});
const catalogo = ["U1", "U2", "U3"].map(uc);
const catalogoMax3 = catalogo.map(u => (
  u.id === "U2" || u.id === "U3" ? { ...u, maxSimultaneoPL: 3 } : u
));
const regraLegada = rowToRegra({
  id: "h_blocos_ocupacao_100", nome: "Blocos", tipo: "hard", ativa: true,
  config: { motor: { blocos100: { preferirSextaLivre: true } } },
});
assert.equal((regraLegada.config as any).motor.blocos100.preferirSextaLivre, true);
const cargaLegada = rowToRegra({
  id: "h_carga_diaria_estudantes", nome: "Carga diária", tipo: "hard", ativa: true,
  config: { motor: { cargaDiariaEstudante: { alvoHoras: 6, maxHoras: 8, maxDiasNoMaximoPorSemana: 1 } } },
});
assert.equal((cargaLegada.config as any).motor.cargaDiariaEstudante.maxDiasNoMaximoPorSemana, 5);
let id = 0;
const s = (ucSigla: string, tipoAula: "TP" | "PL", turma: string): SessaoHorario => ({
  id: ++id, ucNome: ucSigla, ucSigla, tipoAula, turma, docente: "", sala: "", salaTipo: "",
  diaSemana: "Sexta", horaInicio: "16:00", horaFim: "18:00", bloqueado: false, semana: 1,
});
const executar = (sessoes: SessaoHorario[], esperado: PadraoBloco100Id, catalogoTeste = catalogo) => {
  const r = organizarBlocos100(sessoes, catalogoTeste);
  assert.equal(r.naoAlocadas.length, 0);
  assert.equal(r.blocosPorPadrao[esperado], 1);
  assert.ok(r.sessoes.every(x => x.diaSemana !== "Sexta"));
  assert.deepEqual(validarBlocos100(r.sessoes, catalogoTeste), []);
};

executar([1, 2, 3, 4].map(n => s("U1", "TP", `TP${n}`)), "TP4_MESMA_UC");
executar([s("U1", "TP", "TP1"), s("U1", "TP", "TP2"), s("U2", "TP", "TP3"), s("U2", "TP", "TP4")], "TP2_DUAS_UCS");
executar([
  s("U1", "TP", "TP3"), s("U1", "TP", "TP4"),
  ...[1, 2, 3, 4, 5, 6].map(n => s("U2", "PL", `PL${n}`)),
], "TP2_PL6_DUAS_UCS");
const tpEPlDaMesmaUc = [
  s("U1", "TP", "TP3"), s("U1", "TP", "TP4"),
  ...[1, 2, 3, 4, 5, 6].map(n => s("U1", "PL", `PL${n}`)),
];
assert.equal(validarBlocos100(tpEPlDaMesmaUc, catalogo).length, 1);

const t = (semana: number, diaSemana: string, horaInicio: string): SessaoHorario => ({
  id: ++id, ucNome: "U1", ucSigla: "U1", tipoAula: "T", turma: "Turma A",
  docente: "", sala: "", salaTipo: "", diaSemana, horaInicio,
  horaFim: `${String(Number(horaInicio.slice(0, 2)) + 2).padStart(2, "0")}:00`,
  bloqueado: false, semana,
});
const quatroT = [
  t(1, "Segunda", "08:00"), t(1, "Segunda", "10:00"),
  t(1, "Segunda", "12:00"), t(1, "Terça", "08:00"),
];
const blocoDepoisDasQuatroT = [
  s("U1", "TP", "TP3"), s("U1", "TP", "TP4"),
  ...[1, 2, 3, 4, 5, 6].map(n => s("U2", "PL", `PL${n}`)),
];
const comPrecedencia = organizarBlocos100([...quatroT, ...blocoDepoisDasQuatroT], catalogo, {
  precedenciasUC: [{ siglas: ["U1"], tipoAntes: "T", tipoDepois: "TP", minimoAntes: 4 }],
});
assert.equal(comPrecedencia.naoAlocadas.length, 0);
const primeiraTP = comPrecedencia.sessoes.find(x => x.ucSigla === "U1" && x.tipoAula === "TP")!;
const ordem = (x: SessaoHorario) => (x.semana ?? 0) * 1000
  + ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"].indexOf(x.diaSemana) * 10
  + ["08:00", "10:00", "12:00", "14:00", "16:00", "18:00"].indexOf(x.horaInicio);
assert.ok(ordem(primeiraTP) > ordem(quatroT[3]));

executar([
  s("U1", "TP", "TP3"), s("U1", "TP", "TP4"),
  ...[1, 2, 3].map(n => s("U2", "PL", `PL${n}`)),
  ...[4, 5, 6].map(n => s("U3", "PL", `PL${n}`)),
], "TP2_PL3_PL3", catalogoMax3);

const catalogoTpMax2 = catalogoMax3.map(u =>
  u.id === "U1" ? { ...u, maxSimultaneoTP: 2 } : u);
executar([
  s("U1", "TP", "TP3"), s("U1", "TP", "TP4"),
  ...[1, 2, 3].map(n => s("U2", "PL", `PL${n}`)),
  ...[4, 5, 6].map(n => s("U3", "PL", `PL${n}`)),
], "TP2_PL3_PL3", catalogoTpMax2);
const tresTpAcimaDoMaximo = organizarBlocos100([
  s("U1", "TP", "TP2"), s("U1", "TP", "TP3"), s("U1", "TP", "TP4"),
  ...[1, 2, 3].map(n => s("U2", "PL", `PL${n}`)),
], catalogoTpMax2);
assert.equal(tresTpAcimaDoMaximo.sessoes.length, 0);
assert.equal(tresTpAcimaDoMaximo.naoAlocadas.length, 6);

const seisPlAcimaDoMaximo = organizarBlocos100([
  s("U1", "TP", "TP3"), s("U1", "TP", "TP4"),
  ...[1, 2, 3, 4, 5, 6].map(n => s("U2", "PL", `PL${n}`)),
], catalogoMax3);
assert.equal(seisPlAcimaDoMaximo.sessoes.length, 0);
assert.equal(seisPlAcimaDoMaximo.naoAlocadas.length, 8);
executar([
  s("U1", "TP", "TP2"), s("U1", "TP", "TP3"), s("U1", "TP", "TP4"),
  ...[1, 2, 3].map(n => s("U2", "PL", `PL${n}`)),
], "TP3_PL3");

const turnosRigidos = organizarBlocos100([
  ...[1, 2, 3, 4].map(n => s("U1", "TP", `TP${n}`)),
  ...[5, 6, 7, 8].map(n => s("U1", "TP", `TP${n}`)),
], catalogo, { prefTurmaAManha: { "1|1": true } });
assert.equal(turnosRigidos.naoAlocadas.length, 0);
assert.ok(turnosRigidos.sessoes.filter(x => /^TP[1-4]$/.test(x.turma)).every(x => ["08:00", "10:00", "12:00"].includes(x.horaInicio)));
assert.ok(turnosRigidos.sessoes.filter(x => /^TP[5-8]$/.test(x.turma)).every(x => ["14:00", "16:00", "18:00"].includes(x.horaInicio)));

const externaB = (horaInicio: "14:00" | "16:00", horaFim: "16:00" | "18:00"): SessaoHorario => ({
  ...s("U1", "TP", "TP5"),
  tipoAula: "T",
  turma: "Turma B",
  diaSemana: "Sexta",
  horaInicio,
  horaFim,
});
const sexta18 = organizarBlocos100(
  [5, 6, 7, 8].map(n => s("U1", "TP", `TP${n}`)),
  catalogo,
  { prefTurmaAManha: { "1|1": true } },
  [{ uc: catalogo[0], semanas: [{ numero: 1, diasBloqueados: ["Segunda", "Terça", "Quarta", "Quinta"] }], semanaGlobalOffset: 0 }],
  [externaB("14:00", "16:00"), externaB("16:00", "18:00")],
);
assert.equal(sexta18.naoAlocadas.length, 0);
assert.ok(sexta18.sessoes.every(x => x.diaSemana === "Sexta" && x.horaInicio === "18:00"));

const sextaComoDiaNormal = organizarBlocos100(
  Array.from({ length: 3 }, () => [5, 6, 7, 8].map(n => ({ ...s("U1", "TP", `TP${n}`), semana: 5 }))).flat(),
  catalogo,
  { prefTurmaAManha: { "1|1": true }, preferirSextaLivre: false },
);
assert.equal(sextaComoDiaNormal.naoAlocadas.length, 0);
assert.ok(
  sextaComoDiaNormal.sessoes.some(x => x.diaSemana === "Quinta")
    && sextaComoDiaNormal.sessoes.every(x => ["08:00", "10:00", "12:00"].includes(x.horaInicio)),
  "uma semana de turma única deve preencher quinta-feira e usar a manhã antes da tarde",
);

const quatroDiasCombinados = organizarBlocos100(
  Array.from({ length: 12 }, () => [
    s("U1", "TP", "TP3"), s("U1", "TP", "TP4"),
    ...[1, 2, 3, 4, 5, 6].map(n => s("U2", "PL", `PL${n}`)),
  ]).flat(),
  catalogo,
  { preferirSextaLivre: true },
);
assert.equal(quatroDiasCombinados.naoAlocadas.length, 0);
assert.ok(
  quatroDiasCombinados.sessoes.every(x => x.diaSemana !== "Sexta"),
  "quando quatro dias chegam para a carga semanal, a sexta-feira deve ficar livre",
);

const catalogoS2Parcial = ["T-S2", "TP-S2"].map(sigla => ({
  ...uc(sigla),
  anoCurricular: 2,
  semestre: 2,
}));
const tS2 = (diaSemana: string, horaInicio: string): SessaoHorario => ({
  ...t(25, diaSemana, horaInicio),
  ucNome: "T-S2",
  ucSigla: "T-S2",
});
const tS2B = (diaSemana: string, horaInicio: string): SessaoHorario => ({
  ...tS2(diaSemana, horaInicio),
  turma: "Turma B",
});
const completarDiaS2 = organizarBlocos100(
  [
    ...["Segunda", "Ter\u00e7a", "Quarta"].flatMap(dia =>
      ["14:00", "16:00", "18:00"].map(hora => tS2(dia, hora))),
    ...["Segunda", "Ter\u00e7a", "Quarta"].flatMap(dia =>
      ["08:00", "10:00", "12:00"].map(hora => tS2B(dia, hora))),
    ...[1, 2, 3, 4].map(n => ({ ...s("TP-S2", "TP", `TP${n}`), semana: 25 })),
    ...[5, 6, 7, 8].map(n => ({ ...s("TP-S2", "TP", `TP${n}`), semana: 25 })),
  ],
  catalogoS2Parcial,
  { preferirSextaLivre: true },
);
const cargaS2PorDia = new Map<string, number>();
for (const sessao of completarDiaS2.sessoes.filter(x => x.turma === "TP1" || x.turma === "Turma A")) {
  cargaS2PorDia.set(sessao.diaSemana, (cargaS2PorDia.get(sessao.diaSemana) || 0) + 1);
}
assert.equal(completarDiaS2.naoAlocadas.length, 0);
assert.deepEqual(
  [...cargaS2PorDia.values()].sort((a, b) => a - b),
  [3, 3, 4],
  "um bloco residual de 2h deve completar um dia de 6h para 8h, não abrir um dia parcial",
);

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

const tardeQuartaBloqueada = organizarBlocos100(
  [1, 2, 3, 4].map(n => s("U1", "TP", `TP${n}`)),
  catalogo,
  {
    restricoesUC: [{
      siglas: ["U1"],
      diasProibidos: ["Quarta"],
      periodosProibidos: ["tarde"],
      semanasRestritas: [1],
    }],
  },
  [{ uc: catalogo[0], semanas: [{ numero: 1, diasBloqueados: ["Segunda", "Terça", "Quinta", "Sexta"] }], semanaGlobalOffset: 0 }],
);
assert.equal(tardeQuartaBloqueada.naoAlocadas.length, 0);
assert.ok(
  tardeQuartaBloqueada.sessoes.every(x => !(x.semana === 1 && x.diaSemana === "Quarta" && Number(x.horaInicio.slice(0, 2)) >= 14)),
  "a reorganização TP/PL também tem de respeitar a tarde bloqueada pela regra do Supabase",
);
assert.ok(
  tardeQuartaBloqueada.sessoes.some(x => x.semana === 1 && x.diaSemana === "Quarta" && Number(x.horaInicio.slice(0, 2)) < 14),
  "bloquear quarta à tarde não pode bloquear a quarta-feira de manhã",
);

const plForaDaPrimeiraSemana = organizarBlocos100(
  [
    s("U1", "TP", "TP3"), s("U1", "TP", "TP4"),
    ...[1, 2, 3, 4, 5, 6].map(n => s("U2", "PL", `PL${n}`)),
  ],
  catalogo,
  {
    restricoesUC: [{
      siglas: ["U2"],
      tipos: ["PL"],
      semanasRestritas: [1],
      diasProibidos: ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"],
    }],
  },
  catalogo.map(ucAtiva => ({
    uc: ucAtiva,
    semanas: [{ numero: 1 }, { numero: 2 }],
    semanaGlobalOffset: 0,
  })),
);
assert.equal(plForaDaPrimeiraSemana.naoAlocadas.length, 0);
assert.ok(
  plForaDaPrimeiraSemana.sessoes.filter(x => x.tipoAula === "PL").every(x => x.semana !== 1),
  "uma regra hard do Supabase deve impedir qualquer PL na semana 1",
);

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

const dataPrioritaria = organizarBlocos100(
  Array.from({ length: 3 }, () => [1, 2, 3, 4].map(n => s("U1", "TP", `TP${n}`))).flat(),
  catalogo,
  { diasPrioritarios: [{ semana: 1, dia: "Quinta", minimoBlocos: 3 }] },
  [{ uc: catalogo[0], semanas: [{ numero: 1 }], semanaGlobalOffset: 0 }],
);
assert.equal(dataPrioritaria.naoAlocadas.length, 0);
assert.equal(
  dataPrioritaria.sessoes.filter(x => x.turma === "TP1" && x.diaSemana === "Quinta").length,
  3,
  "as datas assinaladas nas regras do Supabase devem receber os três blocos prioritários",
);

const catalogoArranqueS2 = ["U1", "U2", "U3"].map(sigla => ({
  ...uc(sigla),
  anoCurricular: 2,
  semestre: 2,
  cargaHorariaTeorica: 2,
  cargaHorariaTP: 6,
}));
const tArranqueS2 = catalogoArranqueS2.map((ucT, indice) => ({
  ...t(16, "Quarta", ["08:00", "10:00", "12:00"][indice]),
  ucNome: ucT.nome,
  ucSigla: ucT.sigla,
  turma: "Turma B",
}));
const tpArranqueS2 = catalogoArranqueS2.flatMap(ucTP =>
  [5, 6, 7, 8].map(n => ({
    ...s(ucTP.sigla, "TP", `TP${n}`),
    semana: 16,
  })));
const quintaS16 = organizarBlocos100(
  [...tArranqueS2, ...tpArranqueS2],
  catalogoArranqueS2,
  {},
  catalogoArranqueS2.map(ucAtiva => ({
    uc: ucAtiva,
    semanas: [{ numero: 1, diasBloqueados: ["Segunda", "Terça"] }],
    semanaGlobalOffset: 15,
  })),
);
const blocosQuintaS16 = new Set(
  quintaS16.sessoes
    .filter(x => x.semana === 16 && x.diaSemana === "Quinta" && x.tipoAula === "TP")
    .map(x => x.horaInicio),
);
assert.equal(quintaS16.naoAlocadas.length, 0);
assert.deepEqual([...blocosQuintaS16].sort(), ["08:00", "10:00", "12:00"]);
assert.ok(
  quintaS16.sessoes
    .filter(x => x.semana === 16 && x.diaSemana === "Quinta")
    .every(x => x.tipoAula === "TP" && ["U1", "U2", "U3"].includes(x.ucSigla)),
  "a quinta da semana 16 deve conter apenas TP das mesmas três UCs com T na quarta",
);

const quartoBlocoArranqueS2 = [5, 6, 7, 8].map((n, indice) => ({
  ...s("U1", "TP", `TP${n}`),
  id: 20_000 + indice,
  semana: 16,
}));
const arranqueS2ComCargaExtra = organizarBlocos100(
  [...tArranqueS2, ...tpArranqueS2, ...quartoBlocoArranqueS2],
  catalogoArranqueS2,
  {},
  catalogoArranqueS2.map(ucAtiva => ({
    uc: ucAtiva,
    semanas: [{ numero: 1, diasBloqueados: ["Segunda", "Terça"] }],
    semanaGlobalOffset: 15,
  })),
);
const horasQuintaComCargaExtra = new Set(
  arranqueS2ComCargaExtra.sessoes
    .filter(x => x.semana === 16 && x.diaSemana === "Quinta")
    .map(x => x.horaInicio),
);
assert.equal(arranqueS2ComCargaExtra.naoAlocadas.length, 0);
assert.deepEqual(
  [...horasQuintaComCargaExtra].sort(),
  ["08:00", "10:00", "12:00"],
  "mesmo com carga adicional, a quinta da semana 16 deve manter exatamente 6h",
);
assert.ok(
  arranqueS2ComCargaExtra.sessoes.some(x =>
    x.semana === 16 && x.diaSemana !== "Quinta" && x.tipoAula === "TP"),
  "o quarto bloco deve ser deslocado para outro dia",
);

const quatroBlocos = Array.from({ length: 4 }, () => [1, 2, 3, 4].map(n => s("U1", "TP", `TP${n}`))).flat();
const cargaExcecional = organizarBlocos100(
  quatroBlocos,
  catalogo,
  {},
  [{ uc: catalogo[0], semanas: [{ numero: 1, diasBloqueados: ["Segunda", "Terça", "Quinta", "Sexta"] }], semanaGlobalOffset: 0 }],
);
assert.equal(cargaExcecional.naoAlocadas.length, 0, "o quarto bloco controlado deve permitir completar a semana");
const quartaExcecional = cargaExcecional.sessoes.filter(x => x.turma === "TP1" && x.diaSemana === "Quarta");
assert.equal(quartaExcecional.length, 4);
assert.ok(quartaExcecional.some(x => x.horaInicio === "16:00"), "a Turma A deve usar 16h–18h como quarto bloco, preservando o almoço");

const dozeBlocos = Array.from({ length: 12 }, () => [1, 2, 3, 4].map(n => s("U1", "TP", `TP${n}`))).flat();
const tresDiasExcecionais = organizarBlocos100(
  dozeBlocos,
  catalogo,
  {},
  [{ uc: catalogo[0], semanas: [{ numero: 1, diasBloqueados: ["Segunda", "Terça"] }], semanaGlobalOffset: 0 }],
);
const cargaTresDias = new Map<string, number>();
for (const sessao of tresDiasExcecionais.sessoes.filter(x => x.turma === "TP1")) {
  cargaTresDias.set(sessao.diaSemana, (cargaTresDias.get(sessao.diaSemana) || 0) + 1);
}
assert.equal(tresDiasExcecionais.naoAlocadas.length, 0, "três dias de 8h devem completar uma semana de carga elevada");
assert.equal([...cargaTresDias.values()].filter(carga => carga === 4).length, 3);

const catalogoSequencia = [
  { ...uc("U1"), cargaHorariaTeorica: 2, cargaHorariaTP: 2, cargaHorariaPratica: 2 },
  uc("U2"),
];
const sequenciaGeral = organizarBlocos100([
  t(1, "Segunda", "08:00"),
  ...[1, 2, 3, 4].map(n => s("U1", "TP", `TP${n}`)),
  s("U2", "TP", "TP3"), s("U2", "TP", "TP4"),
  ...[1, 2, 3, 4, 5, 6].map(n => s("U1", "PL", `PL${n}`)),
], catalogoSequencia);
assert.equal(sequenciaGeral.naoAlocadas.length, 0);
const primeiroMomento = (tipo: "T" | "TP" | "PL") =>
  Math.min(...sequenciaGeral.sessoes.filter(x => x.ucSigla === "U1" && x.tipoAula === tipo).map(ordem));
assert.ok(primeiroMomento("T") < primeiroMomento("TP"));
assert.ok(primeiroMomento("TP") < primeiroMomento("PL"));

const blocosFamiliasComUcPartilhada = organizarBlocos100([
  s("U1", "TP", "TP3"), s("U1", "TP", "TP4"),
  ...[1, 2, 3, 4, 5, 6].map(n => s("U2", "PL", `PL${n}`)),
  s("U3", "TP", "TP7"), s("U3", "TP", "TP8"),
  ...[13, 14, 15, 16, 17, 18].map(n => s("U1", "PL", `PL${n}`)),
], catalogo, {
  semanasSoTurmaA: { 1: [1] },
  semanasSoTurmaB: { 1: [1] },
}, [
  ...catalogo.map(ucAtiva => ({ uc: ucAtiva, semanas: [{ numero: 1 }], semanaGlobalOffset: 0 })),
]);
assert.equal(blocosFamiliasComUcPartilhada.naoAlocadas.length, 0);
const tiposU1PorSlot = new Map<string, Set<string>>();
for (const sessao of blocosFamiliasComUcPartilhada.sessoes.filter(x => x.ucSigla === "U1")) {
  const chave = `${sessao.semana}|${sessao.diaSemana}|${sessao.horaInicio}`;
  if (!tiposU1PorSlot.has(chave)) tiposU1PorSlot.set(chave, new Set());
  tiposU1PorSlot.get(chave)!.add(sessao.tipoAula);
}
assert.ok([...tiposU1PorSlot.values()].every(tipos => !(tipos.has("TP") && tipos.has("PL"))));

const dezasseisBlocos = Array.from({ length: 16 }, () =>
  [1, 2, 3, 4].map(n => ({ ...s("U1", "TP", `TP${n}`), semana: 1 }))).flat();
const semanaCincoDias = organizarBlocos100(
  dezasseisBlocos,
  catalogo,
  { cargaDiariaEstudante: { alvoHoras: 6, maxHoras: 8, maxDiasNoMaximoPorSemana: 3 } },
  [{ uc: catalogo[0], semanas: [{ numero: 1 }], semanaGlobalOffset: 0 }],
);
const diasTp1 = new Map<string, number>();
for (const sessao of semanaCincoDias.sessoes.filter(x => x.turma === "TP1")) {
  diasTp1.set(sessao.diaSemana, (diasTp1.get(sessao.diaSemana) || 0) + 1);
}
assert.equal(semanaCincoDias.naoAlocadas.length, 0);
assert.ok(diasTp1.has("Quinta"));
assert.ok([...diasTp1.values()].filter(total => total === 4).length <= 3);

const ucUmaFamilia: UC = {
  ...uc("U-I"),
  sigla: "U-I",
  cargaHorariaTeorica: 2,
  turmasConfig: [{ id: "t1", nome: "Turma A", tipo: "Teórica" }],
};
const sessaoUmaFamilia: SessaoHorario = {
  ...t(1, "Segunda", "08:00"),
  ucNome: "U-I",
  ucSigla: "U-I",
};
assert.equal(validarHorario([sessaoUmaFamilia], [ucUmaFamilia]).completude.pct, 100);
console.log("blocos100: combinações, turnos, sexta 18h–20h e dias de 8h validados");
