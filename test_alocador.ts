/**
 * Teste do ALOCADOR (Fase 3B) com os dados REAIS do snapshot do Supabase.
 *
 * Corre o único ciclo de colocação sobre as 34 regras, as 17 UCs e o calendário
 * 2026/2027, imprime um relatório legível e FALHA (exit 1) se alguma das
 * garantias estruturais for quebrada:
 *
 *  1. ZERO VIOLAÇÕES — todas as sessões produzidas pelo motor são reavaliadas,
 *     por ordem cronológica, contra o registo COMPLETO de restrições. É a
 *     asserção mais importante.
 *  2. Nenhuma aula T fora da janela do anfiteatro (terça, quinta, ou sexta à
 *     tarde) — exceto as que venham dos layouts fixos.
 *  3. Nenhuma mancha com mais PL do que o máximo global, somando toda a escola.
 *  4. Todas as manchas TP/PL correspondem a um padrão ativo com cobertura total
 *     de folhas-aluno — zero blocos parciais.
 *  5. Os dois semestres têm sessões.
 *  6. Todo o défice tem motivos preenchidos.
 *
 * NÃO se exige 100% de completude: se os dados não permitirem, o que interessa
 * é ver o défice explicado.
 *
 * As sessões que vêm de `layoutsFixos` são impostas pelo coordenador, verbatim,
 * e ficam marcadas com `bloqueado: true`. Ficam de fora das asserções 1 e 2
 * porque a regra que as acompanha veta deliberadamente TODAS as aulas da semana
 * do layout — é essa regra que mantém o motor fora daquela semana.
 *
 * Localização do snapshot: `SB_SNAPSHOT_DIR`, ou o primeiro argumento.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { carregarRegras } from "./src/regras/carregar";
import type { LinhaRegra } from "./src/regras/carregar";
import { rowToAnoSem, rowToFeriado, rowToUc } from "./src/data/mappers";
import { comMigracaoRegraGeral } from "./test_migracao_regra_geral";
import { alocar, agruparEmCandidatos, criarContextoAlocador, construirCalendario, construirRegistoCompleto } from "./src/motor/alocador";
import { criarEstado, criarHierarquia } from "./src/motor/estado";
import { coberturaFolhas, formaDe, limitesDaComposicao } from "./src/motor/padroes";
import type { FormaId } from "./src/motor/padroes";
import { primeiraViolacao } from "./src/motor/restricoes";
import { formatarCargaSemanal, formatarRelatorioAlocacao } from "./src/motor/relatorio";
import type { AnoLetivoSemestre, FeriadoInterrupcao, SessaoHorario, UC } from "./src/types";

const PASTA_SNAPSHOT =
  process.argv[2] ?? process.env.SB_SNAPSHOT_DIR ?? "C:\\Users\\hugon\\AppData\\Local\\Temp\\sb";

function lerJson(nome: string): any[] {
  const caminho = join(PASTA_SNAPSHOT, nome);
  if (!existsSync(caminho)) {
    console.error(`\nSnapshot em falta: ${caminho}`);
    console.error("Indique a pasta com SB_SNAPSHOT_DIR=... ou como primeiro argumento.");
    process.exit(1);
  }
  return JSON.parse(readFileSync(caminho, "utf8"));
}

const falhas: string[] = [];
const exigir = (condicao: boolean, mensagem: string) => {
  if (condicao) console.log(`  OK   ${mensagem}`);
  else {
    console.log(`  FALHA ${mensagem}`);
    falhas.push(mensagem);
  }
};

// ---------------------------------------------------------------------------
// 1. Carregar o snapshot real
// ---------------------------------------------------------------------------

const linhasRegras = lerJson("regras.json") as LinhaRegra[];
const linhasUcs = lerJson("ucs.json");
const linhasAnos = lerJson("anos_semestres.json");
const linhasFeriados = lerJson("feriados.json");

const ucs: UC[] = linhasUcs.map(rowToUc);
const anosSemestres: AnoLetivoSemestre[] = linhasAnos.map(rowToAnoSem);
const feriados: FeriadoInterrupcao[] = linhasFeriados.map(rowToFeriado);
const anoLetivo = anosSemestres[0]?.anoLetivo ?? "";

// O snapshot é ANTERIOR à migração da regra geral: ainda traz
// `maxTPporUCporMancha = 4`. Aplica-se-lhe por cima o que
// `supabase/migracao_regra_geral_blocos.sql` escreve, para que o motor seja
// exercitado com a regra que vai passar a valer.
const linhasComMigracao = comMigracaoRegraGeral(linhasRegras);

const { config: regras, relatorio: relRegras } = carregarRegras({
  regras: linhasComMigracao,
  ucs: linhasUcs,
  anosSemestres: linhasAnos,
});

console.log(`Snapshot: ${PASTA_SNAPSHOT}`);
console.log(
  `Regras: ${linhasRegras.length} (aplicadas ${relRegras.regrasAplicadas.length}) | UCs: ${ucs.length} | ` +
    `Feriados: ${feriados.length} | Ano letivo: ${anoLetivo}`,
);
if (relRegras.malformadas.length > 0) {
  console.error("FALHA: o snapshot tem regras malformadas; corrija-as antes de correr o alocador.");
  for (const m of relRegras.malformadas) console.error(`  ${m.caminho}: ${m.mensagem}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. Correr o alocador
// ---------------------------------------------------------------------------

const inicio = Date.now();
const { sessoes, relatorio } = alocar({ ucs, regras, feriados, anosSemestres, anoLetivo });
const duracao = Date.now() - inicio;

console.log(`\nAlocador: ${sessoes.length} sessões em ${(duracao / 1000).toFixed(1)}s\n`);
console.log(formatarRelatorioAlocacao(relatorio));
console.log("");
console.log(formatarCargaSemanal(relatorio));

// ---------------------------------------------------------------------------
// 3. Números pedidos ao relatório
// ---------------------------------------------------------------------------

const fronteira = regras.calendario.fronteiraSemestre;
const ultimoDia = regras.grelha.dias[regras.grelha.dias.length - 1];
const limiarTarde = regras.grelha.limiarTardeHora * 60;
const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
const ehTarde = (h: string) => minutos(h) >= limiarTarde;

const doLayout = sessoes.filter((s) => s.bloqueado);
const doMotor = sessoes.filter((s) => !s.bloqueado);
const s1 = sessoes.filter((s) => (s.semana ?? 0) <= fronteira);
const s2 = sessoes.filter((s) => (s.semana ?? 0) > fronteira);
const tarde = sessoes.filter((s) => ehTarde(s.horaInicio));
const sexta = sessoes.filter((s) => s.diaSemana === ultimoDia);

console.log("\n\nINDICADORES");
console.log("===========");
console.log(`  Sessões totais:              ${sessoes.length}`);
console.log(`  ... de layouts fixos:        ${doLayout.length}`);
console.log(`  ... produzidas pelo ciclo:   ${doMotor.length}`);
console.log(`  Sessões no 1.º semestre:     ${s1.length}`);
console.log(`  Sessões no 2.º semestre:     ${s2.length}`);
console.log(`  % em período de tarde:       ${((tarde.length / Math.max(1, sessoes.length)) * 100).toFixed(1)}%`);
console.log(`  % no último dia útil:        ${((sexta.length / Math.max(1, sessoes.length)) * 100).toFixed(1)}%`);
const porTipo = new Map<string, number>();
for (const s of sessoes) porTipo.set(s.tipoAula, (porTipo.get(s.tipoAula) ?? 0) + 1);
console.log(`  Por tipo:                    ${[...porTipo].map(([t, n]) => `${t}=${n}`).join("  ")}`);

// ---------------------------------------------------------------------------
// 4. ASSERÇÃO 1 — zero violações
// ---------------------------------------------------------------------------

console.log("\n\nASSERCOES");
console.log("=========");

const ucPorId = new Map<string, UC>(ucs.map((u) => [u.id, u]));
const ctxRepetido = criarContextoAlocador(regras, construirCalendario({ ucs, regras, feriados, anosSemestres, anoLetivo }, [
  ...new Set(ucs.map((u) => u.anoCurricular)),
]));
const restricoes = construirRegistoCompleto(regras, ctxRepetido);
const estadoRepetido = criarEstado(criarHierarquia(regras.estruturaTurmas));

// Replay cronológico: cada bloco é verificado contra o estado que já contém
// tudo o que lhe é anterior. É exatamente a semântica que o alocador usou.
const blocosLayout = new Set(
  agruparEmCandidatos(doLayout, ucPorId, regras).map(
    (c) => `${c.mancha.ano}|${c.mancha.semana}|${c.mancha.dia}|${c.mancha.hora}|${c.familia}`,
  ),
);
const violacoes: string[] = [];
for (const candidato of agruparEmCandidatos(sessoes, ucPorId, regras)) {
  const chave = `${candidato.mancha.ano}|${candidato.mancha.semana}|${candidato.mancha.dia}|${candidato.mancha.hora}|${candidato.familia}`;
  const imposto = blocosLayout.has(chave);
  if (!imposto) {
    const motivo = primeiraViolacao(restricoes, { estado: estadoRepetido, candidato, regras, ucPorId });
    if (motivo) {
      violacoes.push(
        `semana ${candidato.mancha.semana} ${candidato.mancha.dia} ${candidato.mancha.hora} familia ${candidato.familia}: ${motivo}`,
      );
    }
  }
  estadoRepetido.colocar(candidato);
  ctxRepetido.registar(candidato, ucPorId);
}
exigir(
  violacoes.length === 0,
  `zero violações no registo completo de restrições (${restricoes.length} restrições, ${sessoes.length} sessões)`,
);
for (const v of violacoes.slice(0, 20)) console.log(`         ${v}`);
if (violacoes.length > 20) console.log(`         ... e mais ${violacoes.length - 20}`);

// ---------------------------------------------------------------------------
// 5. ASSERÇÃO 2 — janela das aulas T
// ---------------------------------------------------------------------------

const janelaT = regras.janelasPorTipo.find((j) => j.tipo === "T");
const diasT = new Set((janelaT?.janelas ?? []).map((j) => j.dia));
const foraDaJanelaT = (s: SessaoHorario) => {
  if (s.tipoAula !== "T") return false;
  const doDia = janelaT?.janelas.find((j) => j.dia === s.diaSemana);
  if (!doDia) return true;
  if (doDia.periodos.length > 0 && !doDia.periodos.includes(ehTarde(s.horaInicio) ? "tarde" : "manha")) return true;
  return false;
};
const forasDaJanela = doMotor.filter(foraDaJanelaT);
console.log(`  (aulas T impostas por layouts fixos fora da janela: ${doLayout.filter(foraDaJanelaT).length})`);
exigir(
  forasDaJanela.length === 0,
  `nenhuma aula T fora da janela do anfiteatro (dias permitidos: ${[...diasT].join(", ")}; ` +
    `${ultimoDia} só de manhã)`,
);
for (const s of forasDaJanela.slice(0, 10)) {
  console.log(`         ${s.ucSigla} ${s.turma} semana ${s.semana} ${s.diaSemana} ${s.horaInicio}`);
}

// ---------------------------------------------------------------------------
// 6. ASSERÇÃO 3 — limite global de PL por mancha
// ---------------------------------------------------------------------------

const plPorMancha = new Map<string, number>();
for (const s of sessoes) {
  if (s.tipoAula !== "PL") continue;
  const k = `${s.semana}|${s.diaSemana}|${s.horaInicio}`;
  plPorMancha.set(k, (plPorMancha.get(k) ?? 0) + 1);
}
const excessosPL = [...plPorMancha.entries()].filter(([, n]) => n > regras.capacidade.maxPLporMancha);
const maxPLobservado = plPorMancha.size === 0 ? 0 : Math.max(...plPorMancha.values());
exigir(
  excessosPL.length === 0,
  `nenhuma mancha com mais de ${regras.capacidade.maxPLporMancha} PL em toda a escola (máximo observado: ${maxPLobservado})`,
);
for (const [k, n] of excessosPL.slice(0, 10)) console.log(`         ${k} -> ${n} PL`);

// ---------------------------------------------------------------------------
// 7. ASSERÇÃO 4 — todos os blocos fecham a 100% num padrão ativo
// ---------------------------------------------------------------------------

const folhasPorFamilia = regras.estruturaTurmas.tpPorTurmaTeorica * regras.estruturaTurmas.plPorTP;
const parciais: string[] = [];
const contagemFormas = new Map<FormaId | "(nenhuma)", number>();
for (const candidato of agruparEmCandidatos(sessoes, ucPorId, regras)) {
  const cobertura = coberturaFolhas(candidato.sessoes, regras.estruturaTurmas);
  const forma = formaDe(candidato.sessoes, ucPorId);
  contagemFormas.set(forma ?? "(nenhuma)", (contagemFormas.get(forma ?? "(nenhuma)") ?? 0) + 1);
  if (cobertura !== folhasPorFamilia || forma === null) {
    parciais.push(
      `semana ${candidato.mancha.semana} ${candidato.mancha.dia} ${candidato.mancha.hora} familia ${candidato.familia}: ` +
        `${cobertura}/${folhasPorFamilia} folhas, forma ${forma ?? "NENHUMA"} ` +
        `[${candidato.sessoes.map((s) => `${s.ucSigla}/${s.tipo}/${s.turma}`).join(" ")}]`,
    );
  }
}
exigir(
  parciais.length === 0,
  `todos os blocos cobrem ${folhasPorFamilia}/${folhasPorFamilia} folhas-aluno e desenham uma forma legítima (zero blocos parciais)`,
);
for (const p of parciais.slice(0, 15)) console.log(`         ${p}`);
if (parciais.length > 15) console.log(`         ... e mais ${parciais.length - 15}`);

console.log("\n  Blocos por FORMA (contados a partir das sessões produzidas):");
for (const [id, n] of [...contagemFormas].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(id).padEnd(24)} ${String(n).padStart(5)}`);
}

// ---------------------------------------------------------------------------
// 7b. ASSERÇÃO 4b — A REGRA GERAL: limites de TP e de PL da mesma UC
//
// É a asserção mais importante desta passagem. Conta-se o BLOCO INTEIRO — todas
// as famílias e todos os anos curriculares que partilham a mancha — e não a
// família do candidato: é esse o âmbito que a regra declara.
// ---------------------------------------------------------------------------

const limitesUniversais = limitesDaComposicao(regras);
const porManchaUCtipo = new Map<string, { n: number; sigla: string; tipo: string; turmas: string[] }>();
for (const s of sessoes) {
  if (s.tipoAula !== "TP" && s.tipoAula !== "PL") continue;
  const k = `${s.semana}|${s.diaSemana}|${s.horaInicio}|${s.ucSigla.trim().toUpperCase()}|${s.tipoAula}`;
  const atual = porManchaUCtipo.get(k) ?? { n: 0, sigla: s.ucSigla, tipo: s.tipoAula, turmas: [] };
  atual.n += 1;
  atual.turmas.push(s.turma);
  porManchaUCtipo.set(k, atual);
}
const excessosLimite: string[] = [];
let maxTPobservado = 0;
let maxPLporUCobservado = 0;
for (const [k, v] of porManchaUCtipo) {
  const limite = v.tipo === "TP" ? limitesUniversais.maxTPporUC : limitesUniversais.maxPLporUC;
  if (v.tipo === "TP") maxTPobservado = Math.max(maxTPobservado, v.n);
  else maxPLporUCobservado = Math.max(maxPLporUCobservado, v.n);
  if (v.n > limite) {
    const [semana, dia, hora] = k.split("|");
    excessosLimite.push(
      `semana ${semana} ${dia} ${hora}: ${v.n} ${v.tipo} de ${v.sigla} (${v.turmas.join(", ")}), acima de ${limite}`,
    );
  }
}
exigir(
  excessosLimite.length === 0,
  `ZERO blocos com mais de ${limitesUniversais.maxTPporUC} TP ou mais de ${limitesUniversais.maxPLporUC} PL da ` +
    `mesma UC, contando o bloco inteiro (máximos observados: TP=${maxTPobservado}, PL=${maxPLporUCobservado})`,
);
for (const e of excessosLimite.slice(0, 15)) console.log(`         ${e}`);
if (excessosLimite.length > 15) console.log(`         ... e mais ${excessosLimite.length - 15}`);

// ---------------------------------------------------------------------------
// 7c. ASSERÇÃO 4c — Sem maratonas: blocos seguidos da mesma UC no mesmo dia
// ---------------------------------------------------------------------------

const hierarquiaTeste = criarHierarquia(regras.estruturaTurmas);
const indiceHoraTeste = new Map(regras.grelha.horasInicio.map((h, i) => [h, i]));
const ocupacaoFolhaUC = new Map<string, Set<number>>();
for (const s of sessoes) {
  if (s.tipoAula === "S") continue;
  const i = indiceHoraTeste.get(s.horaInicio);
  if (i === undefined) continue;
  for (const folha of hierarquiaTeste.folhasDe(s.turma)) {
    const k = `${s.semana}|${s.diaSemana}|${folha}|${s.ucSigla.trim().toUpperCase()}`;
    const set = ocupacaoFolhaUC.get(k) ?? new Set<number>();
    set.add(i);
    ocupacaoFolhaUC.set(k, set);
  }
}
const maratonas: string[] = [];
let maiorCorrida = 0;
let maiorNoDia = 0;
for (const [k, set] of ocupacaoFolhaUC) {
  const indices = [...set].sort((a, b) => a - b);
  const [semana, dia, folha, sigla] = k.split("|");
  let corrida = 0;
  let anterior = Number.NEGATIVE_INFINITY;
  let excedeu = false;
  for (const i of indices) {
    corrida = i === anterior + 1 ? corrida + 1 : 1;
    anterior = i;
    maiorCorrida = Math.max(maiorCorrida, corrida);
    if (corrida > regras.maratonaUC.maxBlocosSeguidosMesmaUC && !excedeu) {
      maratonas.push(`semana ${semana} ${dia}: ${folha} com ${corrida} blocos seguidos de ${sigla}`);
      excedeu = true;
    }
  }
  maiorNoDia = Math.max(maiorNoDia, indices.length);
  if (!excedeu && indices.length > regras.maratonaUC.maxBlocosMesmaUCporDia) {
    maratonas.push(`semana ${semana} ${dia}: ${folha} com ${indices.length} blocos de ${sigla} no mesmo dia`);
  }
}
exigir(
  maratonas.length === 0,
  `nenhum grupo com mais de ${regras.maratonaUC.maxBlocosSeguidosMesmaUC} blocos seguidos nem mais de ` +
    `${regras.maratonaUC.maxBlocosMesmaUCporDia} blocos por dia da mesma UC (maior corrida observada: ` +
    `${maiorCorrida}, maior total num dia: ${maiorNoDia})`,
);
for (const m of maratonas.slice(0, 10)) console.log(`         ${m}`);

// ---------------------------------------------------------------------------
// 7d. ASSERÇÃO 4d — Ritmo: as turmas TP da mesma UC nunca divergem mais de N
//
// A unidade do desvio é a que a configuração declarar: `semanas` compara aulas
// homólogas (a n-ésima de cada turma) em semanas de atraso; `blocos` compara
// contagens em cada instante. A asserção segue a regra, não uma delas em
// particular — se a regra mudar de unidade, é aqui que se lê.
// ---------------------------------------------------------------------------

const prefixoTP = regras.estruturaTurmas.prefixos.tp;
const tpsPorFamilia = regras.estruturaTurmas.tpPorTurmaTeorica;
const momentoDe = (s: SessaoHorario) => {
  const d = regras.grelha.dias.indexOf(s.diaSemana);
  return (s.semana ?? 0) * 100000 + (d < 0 ? 99 : d) * 1440 + minutos(s.horaInicio);
};
const tpOrdenadas = sessoes
  .filter((s) => s.tipoAula === "TP")
  .sort((a, b) => momentoDe(a) - momentoDe(b));
const porSemanas = regras.ritmoTP.unidade === "semanas";
const limiteRitmo = porSemanas ? regras.ritmoTP.maxDesvioSemanas : regras.ritmoTP.maxDesvioBlocos;
const desviosRitmo: string[] = [];
let maiorDesvio = 0;
const ucsComTP = [...new Set(tpOrdenadas.map((s) => s.ucSigla))];
for (const sigla of ucsComTP) {
  const daUC = tpOrdenadas.filter((s) => s.ucSigla === sigla);
  const turmasDaUC = [...new Set(daUC.map((s) => s.turma))];
  const familias = regras.ritmoTP.ambito === "uc" ? ["*"] : ["A", "B"];
  for (const familia of familias) {
    const turmas = turmasDaUC.filter((t) => {
      if (familia === "*") return true;
      const n = Number(t.slice(prefixoTP.length));
      return Number.isFinite(n) && (Math.floor((n - 1) / tpsPorFamilia) === 0 ? "A" : "B") === familia;
    });
    if (turmas.length <= 1) continue;

    if (porSemanas) {
      // Aulas homólogas: a n-ésima de cada turma, comparada em semanas.
      const aulasDe = new Map<string, SessaoHorario[]>(
        turmas.map((t) => [t, daUC.filter((s) => s.turma === t)]),
      );
      let registado = false;
      for (const adiantada of turmas) {
        for (const atrasada of turmas) {
          if (adiantada === atrasada || registado) continue;
          const a = aulasDe.get(adiantada)!;
          const b = aulasDe.get(atrasada)!;
          for (let n = 0; n < Math.min(a.length, b.length); n++) {
            const atraso = (b[n].semana ?? 0) - (a[n].semana ?? 0);
            maiorDesvio = Math.max(maiorDesvio, atraso);
            if (atraso <= limiteRitmo) continue;
            desviosRitmo.push(
              `${sigla} (${familia === "*" ? "UC" : `família ${familia}`}): a ${n + 1}.ª TP de ${adiantada} na ` +
                `semana ${a[n].semana} e a de ${atrasada} só na semana ${b[n].semana} — ${atraso} semanas de atraso`,
            );
            registado = true;
            break;
          }
        }
      }
      continue;
    }

    const contador = new Map<string, number>(turmas.map((t) => [t, 0]));
    for (const s of daUC) {
      if (!contador.has(s.turma)) continue;
      contador.set(s.turma, contador.get(s.turma)! + 1);
      const valores = [...contador.values()];
      const desvio = Math.max(...valores) - Math.min(...valores);
      maiorDesvio = Math.max(maiorDesvio, desvio);
      if (desvio > limiteRitmo) {
        desviosRitmo.push(
          `${sigla} (${familia === "*" ? "UC" : `família ${familia}`}) na semana ${s.semana}: desvio de ${desvio} ` +
            `blocos entre turmas TP [${[...contador].map(([t, n]) => `${t}=${n}`).join(" ")}]`,
        );
        break;
      }
    }
  }
}
exigir(
  desviosRitmo.length === 0,
  `as turmas TP da mesma UC nunca divergem mais de ${limiteRitmo} ${porSemanas ? "semana(s)" : "bloco(s)"} ` +
    `(desvio máximo observado: ${maiorDesvio}, âmbito "${regras.ritmoTP.ambito}")`,
);
for (const d of desviosRitmo.slice(0, 10)) console.log(`         ${d}`);

// ---------------------------------------------------------------------------
// 8. ASSERÇÃO 5 — os dois semestres têm sessões
// ---------------------------------------------------------------------------

exigir(s1.length > 0, `o 1.º semestre tem sessões (${s1.length})`);
exigir(s2.length > 0, `o 2.º semestre tem sessões (${s2.length})`);

// ---------------------------------------------------------------------------
// 9. ASSERÇÃO 6 — o défice tem sempre motivos
// ---------------------------------------------------------------------------

const semMotivo = relatorio.deficit.filter((d) => d.motivosMaisFrequentes.length === 0);
exigir(
  semMotivo.length === 0,
  `todos os ${relatorio.deficit.length} itens de défice trazem motivos vindos das restrições`,
);
for (const d of semMotivo.slice(0, 10)) console.log(`         ${d.ucSigla} ${d.turma} ${d.tipo}`);

// ---------------------------------------------------------------------------
// 10. Sanidade adicional
// ---------------------------------------------------------------------------

const semanasForaDoCalendario = sessoes.filter(
  (s) => (s.semana ?? 0) < 1 || (regras.calendario.semanaMaximaGlobal !== null && (s.semana ?? 0) > regras.calendario.semanaMaximaGlobal),
);
exigir(semanasForaDoCalendario.length === 0, "nenhuma sessão fora do intervalo de semanas do calendário");

const duplicados = new Map<string, number>();
for (const s of sessoes) {
  const k = `${s.semana}|${s.diaSemana}|${s.horaInicio}|${s.turma}`;
  duplicados.set(k, (duplicados.get(k) ?? 0) + 1);
}
const sobrepostas = [...duplicados.entries()].filter(([, n]) => n > 1);
exigir(sobrepostas.length === 0, "nenhuma turma com duas aulas na mesma mancha");
for (const [k, n] of sobrepostas.slice(0, 10)) console.log(`         ${k} -> ${n}`);

// ---------------------------------------------------------------------------
// 11. Veredicto
// ---------------------------------------------------------------------------

console.log("");
if (falhas.length > 0) {
  console.error(`FALHA: ${falhas.length} asserção(ões) do alocador não passaram.`);
  for (const f of falhas) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  `Alocador: ${sessoes.length} sessões, completude ${relatorio.completude.toFixed(1)}%, ` +
    `zero violações, zero blocos parciais, os dois semestres produzidos.`,
);
