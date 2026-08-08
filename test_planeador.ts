/**
 * Teste do PLANEADOR SEMANAL (Fase 6A) com os dados REAIS do snapshot do Supabase.
 *
 * Corre `planear(...)` sobre as regras, as UCs e o calendário reais, imprime o
 * menu semana a semana e FALHA (exit 1) se alguma das garantias do plano for
 * quebrada:
 *
 *  1. O orçamento COBRE 100% da carga: nenhum bloco desaparece entre a procura
 *     e o plano. Tudo o que não vira mancha planeada tem de aparecer nas sobras,
 *     com motivo.
 *  2. A distribuição por semana é PROPORCIONAL AOS DIAS ÚTEIS: as semanas com
 *     feriados recebem menos. Verifica-se de duas formas — reproduzindo a
 *     repartição por maiores restos fora do planeador, e exigindo que uma semana
 *     com menos dias nunca receba mais manchas do que uma com mais dias, dentro
 *     do mesmo conjunto (janela letiva x padrão).
 *  3. A quota do padrão de último recurso (o que fecha um grupo isolado de
 *     práticas) SAI DOS DADOS — `total - 2 x min(total/2, total - max)` — e fica
 *     DISTRIBUÍDA pelas semanas, não amontoada no fim do bloco.
 *  4. Nenhuma mancha planeada junta dois grupos de práticas da MESMA unidade
 *     curricular, nem excede o limite de práticas simultâneas. A pergunta é
 *     feita ao REGISTO de restrições (`primeiraViolacao`), não a um `if` local:
 *     cada mancha tem de ser legal em pelo menos um dia/hora da sua janela.
 *  5. A reversibilidade funciona: `replanear` devolve a mancha ao orçamento e
 *     dá-lhe outra semana da sua janela, até não haver mais nenhuma.
 *
 * Localização do snapshot: `SB_SNAPSHOT_DIR`, ou o primeiro argumento.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { carregarRegras } from "./src/regras/carregar";
import { comMigracaoRegraGeral } from "./test_migracao_regra_geral";
import type { LinhaRegra } from "./src/regras/carregar";
import { rowToAnoSem, rowToFeriado, rowToUc } from "./src/data/mappers";
import { construirRegistoCompleto, criarContextoAlocador } from "./src/motor/alocador";
import {
  construirCalendario,
  construirProcura,
  criarMapaTurmas,
  descontarJaColocado,
  formatarPlano,
  limitesDaSemana,
  planear,
} from "./src/motor/planeador";
import type { ManchaPlaneada, SemanaAlocacao } from "./src/motor/planeador";
import { inventariar } from "./src/motor/inventario";
import { criarEstado, criarHierarquia } from "./src/motor/estado";
import type { Candidato, Mancha } from "./src/motor/estado";
import { primeiraViolacao } from "./src/motor/restricoes";
import { distribuirBlocos } from "./src/utils/distribuicao";
import type { SemanaInfo } from "./src/utils/distribuicao";
import type { FormaId } from "./src/motor/padroes";
import { coberturaFolhas, limitesDaComposicao } from "./src/motor/padroes";
import type { AnoLetivoSemestre, FeriadoInterrupcao, UC } from "./src/types";

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

const { config: regras, relatorio: relRegras } = carregarRegras({
  regras: comMigracaoRegraGeral(linhasRegras),
  ucs: linhasUcs,
  anosSemestres: linhasAnos,
});

console.log(`Snapshot: ${PASTA_SNAPSHOT}`);
console.log(
  `Regras: ${linhasRegras.length} (aplicadas ${relRegras.regrasAplicadas.length}) | UCs: ${ucs.length} | ` +
    `Feriados: ${feriados.length} | Ano letivo: ${anoLetivo}`,
);
if (relRegras.malformadas.length > 0) {
  console.error("FALHA: o snapshot tem regras malformadas; corrija-as antes de correr o planeador.");
  for (const m of relRegras.malformadas) console.error(`  ${m.caminho}: ${m.mensagem}`);
  process.exit(1);
}

const entrada = { ucs, regras, feriados, anosSemestres, anoLetivo };
const mapa = criarMapaTurmas(regras.estruturaTurmas);
const anos = [...new Set(ucs.map((u) => u.anoCurricular))].sort((a, b) => a - b);
const calendario = construirCalendario(entrada, anos);
const ucPorId = new Map<string, UC>(ucs.map((u) => [u.id, u]));
const registo = construirRegistoCompleto(regras, criarContextoAlocador(regras, calendario));

// ---------------------------------------------------------------------------
// 2. Correr o planeador
// ---------------------------------------------------------------------------

const inicio = Date.now();
const inventario = inventariar(entrada, regras, undefined, registo);
const plano = planear(entrada, regras, inventario);
const duracao = Date.now() - inicio;

console.log(`\nPlaneador: ${plano.manchas.length} manchas em ${(duracao / 1000).toFixed(2)}s\n`);
console.log(formatarPlano(plano));

// ---------------------------------------------------------------------------
// 3. ASSERÇÃO 1 — o orçamento cobre 100% da carga
// ---------------------------------------------------------------------------

console.log("\n\nASSERCOES");
console.log("=========");

// A procura é recalculada aqui, com as mesmas peças públicas que o planeador
// usa, para que a contagem seja INDEPENDENTE do que o plano diz de si próprio.
const { itens: procura } = construirProcura(entrada, mapa);
descontarJaColocado(entrada, regras, mapa, procura, ucPorId);

const porColocar = new Map<string, number>();
let blocosPorColocar = 0;
for (const p of procura.values()) {
  const falta = p.alvo - p.colocados;
  if (falta <= 0) continue;
  porColocar.set(`${p.ucSigla}|${p.tipo}|${p.turma}`, falta);
  blocosPorColocar += falta;
}

const blocosPlaneados = plano.manchas.reduce((s, m) => s + m.sessoes.length, 0);
const blocosSobra = plano.sobras.reduce((s, x) => s + x.blocos, 0);

console.log(`  (procura por colocar: ${blocosPorColocar} blocos)`);
console.log(`  (planeados: ${blocosPlaneados} | sobras: ${blocosSobra})`);
exigir(
  blocosPlaneados + blocosSobra === blocosPorColocar,
  `o orçamento cobre 100% da carga: ${blocosPlaneados} planeados + ${blocosSobra} de sobra = ${blocosPorColocar} por colocar`,
);

// A cobertura tem de ser exata TURMA A TURMA, não só no total.
const planeadoPorTurma = new Map<string, number>();
for (const m of plano.manchas) {
  for (const s of m.sessoes) {
    const k = `${s.ucSigla}|${s.tipo}|${s.turma}`;
    planeadoPorTurma.set(k, (planeadoPorTurma.get(k) ?? 0) + 1);
  }
}
const excessos: string[] = [];
for (const [k, n] of planeadoPorTurma) {
  const alvo = porColocar.get(k) ?? 0;
  if (n > alvo) excessos.push(`${k}: planeados ${n}, mas só faltavam ${alvo}`);
}
exigir(excessos.length === 0, "nenhuma turma recebe no plano mais blocos do que os que lhe faltam");
for (const e of excessos.slice(0, 10)) console.log(`         ${e}`);

// Todas as sobras trazem motivo.
exigir(
  plano.sobras.every((s) => s.motivo.trim().length > 0),
  `todas as ${plano.sobras.length} sobra(s) do plano trazem motivo`,
);

// ---------------------------------------------------------------------------
// 4. ASSERÇÃO 2 — distribuição proporcional aos dias úteis, ENTRE AS SEMANAS
//    QUE AINDA TÊM CAPACIDADE
//
// A regra não é "proporcional aos dias úteis e ponto final": é proporcional
// entre as semanas que ainda cabem. Uma semana que já chegou à carga-ALVO do
// estudante (ex.: 6h/dia) deixa de receber, e o que lhe tocaria vai para as
// outras — porque insistir nela seria planear para o lixo: a restrição de carga
// diária vetaria a mancha na colocação. Os conjuntos mais apertados (as manchas
// que só cabem em 2 ou 3 semanas) são servidos primeiro, e por isso quando os
// conjuntos livres chegam há semanas que já estão cheias.
//
// As duas asserções abaixo exprimem exatamente isso, sem enfraquecer nada:
//
//  (a) A soma bate certo — nenhuma mancha se perde na repartição.
//  (b) Uma semana só recebe MENOS do que a sua quota proporcional se tiver
//      chegado à carga-alvo. Qualquer outro desvio é um erro.
//  (c) Uma semana com menos dias úteis só recebe mais manchas do que uma semana
//      mais completa se ESSA tiver chegado à carga-alvo. Sem esse motivo, a
//      inversão é um erro.
// ---------------------------------------------------------------------------

/** Os conjuntos que o planeador distribui: (ano, família, semanas viáveis, padrão). */
const conjuntos = new Map<string, ManchaPlaneada[]>();
for (const m of plano.manchas) {
  const k = `${m.ano}|${m.familia}|${m.semanas.join(".")}|${m.forma}`;
  const lista = conjuntos.get(k) ?? [];
  lista.push(m);
  conjuntos.set(k, lista);
}

const semanasDaMancha = (m: ManchaPlaneada): SemanaAlocacao[] => {
  const permitidas = new Set(m.semanas);
  return (calendario.get(m.ano) ?? []).filter((s) => permitidas.has(s.global) && s.dias.length > 0);
};

/** Carga FINAL de cada (ano, família, semana), somando todos os conjuntos. */
const cargaDaSemana = new Map<string, number>();
for (const r of plano.resumo) {
  const total = Object.values(r.porForma).reduce((s: number, n) => s + (n ?? 0), 0);
  cargaDaSemana.set(`${r.ano}|${r.familia}|${r.semana}`, total);
}

/**
 * Uma semana está CHEIA quando a carga que o plano lhe deu chegou à carga-alvo
 * do estudante. É o limite que trava a repartição proporcional — e é o único
 * motivo que este teste aceita para um desvio.
 */
const cheia = (ano: number, familia: string, semana: number, dias: number): boolean => {
  const carga = cargaDaSemana.get(`${ano}|${familia}|${semana}`) ?? 0;
  return carga >= limitesDaSemana(regras, ano, dias).alvo;
};

const somasErradas: string[] = [];
const desvios: string[] = [];
const inversoes: string[] = [];
let desviosExplicados = 0;
let inversoesExplicadas = 0;
for (const [k, lista] of conjuntos) {
  const modelo = lista[0];
  const semanas = semanasDaMancha(modelo);
  if (semanas.length === 0) continue;
  // Repartição por maiores restos, reproduzida aqui a partir dos dias úteis.
  const esperado = distribuirBlocos(
    lista.length,
    semanas.map((s) => ({ fator: s.dias.length / regras.grelha.dias.length }) as SemanaInfo),
  );
  const real = semanas.map((s) => lista.filter((m) => m.semana === s.global).length);

  // (a) Nada se perde na repartição.
  const somaReal = real.reduce((a, b) => a + b, 0);
  if (somaReal !== lista.length) {
    somasErradas.push(`${k}: ${lista.length} manchas no conjunto, mas ${somaReal} atribuídas a semanas`);
  }

  // (b) Só se recebe menos do que a quota proporcional quando a semana está cheia.
  semanas.forEach((s, i) => {
    if (real[i] >= esperado[i]) return;
    if (cheia(modelo.ano, modelo.familia, s.global, s.dias.length)) {
      desviosExplicados += 1;
      return;
    }
    desvios.push(
      `${k} semana ${s.global} (${s.dias.length} dias): esperado ${esperado[i]}, real ${real[i]}, ` +
        `e a semana só tem ${cargaDaSemana.get(`${modelo.ano}|${modelo.familia}|${s.global}`) ?? 0} manchas ` +
        `para um alvo de ${limitesDaSemana(regras, modelo.ano, s.dias.length).alvo}`,
    );
  });

  // (c) Uma semana com menos dias só passa à frente de uma mais completa quando
  //     essa está cheia.
  for (let a = 0; a < semanas.length; a++) {
    for (let b = 0; b < semanas.length; b++) {
      if (semanas[a].dias.length >= semanas[b].dias.length || real[a] <= real[b]) continue;
      if (cheia(modelo.ano, modelo.familia, semanas[b].global, semanas[b].dias.length)) {
        inversoesExplicadas += 1;
        continue;
      }
      inversoes.push(
        `${k}: semana ${semanas[a].global} tem ${semanas[a].dias.length} dias e ${real[a]} manchas, ` +
          `mas a semana ${semanas[b].global} tem ${semanas[b].dias.length} dias, só ${real[b]}, e não está cheia`,
      );
    }
  }
}
exigir(somasErradas.length === 0, `a repartição não perde manchas em nenhum dos ${conjuntos.size} conjuntos`);
for (const s of somasErradas.slice(0, 10)) console.log(`         ${s}`);
exigir(
  desvios.length === 0,
  `a repartição de cada conjunto (janela x padrão) é a proporcional aos dias úteis entre as semanas com ` +
    `capacidade: ${desviosExplicados} desvio(s), todos explicados por semanas já na carga-alvo ` +
    `(${conjuntos.size} conjuntos)`,
);
for (const d of desvios.slice(0, 10)) console.log(`         ${d}`);
exigir(
  inversoes.length === 0,
  `nenhuma semana com feriados recebe mais manchas do que uma semana completa que ainda tenha capacidade ` +
    `(${inversoesExplicadas} inversão(ões), todas contra semanas já na carga-alvo)`,
);
for (const i of inversoes.slice(0, 10)) console.log(`         ${i}`);

// ---------------------------------------------------------------------------
// 5. ASSERÇÃO 3 — a quota do padrão de último recurso sai dos dados
// ---------------------------------------------------------------------------

/**
 * Recalcula a quota a partir da procura, sem olhar para o planeador: com
 * contagens de grupos `g1..gn` por unidade curricular, o número máximo de pares
 * de UCs DIFERENTES é `min(total/2, total - max(gi))`; o que sobra pertence todo
 * à mesma UC.
 */
function quotaEsperada(ano: number, familia: string, primeira: number, ultima: number): number {
  const fIdx = mapa.familias.indexOf(familia as "A" | "B");
  const grupos = new Map<string, number>();
  for (let q = 0; q < mapa.quartosPorFamilia; q++) {
    const nomes = mapa.pl(fIdx, q);
    const porUC = new Map<string, number[]>();
    for (const p of procura.values()) {
      if (p.ano !== ano || p.familiaIdx !== fIdx || p.tipo !== "PL") continue;
      if (p.primeira < primeira || p.ultima > ultima) continue;
      const i = nomes.indexOf(p.turma);
      if (i < 0) continue;
      const lista = porUC.get(p.ucId) ?? new Array<number>(nomes.length).fill(0);
      lista[i] = Math.max(0, p.alvo - p.colocados);
      porUC.set(p.ucId, lista);
    }
    for (const [ucId, faltas] of porUC) {
      grupos.set(ucId, (grupos.get(ucId) ?? 0) + Math.min(...faltas));
    }
  }
  const contagens = [...grupos.values()].filter((n) => n > 0);
  const total = contagens.reduce((s, n) => s + n, 0);
  if (total === 0) return 0;
  const maior = Math.max(...contagens);
  const pares = Math.max(0, Math.min(Math.floor(total / 2), total - maior));
  return total - 2 * pares;
}

const errosQuota: string[] = [];
let quotaTotal = 0;
for (const o of plano.orcamentos) {
  const esperada = quotaEsperada(o.ano, o.familia, o.primeira, o.ultima);
  quotaTotal += o.quotaSemParceiro;
  if (o.quotaSemParceiro !== esperada) {
    errosQuota.push(
      `ano ${o.ano} familia ${o.familia} semanas ${o.primeira}-${o.ultima}: ` +
        `o plano reservou ${o.quotaSemParceiro}, a fórmula sobre a procura dá ${esperada}`,
    );
  }
}
exigir(
  errosQuota.length === 0,
  `a quota de grupos sem parceiro é a que sai da procura, em todos os ${plano.orcamentos.length} orçamentos (total reservado: ${quotaTotal})`,
);
for (const e of errosQuota) console.log(`         ${e}`);

// O padrão de último recurso é usado EXATAMENTE a quota reservada — nem mais.
const formaUltimoRecurso = plano.orcamentos.find((o) => o.formaDoGrupoIsolado)?.formaDoGrupoIsolado ?? null;
const usadasUltimoRecurso = formaUltimoRecurso
  ? plano.manchas.filter((m) => m.forma === formaUltimoRecurso).length
  : 0;
exigir(
  formaUltimoRecurso !== null && usadasUltimoRecurso === quotaTotal,
  `a forma de grupo isolado (${formaUltimoRecurso ?? "nenhum"}) é planeado exatamente ${quotaTotal} vez(es), ` +
    `tantas quantas a quota (usadas: ${usadasUltimoRecurso})`,
);

// ... e fica DISTRIBUÍDO, não amontoado: nenhuma semana leva mais do que o
// arredondamento por cima da média da sua janela.
const concentracoes: string[] = [];
if (formaUltimoRecurso !== null) {
  for (const [k, lista] of conjuntos) {
    if (lista[0].forma !== formaUltimoRecurso) continue;
    const semanas = semanasDaMancha(lista[0]);
    const teto = Math.ceil(lista.length / Math.max(1, semanas.length));
    const porSemana = semanas.map((s) => ({ s, n: lista.filter((m) => m.semana === s.global).length }));
    const pico = porSemana.reduce((m, x) => Math.max(m, x.n), 0);
    console.log(
      `  (${formaUltimoRecurso}: ${lista.length} manchas em ${semanas.length} semanas -> ` +
        `${porSemana.map((x) => `s${x.s.global}=${x.n}`).join(" ")})`,
    );
    if (pico > teto) concentracoes.push(`${k}: pico de ${pico} numa semana, teto ${teto}`);
  }
}
exigir(
  concentracoes.length === 0,
  "as manchas do padrão de último recurso ficam espalhadas pelas semanas (nenhuma acima do arredondamento por cima da média)",
);
for (const c of concentracoes) console.log(`         ${c}`);

// ---------------------------------------------------------------------------
// 6. ASSERÇÃO 4 — composições legais, perguntadas ao registo
// ---------------------------------------------------------------------------

const limitePL = new Map<string, number | null>(
  regras.limitesPorUC.map((l) => [l.ucId, l.maxSimultaneoPL]),
);
const limitesUniversais = limitesDaComposicao(regras);
const errosComposicao: string[] = [];
for (const m of plano.manchas) {
  const plPorUC = new Map<string, number>();
  for (const s of m.sessoes) {
    if (s.tipo !== "PL") continue;
    plPorUC.set(s.ucId, (plPorUC.get(s.ucId) ?? 0) + 1);
  }
  const tpPorUC = new Map<string, number>();
  for (const s of m.sessoes) {
    if (s.tipo !== "TP") continue;
    tpPorUC.set(s.ucId, (tpPorUC.get(s.ucId) ?? 0) + 1);
  }
  for (const [ucId, n] of plPorUC) {
    // A REGRA GERAL: no máximo `maxPLporUC` PL da mesma unidade curricular.
    if (n > limitesUniversais.maxPLporUC) {
      errosComposicao.push(
        `mancha ${m.id} (${m.forma}): ${n} PL de ${ucPorId.get(ucId)?.sigla ?? ucId}, acima do limite universal de ${limitesUniversais.maxPLporUC}`,
      );
    }
    const limite = limitePL.get(ucId) ?? null;
    if (limite !== null && n > limite) {
      errosComposicao.push(
        `mancha ${m.id} (${m.forma}): ${n} PL de ${ucPorId.get(ucId)?.sigla ?? ucId}, acima do limite de ${limite}`,
      );
    }
  }
  for (const [ucId, n] of tpPorUC) {
    if (n > limitesUniversais.maxTPporUC) {
      errosComposicao.push(
        `mancha ${m.id} (${m.forma}): ${n} TP de ${ucPorId.get(ucId)?.sigla ?? ucId}, acima do limite universal de ${limitesUniversais.maxTPporUC}`,
      );
    }
    // Uma UC nunca traz TP e PL ao mesmo bloco.
    if (plPorUC.has(ucId)) {
      errosComposicao.push(
        `mancha ${m.id} (${m.forma}) junta TP e PL de ${ucPorId.get(ucId)?.sigla ?? ucId}`,
      );
    }
  }
  // E a mancha tem de fechar as folhas-aluno todas.
  const cobertura = coberturaFolhas(m.sessoes, regras.estruturaTurmas);
  const folhas = mapa.quartosPorFamilia * mapa.plPorQuarto;
  if (cobertura !== folhas) {
    errosComposicao.push(`mancha ${m.id} (${m.forma}) cobre ${cobertura}/${folhas} folhas-aluno`);
  }
}
exigir(
  errosComposicao.length === 0,
  `nenhuma mancha planeada excede os limites de ${limitesUniversais.maxTPporUC} TP / ${limitesUniversais.maxPLporUC} PL ` +
    `da mesma UC, e todas fecham a 100% (${plano.manchas.length} manchas)`,
);
for (const e of errosComposicao.slice(0, 10)) console.log(`         ${e}`);

// A pergunta final é ao REGISTO: cada mancha tem de ser legal em pelo menos um
// dia/hora da sua janela.
//
// O horário de referência tem um PASSADO: todas as aulas T e TP já dadas, numa
// semana anterior a qualquer semana real. Sem ele, as regras de ORDEM (as
// precedências e o rácio TP->PL) recusavam qualquer prática num horário vazio e
// a asserção deixava de dizer o que interessa — que a COMPOSIÇÃO é admissível.
// O passado vive noutra semana, por isso os limites por mancha (práticas
// simultâneas por UC, capacidade de laboratórios, TP e PL da mesma UC)
// continuam a responder exatamente na mesma.
const estadoVazio = criarEstado(criarHierarquia(regras.estruturaTurmas));
for (const p of procura.values()) {
  if (p.tipo !== "T" && p.tipo !== "TP") continue;
  for (let i = 0; i < p.alvo - p.colocados; i++) {
    estadoVazio.colocar({
      sessoes: [{ ucId: p.ucId, ucSigla: p.ucSigla, turma: p.turma, tipo: p.tipo }],
      mancha: { ano: p.ano, semana: 0, dia: regras.grelha.dias[0], hora: regras.grelha.horasInicio[0] },
      familia: p.familia,
    });
  }
}
// A asserção é sobre a SEMANA QUE O PLANO ATRIBUIU, não sobre a janela inteira:
// pôr uma mancha numa semana em que o registo nunca a aceitaria é planear para o
// lixo. (Há UCs com as práticas fechadas a semanas soltas dentro da janela.)
const impossiveis: string[] = [];
for (const m of plano.manchas) {
  const semana = (calendario.get(m.ano) ?? []).find((s) => s.global === m.semana);
  let viavel = false;
  let ultimoMotivo = "a semana atribuída não existe no calendário";
  for (const dia of semana?.dias ?? []) {
    for (const hora of regras.grelha.horasInicio) {
      const mancha: Mancha = { ano: m.ano, semana: m.semana, dia, hora };
      const candidato: Candidato = { sessoes: m.sessoes, mancha, familia: m.familia };
      const motivo = primeiraViolacao(registo, { estado: estadoVazio, candidato, regras, ucPorId });
      if (motivo === null) {
        viavel = true;
        break;
      }
      ultimoMotivo = motivo;
    }
    if (viavel) break;
  }
  if (!viavel) {
    impossiveis.push(
      `mancha ${m.id} (${m.forma}) na semana ${m.semana} ` +
        `[${m.sessoes.map((s) => `${s.ucSigla}/${s.tipo}/${s.turma}`).join(" ")}]: ${ultimoMotivo}`,
    );
  }
}
exigir(
  impossiveis.length === 0,
  `todas as manchas são aceites pelo registo em pelo menos um dia/hora da SEMANA que o plano lhes deu ` +
    `(${registo.length} restrições, ${plano.manchas.length} manchas)`,
);
for (const i of impossiveis.slice(0, 10)) console.log(`         ${i}`);

// ---------------------------------------------------------------------------
// 7. ASSERÇÃO 5 — reversibilidade
// ---------------------------------------------------------------------------

const cobaia = plano.manchas.find((m) => semanasDaMancha(m).length > 1);
if (!cobaia) {
  exigir(false, "há pelo menos uma mancha com mais do que uma semana possível, para testar o replaneamento");
} else {
  const semanasPossiveis = semanasDaMancha(cobaia).length;
  const original = cobaia.semana;
  const vistas = new Set<number>([original]);
  let devolvida = plano.replanear(cobaia);
  let saltos = 0;
  while (devolvida) {
    saltos++;
    if (vistas.has(devolvida.semana)) {
      exigir(false, `replanear repetiu a semana ${devolvida.semana}`);
      break;
    }
    vistas.add(devolvida.semana);
    devolvida = plano.replanear(devolvida);
  }
  exigir(
    saltos === semanasPossiveis - 1,
    `replanear percorre todas as ${semanasPossiveis - 1} semanas alternativas da janela da mancha e só depois desiste ` +
      `(saltos: ${saltos}, semana inicial ${original})`,
  );
  exigir(
    plano.sobras.some((s) => s.motivo.includes("não arrumou esta mancha")),
    "a mancha esgotada passa a sobra explicada, em vez de desaparecer",
  );
  exigir(
    plano.pendentes(cobaia.ano, cobaia.familia, cobaia.semana).every((m) => m.id !== cobaia.id),
    "uma mancha esgotada deixa de aparecer nas pendentes da semana",
  );
}

// ---------------------------------------------------------------------------
// 8. Veredicto
// ---------------------------------------------------------------------------

console.log("");
if (falhas.length > 0) {
  console.error(`FALHA: ${falhas.length} asserção(ões) do planeador não passaram.`);
  for (const f of falhas) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  `Planeador: ${plano.manchas.length} manchas planeadas em ${(duracao / 1000).toFixed(2)}s, ` +
    `orçamento a cobrir 100% da carga, distribuição proporcional aos dias úteis, ` +
    `quota de grupo isolado = ${quotaTotal} e distribuída.`,
);
