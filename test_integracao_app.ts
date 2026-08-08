/**
 * TESTE DE INTEGRAÇÃO DO CAMINHO NOVO DA APLICAÇÃO (Fase 5A).
 *
 * `handleTriggerSolver` (em `src/App.tsx`) deixou de chamar o motor antigo e passou a
 * correr, por omissão, esta cadeia:
 *
 *     linhas do Supabase -> rowToRegra -> carregarRegras -> alocar -> validar
 *
 * Este ficheiro reproduz essa cadeia FORA do React, com os dados REAIS do snapshot do
 * Supabase, porque é a única forma de a provar sem clicar no botão. Prova três coisas:
 *
 *   1. As regras reais atravessam o mapeador da aplicação e o contrato de regras sem
 *      nenhuma regra malformada, e as duas regras físicas obrigatórias existem na base de
 *      dados (a aplicação não precisa de inventar nenhuma).
 *   2. ÂMBITO COMPLETO — uma execução sobre o ano letivo inteiro dá completude ≥ 98%,
 *      zero violações de gravidade "erro" segundo o validador independente, e produz
 *      sessões nos DOIS semestres.
 *   3. COMO O BOTÃO GERA — a aplicação regenera um semestre de cada vez e preserva o
 *      oposto. Reproduz-se exatamente o que o ecrã faz: zerar a carga das UCs fora do
 *      âmbito (a procura fica limitada ao semestre alvo, mas as UCs continuam visíveis
 *      para o motor reconhecer as sessões já existentes), semear as sessões preservadas
 *      em `sessoesFixas`, filtrar os layouts fixos do semestre e juntar o resultado. Para
 *      cada semestre exige-se: completude do âmbito ≥ 98%, zero violações de erro na
 *      proposta final e o semestre oposto intacto, aula por aula.
 *
 * Nenhuma sigla de unidade curricular aparece escrita aqui: as UCs são identificadas
 * pelas suas propriedades (ano, semestre, carga), como dados.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { rowToAnoSem, rowToFeriado, rowToRegra, rowToUc } from "./src/data/mappers";
import { carregarRegras } from "./src/regras/carregar";
import type { LinhaRegra } from "./src/regras/carregar";
import type { ConfiguracaoMotor } from "./src/regras/esquema";
import { alocar } from "./src/motor/alocador";
import type { RelatorioAlocacao } from "./src/motor/relatorio";
import { validar } from "./src/validacao/validador";
import type { Violacao } from "./src/validacao/validador";
import type { AnoLetivoSemestre, FeriadoInterrupcao, SessaoHorario, UC } from "./src/types";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let falhas = 0;
const falhar = (m: string) => { falhas++; console.log(`  FALHA  ${m}`); };
const ok = (m: string) => console.log(`  ok     ${m}`);
const seccao = (t: string) => { console.log(`\n${t}`); console.log("-".repeat(t.length)); };

const COMPLETUDE_MINIMA = 98;

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

// ---------------------------------------------------------------------------
// 1. Regras: o mesmo percurso que a aplicação faz ao arrancar
// ---------------------------------------------------------------------------

seccao("1. Regras do Supabase -> mapeador da app -> contrato de regras");

const linhasRegras = lerJson("regras.json");
const linhasUcs = lerJson("ucs.json");
const linhasAnos = lerJson("anos_semestres.json");
const linhasFeriados = lerJson("feriados.json");

// `rowToRegra` é o mapeador que a app usa em `repo.carregarTudo()`: as regras que chegam
// ao estado `regras` já passaram por ele, e é esse objeto que alimenta `carregarRegras`.
const regrasDaApp = linhasRegras.map(rowToRegra);
const ucs: UC[] = linhasUcs.map(rowToUc);
const anosSemestres: AnoLetivoSemestre[] = linhasAnos.map(rowToAnoSem);
const feriados: FeriadoInterrupcao[] = linhasFeriados.map(rowToFeriado);
const anoLetivo = anosSemestres[0]?.anoLetivo ?? "";

const { config: regrasMotor, relatorio: relRegras } = carregarRegras({
  regras: regrasDaApp as unknown as LinhaRegra[],
  ucs: linhasUcs,
  anosSemestres: linhasAnos,
});

console.log(`Snapshot: ${PASTA_SNAPSHOT}`);
console.log(`Regras: ${relRegras.regrasLidas} lidas, ${relRegras.regrasAplicadas.length} aplicadas, `
  + `${relRegras.regrasInativas.length} inativas, ${relRegras.regrasDescritivas.length} descritivas.`);
console.log(`Em falta: ${relRegras.emFalta.length} (críticas: ${relRegras.emFalta.filter(f => f.critica).length}) `
  + `| conflitos: ${relRegras.conflitos.length} | chaves desconhecidas: ${relRegras.desconhecidas.length}`);
console.log(`UCs: ${ucs.length} | Ano letivo: ${anoLetivo}`);

if (relRegras.malformadas.length === 0) {
  ok("nenhuma regra malformada: a app não teria de recusar a geração.");
} else {
  falhar(`${relRegras.malformadas.length} regra(s) malformada(s); a primeira: `
    + `${relRegras.malformadas[0].caminho} — ${relRegras.malformadas[0].mensagem}`);
}

// As duas regras FÍSICAS obrigatórias que `garantirRegrasObrigatorias` acrescentaria se não
// existissem. Com os dados reais têm de existir na base de dados — se existirem, a
// aplicação nunca inventa nada.
for (const id of ["h_limite_global_6_pl", "h_2ano_semana_1_sem_pl"]) {
  if (regrasDaApp.some(r => r.id === id)) ok(`a regra obrigatória "${id}" existe no Supabase.`);
  else falhar(`a regra obrigatória "${id}" não existe no Supabase: a app teria de avisar e usar uma versão supletiva.`);
}

// Prova que o Supabase manda: a carga diária do 2.º ano vem da regra do ano (e não do
// valor que estava escrito no código da interface, que era 5).
const anosComUC = [...new Set(ucs.map(u => Number(u.anoCurricular)))].sort();
for (const ano of anosComUC) {
  const doAno = regrasMotor.cargaDiaria.porAno[ano];
  console.log(`Carga diária do ${ano}.º ano: `
    + (doAno
      ? `alvo ${doAno.alvoHoras}h, teto ${doAno.maxHoras}h, ${doAno.maxDiasNoMaximoPorSemana} dia(s) no teto (regra do ano).`
      : `alvo ${regrasMotor.cargaDiaria.transversal.alvoHoras}h, teto ${regrasMotor.cargaDiaria.transversal.maxHoras}h, `
        + `${regrasMotor.cargaDiaria.transversal.maxDiasNoMaximoPorSemana} dia(s) no teto (transversal).`));
}
const turnos = regrasMotor.turnos.familiaDeManhaPorSemestre;
if (Object.keys(turnos).length > 0) {
  ok(`turnos vindos do Supabase: ${Object.entries(turnos).map(([s, f]) => `S${s}=${f}`).join(", ")} `
    + `(+${regrasMotor.turnos.excecoes.length} exceção(ões)) — é daqui que a app tira a preferência manhã/tarde.`);
} else {
  falhar("a regra `turnos` não define nenhuma família de manhã: a app cairia na preferência local do browser.");
}

// ---------------------------------------------------------------------------
// 2. Calendário efetivo — a tradução que a aplicação faz antes de chamar o motor
// ---------------------------------------------------------------------------

/**
 * `construirCalendario` só desconta o que vier em `feriados`; os bloqueios declarados nas
 * regras e o limite `dataFim` são traduzidos pelo chamador. `handleTriggerSolver` faz
 * exatamente isto, e o teste faz o mesmo para correr o mesmo calendário.
 */
function calendarioEfetivo(config: ConfiguracaoMotor, base: FeriadoInterrupcao[]): FeriadoInterrupcao[] {
  const saida: FeriadoInterrupcao[] = [
    ...base,
    ...config.calendario.bloqueios.map((b, i) => ({
      id: `regra_cal_${i}_${b.dataInicio}`,
      nome: b.nome,
      tipo: (b.tipo || "Interrupção Letiva") as FeriadoInterrupcao["tipo"],
      dataInicio: b.dataInicio,
      dataFim: b.dataFim,
    })),
  ];
  if (config.calendario.dataFim) {
    const depois = new Date(`${config.calendario.dataFim}T12:00:00`);
    depois.setDate(depois.getDate() + 1);
    saida.push({
      id: "regra_limite_data_fim",
      nome: "Fim do período letivo",
      tipo: "Interrupção Letiva",
      dataInicio: depois.toISOString().slice(0, 10),
      dataFim: `${String(config.calendario.dataFim).slice(0, 4)}-12-31`,
    });
  }
  return saida;
}

const feriadosMotor = calendarioEfetivo(regrasMotor, feriados);
console.log(`\nCalendário efetivo: ${feriados.length} interrupções da tabela + `
  + `${feriadosMotor.length - feriados.length} vindas das regras = ${feriadosMotor.length}.`);

// ---------------------------------------------------------------------------
// Utilitários partilhados pelos dois cenários
// ---------------------------------------------------------------------------

const fronteira = regrasMotor.calendario.fronteiraSemestre;
const semestreDaSessao = (s: SessaoHorario): number => ((s.semana ?? 0) <= fronteira ? 1 : 2);
const chaveSessao = (s: SessaoHorario) =>
  `${s.ucSigla}|${s.tipoAula}|${s.turma}|${s.semana}|${s.diaSemana}|${s.horaInicio}`;

const errosDe = (violacoes: Violacao[]) => violacoes.filter(v => v.gravidade === "erro");

/**
 * Completude DO ÂMBITO de uma execução, como `handleTriggerSolver` a calcula.
 *
 * `relatorio.completude` não serve quando se dá ao motor sessões já feitas (o semestre
 * oposto, os outros anos): os blocos colocados incluem-nas e o rácio dava sempre 100%.
 * O que mede o âmbito é `blocosAlvo` — que só conta a procura desta execução — menos o
 * défice, contado turma a turma pelo próprio motor.
 */
function completudeDoAmbito(rel: RelatorioAlocacao): { alvo: number; colocados: number; emFalta: number; pct: number } {
  const emFalta = rel.deficit.reduce((t, d) => t + d.blocosEmFalta, 0);
  const colocados = Math.max(0, rel.blocosAlvo - emFalta);
  return { alvo: rel.blocosAlvo, colocados, emFalta, pct: rel.blocosAlvo > 0 ? (colocados / rel.blocosAlvo) * 100 : 100 };
}

function motivoDominante(rel: RelatorioAlocacao): string | null {
  const contagem = new Map<string, number>();
  for (const d of rel.deficit) {
    for (const m of d.motivosMaisFrequentes) contagem.set(m.motivo, (contagem.get(m.motivo) ?? 0) + m.ocorrencias);
  }
  return [...contagem.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function descreverAlocacao(etiqueta: string, rel: RelatorioAlocacao): void {
  const c = completudeDoAmbito(rel);
  console.log(`${etiqueta}: ${c.colocados}/${c.alvo} blocos do âmbito, completude ${c.pct.toFixed(1)}%`
    + `, ${c.emFalta} bloco(s) em falta em ${rel.deficit.length} turma(s)/tipo.`);
  const motivo = motivoDominante(rel);
  if (motivo) console.log(`  motivo mais frequente do défice: ${motivo}`);
}

// ---------------------------------------------------------------------------
// 3. Cenário A — âmbito completo (ano letivo inteiro, os dois semestres)
// ---------------------------------------------------------------------------

seccao("2. Âmbito completo: carregar regras -> alocar -> validar");

const completo = alocar({ ucs, regras: regrasMotor, feriados: feriadosMotor, anosSemestres, anoLetivo });
descreverAlocacao("Alocador", completo.relatorio);

const completudeCompleta = completudeDoAmbito(completo.relatorio);
if (completudeCompleta.pct >= COMPLETUDE_MINIMA) {
  ok(`completude ${completudeCompleta.pct.toFixed(1)}% (mínimo exigido ${COMPLETUDE_MINIMA}%).`);
} else {
  falhar(`completude ${completudeCompleta.pct.toFixed(1)}% abaixo do mínimo de ${COMPLETUDE_MINIMA}%.`);
}
// O relatório do alocador e este cálculo têm de coincidir quando não há sessões fixas.
if (Math.abs(completudeCompleta.pct - completo.relatorio.completude) < 0.05) {
  ok(`sem sessões fixas, a completude do âmbito coincide com a do relatório do alocador (${completo.relatorio.completude.toFixed(1)}%).`);
} else {
  falhar(`a completude do âmbito (${completudeCompleta.pct.toFixed(1)}%) não coincide com a do relatório `
    + `(${completo.relatorio.completude.toFixed(1)}%) numa execução sem sessões fixas.`);
}

const porSemestre = new Map<number, number>();
for (const s of completo.sessoes) porSemestre.set(semestreDaSessao(s), (porSemestre.get(semestreDaSessao(s)) ?? 0) + 1);
console.log(`Sessões por semestre: ${[...porSemestre.entries()].sort().map(([k, n]) => `S${k}=${n}`).join(", ")}`);
for (const semestre of [1, 2]) {
  const n = porSemestre.get(semestre) ?? 0;
  if (n > 0) ok(`o ${semestre}.º semestre recebeu ${n} sessões.`);
  else falhar(`o ${semestre}.º semestre ficou sem nenhuma sessão.`);
}

const validacaoCompleta = validar(completo.sessoes, ucs, regrasMotor);
const errosCompleto = errosDe(validacaoCompleta.violacoes);
console.log(`Validador independente: ${errosCompleto.length} erro(s), `
  + `${validacaoCompleta.violacoes.length - errosCompleto.length} aviso(s). `
  + `Completude segundo o validador: ${validacaoCompleta.completude.colocado}/${validacaoCompleta.completude.alvo} `
  + `(${validacaoCompleta.completude.pct.toFixed(1)}%).`);
for (const [regra, n] of Object.entries(validacaoCompleta.porRegra).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${regra.padEnd(28)} ${n}`);
}
if (errosCompleto.length === 0) {
  ok(`zero violações de gravidade "erro" em ${completo.sessoes.length} sessões.`);
} else {
  for (const v of errosCompleto.slice(0, 10)) {
    console.log(`  ERRO [${v.regra}] semana ${v.semana} ${v.dia} ${v.hora} ${v.ucSigla}/${v.turma}: ${v.mensagem}`);
  }
  falhar(`${errosCompleto.length} violação(ões) de gravidade "erro" no âmbito completo.`);
}

// ---------------------------------------------------------------------------
// 4. Cenário B — como o botão gera: um semestre de cada vez, preservando o oposto
// ---------------------------------------------------------------------------

seccao("3. Como o botão gera: um semestre de cada vez, preservando o oposto");

/** Espelha `noAmbitoDaGeracao` de `handleTriggerSolver`. */
const noAmbito = (uc: UC, semestreAlvo: number, anoFiltro: number | "todos") =>
  Number(uc.semestre) === semestreAlvo
  && Number(uc.anoCurricular) !== 3
  && (anoFiltro === "todos" || Number(uc.anoCurricular) === Number(anoFiltro))
  && (uc.turmasConfig?.length ?? 0) > 0;

for (const semestreAlvo of [1, 2] as const) {
  console.log(`\n>> ${semestreAlvo}.º semestre (o outro fica preservado)`);

  // Horário "que já estava lá": o do semestre oposto, produzido no cenário A. É o papel
  // das sessões dos outros anos/semestre na aplicação — ocupam salas e não são tocadas.
  const preservadas = completo.sessoes
    .filter(s => semestreDaSessao(s) !== semestreAlvo)
    .map(s => ({ ...s, bloqueado: true }));

  // Zerar a carga fora do âmbito: a procura fica no semestre alvo, sem esconder as UCs.
  const ucsParaMotor: UC[] = ucs.map(uc => noAmbito(uc, semestreAlvo, "todos") ? uc : ({
    ...uc,
    cargaHorariaTeorica: 0,
    cargaHorariaTP: 0,
    cargaHorariaPratica: 0,
    cargaHorariaS: 0,
  }));

  const jaContabilizadas = new Set(preservadas.map(chaveSessao));
  const resultado = alocar({
    ucs: ucsParaMotor,
    regras: {
      ...regrasMotor,
      layoutsFixos: regrasMotor.layoutsFixos.filter(l => (l.semestre ?? 1) === semestreAlvo),
    },
    feriados: feriadosMotor,
    anosSemestres,
    anoLetivo,
    sessoesFixas: preservadas,
  });
  descreverAlocacao(`Alocador (S${semestreAlvo})`, resultado.relatorio);

  // O `bloqueado` que vem do motor não se toca: `false` nas aulas novas, `true` nas
  // impostas por layout fixo — é esse `true` que impede o validador de as acusar com a
  // regra que elas próprias impõem à semana.
  const novas = resultado.sessoes
    .filter(s => semestreDaSessao(s) === semestreAlvo && !jaContabilizadas.has(chaveSessao(s)));
  const merged = [...preservadas, ...novas];
  console.log(`  ${novas.length} sessões novas no S${semestreAlvo}; proposta final com ${merged.length} sessões.`);

  const completudeAmbito = completudeDoAmbito(resultado.relatorio);
  if (completudeAmbito.pct >= COMPLETUDE_MINIMA) {
    ok(`S${semestreAlvo}: completude do âmbito ${completudeAmbito.pct.toFixed(1)}% (mínimo ${COMPLETUDE_MINIMA}%).`);
  } else {
    const motivo = motivoDominante(resultado.relatorio);
    falhar(`S${semestreAlvo}: completude ${completudeAmbito.pct.toFixed(1)}% abaixo de ${COMPLETUDE_MINIMA}%`
      + (motivo ? ` — motivo mais frequente: ${motivo}` : "") + ".");
  }

  if (novas.length === 0) falhar(`S${semestreAlvo}: o motor não produziu nenhuma sessão nova.`);
  else ok(`S${semestreAlvo}: ${novas.length} sessões novas produzidas.`);

  // O semestre oposto tem de sair da geração exatamente como entrou.
  const opostoAntes = completo.sessoes.filter(s => semestreDaSessao(s) !== semestreAlvo).map(chaveSessao).sort();
  const opostoDepois = merged.filter(s => semestreDaSessao(s) !== semestreAlvo).map(chaveSessao).sort();
  if (opostoAntes.length === opostoDepois.length && opostoAntes.every((k, i) => k === opostoDepois[i])) {
    ok(`S${semestreAlvo}: o semestre oposto ficou intacto (${opostoDepois.length} sessões, aula por aula).`);
  } else {
    falhar(`S${semestreAlvo}: o semestre oposto mudou (${opostoAntes.length} -> ${opostoDepois.length} sessões).`);
  }

  const validacao = validar(merged, ucs, regrasMotor);
  const erros = errosDe(validacao.violacoes);
  console.log(`  Validador: ${erros.length} erro(s), ${validacao.violacoes.length - erros.length} aviso(s); `
    + `completude ${validacao.completude.colocado}/${validacao.completude.alvo} (${validacao.completude.pct.toFixed(1)}%).`);
  if (erros.length === 0) {
    ok(`S${semestreAlvo}: proposta final sem violações de gravidade "erro".`);
  } else {
    for (const v of erros.slice(0, 10)) {
      console.log(`  ERRO [${v.regra}] semana ${v.semana} ${v.dia} ${v.hora} ${v.ucSigla}/${v.turma}: ${v.mensagem}`);
    }
    falhar(`S${semestreAlvo}: ${erros.length} violação(ões) de gravidade "erro" na proposta final.`);
  }

  // A proposta final não pode ter duas aulas na mesma mancha para a mesma turma por
  // duplicação do que já existia (é o risco de juntar o que o motor devolve com o que se
  // lhe deu como fixo).
  const contagem = new Map<string, number>();
  for (const s of merged) contagem.set(chaveSessao(s), (contagem.get(chaveSessao(s)) ?? 0) + 1);
  const duplicadas = [...contagem.entries()].filter(([, n]) => n > 1);
  if (duplicadas.length === 0) ok(`S${semestreAlvo}: nenhuma sessão duplicada na junção.`);
  else falhar(`S${semestreAlvo}: ${duplicadas.length} sessão(ões) duplicada(s) na junção; a primeira: ${duplicadas[0][0]}.`);
}

// ---------------------------------------------------------------------------
// Veredicto
// ---------------------------------------------------------------------------

console.log("");
if (falhas > 0) {
  console.error(`FALHA: ${falhas} problema(s) no caminho de integração da aplicação.`);
  process.exit(1);
}
console.log("Integração da app (carregar regras -> alocar -> validar) verificada com os dados reais do Supabase.");
