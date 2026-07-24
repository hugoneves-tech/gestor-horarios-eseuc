import { strict as assert } from "node:assert";
import type { SessaoHorario, UC } from "./src/types";
import { organizarBlocos100 } from "./src/utils/blocos100";
import { validarHorario } from "./src/utils/validacao";

let id = 0;
const uc = (sigla: string, anoCurricular: number): UC => ({
  id: sigla,
  nome: sigla,
  sigla,
  cursoId: "CLE",
  anoCurricular,
  cargaHorariaTeorica: 0,
  cargaHorariaPratica: 0,
  cargaHorariaTP: 0,
  cargaHorariaE: 0,
  ects: 1,
  semestre: 1,
  numSemanas: 15,
});
const sessao = (
  ucSigla: string,
  tipoAula: "TP" | "PL",
  turma: string,
  semana = 1,
  diaSemana = "Segunda",
  horaInicio = "08:00",
): SessaoHorario => ({
  id: ++id,
  ucNome: ucSigla,
  ucSigla,
  tipoAula,
  turma,
  docente: "",
  sala: "",
  salaTipo: tipoAula === "PL" ? "Laboratório" : "Sala TP",
  diaSemana,
  horaInicio,
  horaFim: `${String(Number(horaInicio.slice(0, 2)) + 2).padStart(2, "0")}:00`,
  bloqueado: false,
  semana,
});

const catalogoValidacao = [uc("U1", 1)];
const seisPL = Array.from({ length: 6 }, (_, i) => sessao("U1", "PL", `PL${i + 1}`));
assert.equal(validarHorario(seisPL, catalogoValidacao).excessosPLPorBloco.length, 0);
const setePL = [...seisPL, sessao("U1", "PL", "PL7")];
const excesso = validarHorario(setePL, catalogoValidacao).excessosPLPorBloco;
assert.deepEqual(excesso, [{ chave: "1|Segunda|08:00", total: 7 }]);

// Três blocos pedagógicos independentes (anos distintos) escolheriam a mesma
// mancha sem um contador físico transversal: 3 + 3 + 3 = 9 PL.
const catalogo: UC[] = [];
const carga: SessaoHorario[] = [];
for (let ano = 1; ano <= 3; ano++) {
  const ucTP = uc(`TP${ano}`, ano);
  const ucPL = uc(`LAB${ano}`, ano);
  catalogo.push(ucTP, ucPL);
  carga.push(
    sessao(ucTP.sigla, "TP", "TP1"),
    sessao(ucTP.sigla, "TP", "TP2"),
    sessao(ucTP.sigla, "TP", "TP3"),
    sessao(ucPL.sigla, "PL", "PL10"),
    sessao(ucPL.sigla, "PL", "PL11"),
    sessao(ucPL.sigla, "PL", "PL12"),
  );
}
const organizado = organizarBlocos100(carga, catalogo, { maxPLporMancha: 6 });
assert.equal(organizado.naoAlocadas.length, 0);
const plPorMomento = new Map<string, number>();
for (const s of organizado.sessoes.filter(x => x.tipoAula === "PL")) {
  const chave = `${s.semana}|${s.diaSemana}|${s.horaInicio}`;
  plPorMomento.set(chave, (plPorMomento.get(chave) || 0) + 1);
}
assert.ok(Math.max(...plPorMomento.values()) <= 6, "o limite de 6 PL deve ser global entre anos e turmas");

console.log("limite global de 6 PL por bloco validado no organizador e no relatório");
