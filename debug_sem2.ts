import { calcularSemanas, gerarSessoesConjunto, EntradaUC } from "./src/utils/distribuicao";
import { ucsIniciais, feriadosIniciais } from "./src/mockData";

const ucList = ucsIniciais.filter(u => u.semestre === 2);
const start = "2027-02-01"; // Monday

const entradas: EntradaUC[] = ucList.map(uc => {
  const semStart = uc.semanaInicio || 1;
  const semEnd = uc.semanaFim ?? (semStart + (uc.numSemanas || 15) - 1);
  const semanas = calcularSemanas(uc.dataInicio || start, semStart, semEnd, feriadosIniciais);
  return { uc, semanas, semanaGlobalOffset: 15 };
});

const sessoes = gerarSessoesConjunto(entradas, 2, 0);
const firstWeekMon = sessoes.filter(s => s.semana === 16 && s.diaSemana === "Segunda");
console.log("First Week Sessions Monday:");
firstWeekMon.forEach(s => console.log(`${s.ucSigla} - ${s.tipoAula} - ${s.turma}: ${s.diaSemana} ${s.horaInicio}`));
