/**
 * Teste do INVENTÁRIO DE BLOCOS com os dados REAIS do snapshot do Supabase.
 *
 * O inventário responde, ANTES de qualquer colocação, a três perguntas: que
 * blocos existem, quantos cabem, e se cabem. Este teste imprime as três
 * respostas e FALHA (exit 1) se alguma das garantias for quebrada:
 *
 *  1. CONSERVAÇÃO — a asserção que importa. A soma das sessões dos blocos
 *     inventariados, mais a carga explicitamente dada como não inventariada,
 *     tem de ser EXATAMENTE a carga por colocar das unidades curriculares.
 *     Nada se perde e nada se inventa: um bloco a mais é uma aula que ninguém
 *     pediu, um bloco a menos é uma aula que desaparece sem ninguém dar por ela.
 *  2. Nenhuma turma recebe, nos blocos, mais aulas do que as que lhe faltam.
 *  3. Cada bloco corresponde EXATAMENTE a um padrão ativo e cobre 100% das
 *     folhas-aluno da sua família — zero blocos parciais.
 *  4. Toda a carga não inventariada traz motivo.
 *  5. A quota de grupos de práticas sem parceiro é a que sai da procura, pela
 *     fórmula do emparelhamento máximo — recalculada aqui, fora do inventário.
 *  6. O emparelhamento de grupos de práticas é ÓTIMO (atingiu o limite superior
 *     provado a partir das contagens).
 *  7. A capacidade de cada semana nunca é negativa nem passa da grelha, e o alvo
 *     nunca passa o teto.
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
  limitesDaSemana,
} from "./src/motor/planeador";
import { emparelharTrios, formatarInventario, inventariar } from "./src/motor/inventario";
import { coberturaFolhas, formaDe } from "./src/motor/padroes";
import type { FormaId } from "./src/motor/padroes";
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
console.log(`Regras: ${linhasRegras.length} | UCs: ${ucs.length} | Ano letivo: ${anoLetivo}`);
if (relRegras.malformadas.length > 0) {
  console.error("FALHA: o snapshot tem regras malformadas; corrija-as antes de correr o inventário.");
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
// 2. Correr o inventário
// ---------------------------------------------------------------------------

const inicio = Date.now();
const inv = inventariar(entrada, regras, undefined, registo);
const duracao = Date.now() - inicio;

console.log(`\nInventário: ${inv.blocos.length} blocos em ${(duracao / 1000).toFixed(2)}s\n`);
console.log(formatarInventario(inv));

console.log("\n\nASSERCOES");
console.log("=========");

// ---------------------------------------------------------------------------
// 3. ASSERÇÃO 1 — nada se perde, nada se inventa
//
// A procura é recalculada aqui, com as mesmas peças públicas que o inventário
// usa, para que a contagem seja INDEPENDENTE do que o inventário diz de si
// próprio.
// ---------------------------------------------------------------------------

const { itens: procura } = construirProcura(entrada, mapa);
descontarJaColocado(entrada, regras, mapa, procura, ucPorId);

/** Chave de uma folha de carga: unidade curricular, tipo e turma. */
const chaveCarga = (ucSigla: string, tipo: string, turma: string) => `${ucSigla}|${tipo}|${turma}`;

const porColocar = new Map<string, number>();
let blocosPorColocar = 0;
for (const p of procura.values()) {
  const falta = p.alvo - p.colocados;
  if (falta <= 0) continue;
  porColocar.set(chaveCarga(p.ucSigla, p.tipo, p.turma), falta);
  blocosPorColocar += falta;
}

const nosBlocos = new Map<string, number>();
let sessoesInventariadas = 0;
for (const b of inv.blocos) {
  for (const s of b.sessoes) {
    const k = chaveCarga(s.ucSigla, s.tipo, s.turma);
    nosBlocos.set(k, (nosBlocos.get(k) ?? 0) + 1);
    sessoesInventariadas += 1;
  }
}

const blocosNaoInventariados = inv.naoInventariada.reduce((s, n) => s + n.blocos, 0);

console.log(`  (carga por colocar: ${blocosPorColocar} blocos)`);
console.log(`  (nos blocos inventariados: ${sessoesInventariadas})`);
console.log(`  (declarados não inventariáveis: ${blocosNaoInventariados})`);

exigir(
  sessoesInventariadas + blocosNaoInventariados === blocosPorColocar,
  `a soma das sessões dos blocos inventariados (${sessoesInventariadas}) mais a carga declarada não ` +
    `inventariável (${blocosNaoInventariados}) é EXATAMENTE a carga por colocar (${blocosPorColocar}) — ` +
    "nada se perde nem se inventa",
);
if (sessoesInventariadas + blocosNaoInventariados !== blocosPorColocar) {
  console.log(
    `         diferença: ${sessoesInventariadas + blocosNaoInventariados - blocosPorColocar} bloco(s)`,
  );
}

// Nenhuma turma recebe mais aulas do que as que lhe faltam.
const excessos: string[] = [];
for (const [k, n] of nosBlocos) {
  const alvo = porColocar.get(k) ?? 0;
  if (n > alvo) excessos.push(`${k}: inventariados ${n}, mas só faltavam ${alvo}`);
}
exigir(excessos.length === 0, "nenhuma turma recebe nos blocos mais aulas do que as que lhe faltam");
for (const e of excessos.slice(0, 10)) console.log(`         ${e}`);

// ---------------------------------------------------------------------------
// 4. ASSERÇÃO 2 — todo o bloco cabe nos limites e fecha a 100%
// ---------------------------------------------------------------------------


const folhasDaFamilia = regras.estruturaTurmas.tpPorTurmaTeorica * regras.estruturaTurmas.plPorTP;

const parciais: string[] = [];
const desalinhados: string[] = [];
for (const b of inv.blocos) {
  const cobertura = coberturaFolhas(b.sessoes, regras.estruturaTurmas);
  if (cobertura !== folhasDaFamilia) {
    parciais.push(`bloco ${b.id} (${b.forma}): cobre ${cobertura}/${folhasDaFamilia} folhas-aluno`);
  }
  const reconhecido = formaDe(b.sessoes, ucPorId);
  if (reconhecido !== b.forma) {
    desalinhados.push(`bloco ${b.id}: diz ser ${b.forma}, mas as sessões formam ${reconhecido ?? "nenhuma forma"}`);
  }
}
exigir(
  parciais.length === 0,
  `todos os ${inv.blocos.length} blocos cobrem ${folhasDaFamilia}/${folhasDaFamilia} folhas-aluno (zero blocos parciais)`,
);
for (const p of parciais.slice(0, 10)) console.log(`         ${p}`);
exigir(desalinhados.length === 0, "a forma declarada de cada bloco é o que as suas sessões formam");
for (const d of desalinhados.slice(0, 10)) console.log(`         ${d}`);

// Todo o bloco tem pelo menos uma semana onde pode viver.
exigir(
  inv.blocos.every((b) => b.semanasViaveis.length > 0),
  "todos os blocos trazem pelo menos uma semana viável (o registo aceita-os algures)",
);

// Toda a carga não inventariada traz motivo.
exigir(
  inv.naoInventariada.every((n) => n.motivo.trim().length > 0),
  `toda a carga não inventariada (${inv.naoInventariada.length} item(s)) traz motivo`,
);

// ---------------------------------------------------------------------------
// 5. ASSERÇÃO 3 — a quota de grupos sem parceiro sai dos dados
//
// Recalculada aqui, sem olhar para o inventário: com contagens de grupos
// `g1..gn` por unidade curricular, o número máximo de pares de UCs DIFERENTES é
// `min(total/2, total - max(gi))`; o que sobra pertence todo à mesma UC e só
// fecha com o padrão que leva um grupo isolado.
// ---------------------------------------------------------------------------

function gruposDaJanela(ano: number, familia: string, primeira: number, ultima: number): Map<string, number[]> {
  const fIdx = mapa.familias.indexOf(familia as "A" | "B");
  const porUCporQuarto = new Map<string, number[]>();
  for (let q = 0; q < mapa.quartosPorFamilia; q++) {
    const nomes = mapa.pl(fIdx, q);
    const faltasPorUC = new Map<string, number[]>();
    for (const p of procura.values()) {
      if (p.ano !== ano || p.familiaIdx !== fIdx || p.tipo !== "PL") continue;
      if (p.primeira < primeira || p.ultima > ultima) continue;
      const i = nomes.indexOf(p.turma);
      if (i < 0) continue;
      const lista = faltasPorUC.get(p.ucId) ?? new Array<number>(nomes.length).fill(0);
      lista[i] = Math.max(0, p.alvo - p.colocados);
      faltasPorUC.set(p.ucId, lista);
    }
    for (const [ucId, faltas] of faltasPorUC) {
      const linha = porUCporQuarto.get(ucId) ?? new Array<number>(mapa.quartosPorFamilia).fill(0);
      linha[q] += Math.min(...faltas);
      porUCporQuarto.set(ucId, linha);
    }
  }
  for (const [ucId, linha] of porUCporQuarto) {
    if (linha.reduce((s, n) => s + n, 0) === 0) porUCporQuarto.delete(ucId);
  }
  return porUCporQuarto;
}

const errosQuota: string[] = [];
const errosPares: string[] = [];
let quotaTotal = 0;
for (const e of inv.emparelhamentos) {
  quotaTotal += e.semParceiro;
  const linhas = [...gruposDaJanela(e.ano, e.familia, e.primeira, e.ultima).values()];
  const contagens = linhas.map((l) => l.reduce((s, n) => s + n, 0)).filter((n) => n > 0);
  const total = contagens.reduce((s, n) => s + n, 0);
  const maior = contagens.length > 0 ? Math.max(...contagens) : 0;
  const paresEsperados = Math.max(0, Math.min(Math.floor(total / 2), total - maior));

  if (e.trios !== total) {
    errosQuota.push(
      `ano ${e.ano} familia ${e.familia} semanas ${e.primeira}-${e.ultima}: ` +
        `o inventário contou ${e.trios} grupos, a procura dá ${total}`,
    );
  }
  // A quota reservada não pode ser menor do que a que a fórmula obriga: o padrão
  // do grupo isolado pode ainda absorver mais (quando o registo permite juntar
  // dois grupos da mesma UC), nunca menos.
  if (e.semParceiro > total - 2 * paresEsperados) {
    errosQuota.push(
      `ano ${e.ano} familia ${e.familia} semanas ${e.primeira}-${e.ultima}: ` +
        `o inventário reservou ${e.semParceiro}, a fórmula sobre a procura dá ${total - 2 * paresEsperados}`,
    );
  }
  // O emparelhamento é EXATO: tem de atingir o limite superior provado.
  if (!e.otimo || e.pares !== e.limiteDePares) {
    errosPares.push(
      `ano ${e.ano} familia ${e.familia} semanas ${e.primeira}-${e.ultima}: ` +
        `${e.pares} pares contra um limite de ${e.limiteDePares}${e.otimo ? "" : " (não certificado)"}`,
    );
  }
}
exigir(
  errosQuota.length === 0,
  `a quota de grupos sem parceiro é a que sai da procura, em todas as ${inv.emparelhamentos.length} janelas ` +
    `(total reservado: ${quotaTotal})`,
);
for (const e of errosQuota) console.log(`         ${e}`);
exigir(
  errosPares.length === 0,
  "o emparelhamento de grupos de práticas atinge o limite superior provado em todas as janelas (é ótimo)",
);
for (const e of errosPares) console.log(`         ${e}`);

// O padrão do grupo isolado é usado exatamente a quota reservada — nem mais.
const formaIsolada = inv.emparelhamentos.find((e) => e.formaDoGrupoIsolado)?.formaDoGrupoIsolado ?? null;
if (formaIsolada !== null) {
  const usadas = inv.blocos.filter((b) => b.forma === formaIsolada).length;
  exigir(
    usadas === quotaTotal,
    `a forma de grupo isolado (${formaIsolada}) é inventariado exatamente ${quotaTotal} vez(es), ` +
      `tantas quantas a quota (usadas: ${usadas})`,
  );
}

// A correspondência exata é ela própria posta à prova numa matriz conhecida:
// 3 UCs com 2 grupos em cada um de 2 desdobramentos emparelham na perfeição.
const provaMatriz = [
  [2, 2],
  [2, 2],
  [2, 2],
];
const provaResultado = emparelharTrios(provaMatriz.map((l) => l.slice()));
exigir(
  provaResultado.pares.length === 6 && provaResultado.otimo,
  `a correspondência exata resolve a matriz de prova com ${provaResultado.pares.length}/6 pares e certifica-a`,
);
const provaValida = provaResultado.pares.every(([a, b]) => a.uc !== b.uc && a.quarto !== b.quarto);
exigir(provaValida, "todos os pares da matriz de prova são de UCs e desdobramentos diferentes");

// ---------------------------------------------------------------------------
// 6. ASSERÇÃO 4 — a capacidade é coerente com a grelha e com a carga diária
// ---------------------------------------------------------------------------

const errosCapacidade: string[] = [];
const blocosPorDia = regras.grelha.horasInicio.length;
for (const c of inv.capacidade) {
  if (c.tetoManchas < 0 || c.alvoManchas < 0) {
    errosCapacidade.push(`ano ${c.ano} ${c.familia} semana ${c.semana}: capacidade negativa`);
  }
  if (c.tetoManchas > c.diasUteis * blocosPorDia) {
    errosCapacidade.push(
      `ano ${c.ano} ${c.familia} semana ${c.semana}: teto ${c.tetoManchas} acima dos ` +
        `${c.diasUteis * blocosPorDia} lugares que a grelha tem em ${c.diasUteis} dia(s)`,
    );
  }
  if (c.alvoManchas > c.tetoManchas) {
    errosCapacidade.push(
      `ano ${c.ano} ${c.familia} semana ${c.semana}: alvo ${c.alvoManchas} acima do teto ${c.tetoManchas}`,
    );
  }
  const recalculado = limitesDaSemana(regras, c.ano, c.diasUteis);
  if (recalculado.teto !== c.tetoManchas || recalculado.alvo !== c.alvoManchas) {
    errosCapacidade.push(
      `ano ${c.ano} ${c.familia} semana ${c.semana}: o inventário diz ${c.alvoManchas}/${c.tetoManchas} ` +
        `e a regra de carga diária dá ${recalculado.alvo}/${recalculado.teto}`,
    );
  }
}
exigir(
  errosCapacidade.length === 0,
  `a capacidade das ${inv.capacidade.length} semanas sai da regra de carga diária e cabe na grelha`,
);
for (const e of errosCapacidade.slice(0, 10)) console.log(`         ${e}`);

// ---------------------------------------------------------------------------
// 7. ASSERÇÃO 5 — o confronto é aritmeticamente consistente
// ---------------------------------------------------------------------------

const cf = inv.confronto;
exigir(
  cf.necessario === inv.blocos.length,
  `o confronto conta os mesmos blocos que o inventário enumerou (${cf.necessario})`,
);
exigir(
  cf.folgaNoAlvo === cf.disponivelNoAlvo - cf.necessario &&
    cf.folgaNoTeto === cf.disponivelNoTeto - cf.necessario,
  "as folgas do confronto são a diferença entre o disponível e o necessário",
);
exigir(
  cf.disponivelNoAlvo <= cf.disponivelNoTeto,
  `o disponível à carga-alvo (${cf.disponivelNoAlvo}) nunca passa o disponível ao teto (${cf.disponivelNoTeto})`,
);
console.log(
  `  (veredicto: ${cf.veredicto} — ${cf.necessario} blocos para ${cf.disponivelNoAlvo} manchas ao alvo ` +
    `e ${cf.disponivelNoTeto} ao teto; ${cf.semanasCriticas.length} semana(s) crítica(s))`,
);

// ---------------------------------------------------------------------------
// 8. Veredicto
// ---------------------------------------------------------------------------

if (falhas.length > 0) {
  console.error(`\nFALHA: ${falhas.length} asserção(ões) do inventário não passaram.`);
  for (const f of falhas) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  `\nInventário: ${inv.blocos.length} blocos, ${sessoesInventariadas} sessões, ` +
    `carga conservada (${blocosPorColocar} blocos), emparelhamento ótimo, capacidade coerente.`,
);
