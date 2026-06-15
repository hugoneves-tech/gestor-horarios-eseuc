// Teste end-to-end do módulo de importação: gerar → CSV (formato template) → parse → validar.
import { gerarSessoesConjunto, calcularSemanas, type EntradaUC } from "../src/utils/distribuicao";
import { parseHorarioCSV, gerarTemplateCSV } from "../src/utils/importacao";
import { validarHorario } from "../src/utils/validacao";
import { ucsIniciais, anosSemestresIniciais, feriadosIniciais } from "../src/mockData";

function build(sem: number) {
  const ent: EntradaUC[] = [];
  for (const uc of ucsIniciais) {
    if (!uc.turmasConfig?.length || Number(uc.anoCurricular) === 3 || uc.semestre !== sem) continue;
    const a = anosSemestresIniciais.find(s => s.semestre === uc.semestre);
    if (!a?.dataInicioSemestre) continue;
    const di = uc.dataInicio || a.dataInicioSemestre;
    const ss = uc.semanaInicio || 1;
    ent.push({ uc, semanas: calcularSemanas(di, ss, ss + (uc.numSemanas || 15) - 1, feriadosIniciais), semanaGlobalOffset: sem === 2 ? 15 : 0 });
  }
  return ent;
}
const opts = {
  maxTPporMancha: null, ucConflitos: [["ESDAC", "EIG"]],
  semanasSoTurmaA: [8, 9, 10, 11, 12, 13, 14, 15], semanasSoTurmaB: [16, 17, 18, 19, 20, 21, 22, 23],
} as any;
const oc = new Set<string>(), pc = new Map<string, number>();
const s1 = gerarSessoesConjunto(build(1) as any, 1, 0, oc, pc, opts);
const s2 = gerarSessoesConjunto(build(2) as any, 2, s1.length, oc, pc, opts);
const all = [...s1, ...s2];

// 1) Gerar CSV no formato do template a partir das sessões geradas.
const cab = "Semana;Dia;Hora;UC;Tipo;Turma;Docente;Sala";
const linhas = all.map(s => [s.semana, s.diaSemana, s.horaInicio, s.ucSigla, s.tipoAula, s.turma, "", ""].join(";"));
const csv = "﻿" + [cab, ...linhas].join("\r\n");

// 2) Reimportar e validar.
const { sessoes, erros } = parseHorarioCSV(csv, ucsIniciais);
console.log(`Gerado: ${all.length} blocos → CSV → parse: ${sessoes.length} sessões, ${erros.length} erros.`);
if (erros.length) for (const e of erros.slice(0, 5)) console.log(`  ✗ Linha ${e.linha}: ${e.motivo}`);

const rel = validarHorario(sessoes, ucsIniciais);
console.log(`Validação → ok=${rel.ok} | completude ${rel.completude.pct}% | sobreposições ${rel.sobreposicoes} | máx ${rel.maxBlocosDia * 2}h | almoço ${rel.violacoesAlmoco} | cronologia ${rel.violacoesCronologia.length} | TP+PL mesma UC ${rel.tpPlMesmaUC.length}`);

// 3) Erros propositados: o parser deve apanhá-los.
const csvMau = "﻿" + [cab,
  "31;Quinta;08:00;ESDAC;PL;PL3;;",        // semana fora do intervalo
  "5;Sabado;08:00;EIG;TP;TP1;;",           // dia inválido
  "5;Quinta;09:00;EIG;TP;TP1;;",           // hora inválida
  "5;Quinta;08:00;XXX;PL;PL3;;",           // UC desconhecida
  "5;Quinta;08:00;EIG;ZZ;TP1;;",           // tipo inválido
  "5;Quinta;08:00;EIG;TP;TP99;;",          // turma inválida
].join("\r\n");
const r2 = parseHorarioCSV(csvMau, ucsIniciais);
console.log(`\nLinhas inválidas detetadas: ${r2.erros.length}/6 (esperado 6), válidas: ${r2.sessoes.length}.`);

// 4) Template gera e tem cabeçalho.
console.log(`Template começa com cabeçalho correto: ${gerarTemplateCSV().includes(cab)}`);
