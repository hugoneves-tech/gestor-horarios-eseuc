/**
 * JANELA ROLANTE — a tese que a bateria sugeriu, medida a sério.
 *
 * A bateria mostrou que o solver monolítico de 15 semanas deixa 45 blocos por
 * colocar em 45 s, mas que as duas metades desse mesmo semestre, resolvidas em
 * separado, colocam os 285. Isso pode ser um artefacto: cada metade foi
 * resolvida às cegas, sem saber o que a outra tinha feito, e o validador também
 * só viu meio semestre de cada vez — precedências e ritmo atravessam o corte.
 *
 * Aqui as janelas são resolvidas POR ORDEM, cada uma recebendo tudo o que as
 * anteriores colocaram como `sessoesFixas` (que o modelo conta como
 * pré-requisitos já cumpridos), e no fim o VALIDADOR INDEPENDENTE vê as 30
 * semanas de uma só vez. É o único teste que distingue as duas hipóteses.
 *
 * Os cortes vêm da sonda `cortes.ts`: 2, 8, 16, 17 e 24 são os únicos pontos
 * onde bloco nenhum atravessa. Escritos aqui como números de semana, não como
 * siglas — o corte é uma propriedade do calendário, não das UCs.
 */

import { carregarContexto } from "./dados";
import { OPCOES_PADRAO, resolver } from "./modelo";
import { alocar } from "../src/motor/alocador";
import { validar } from "../src/validacao/validador";
import type { SessaoHorario } from "../src/types";

const TEMPO = Number(process.env.SOLVER_SEGUNDOS ?? 120);
/**
 * Arranque a quente. Sem isto o solver parte do zero em cada janela e o
 * resultado não é reprodutível: com 8 trabalhadores e limite por relógio de
 * parede, cada execução segue uma trajetória diferente — medimos a MESMA janela
 * a colocar 182/182 blocos em 45 s e 181/182 em 120 s. Dar-lhe a solução da
 * heurística como ponto de partida põe um PISO no resultado.
 */
const COM_PISTA = process.env.SEM_PISTA !== "1";
const JANELAS: [number, number][] = [
  [1, 7],
  [8, 15],
  [16, 23],
  [24, 29],
];

const ctx = carregarContexto();
const r = ctx.regras;
const blocoH = r.grelha.duracaoBlocoHoras;

/** As sessões que o coordenador impõe e o solver não decide. */
function layoutFixo(de: number, ate: number): SessaoHorario[] {
  const out: SessaoHorario[] = [];
  let id = 1_000_000;
  for (const l of r.layoutsFixos) {
    for (const s of l.sessoes) {
      if (s.semana < de || s.semana > ate) continue;
      for (const turma of s.turmas) {
        const hh = Number(s.hora.slice(0, 2)) + blocoH;
        out.push({
          id: id++, ucNome: s.ucSigla, ucSigla: s.ucSigla, tipoAula: s.tipo,
          docente: "", sala: "", salaTipo: "", turma,
          diaSemana: s.dia, horaInicio: s.hora,
          horaFim: `${String(hh).padStart(2, "0")}:${s.hora.slice(3)}`,
          bloqueado: true, semana: s.semana,
        });
      }
    }
  }
  return out;
}

function contar(ss: SessaoHorario[]) {
  const v = validar(ss, ctx.ucs, r);
  return {
    erros: v.violacoes.filter((x) => x.gravidade === "erro").length,
    avisos: v.violacoes.filter((x) => x.gravidade === "aviso").length,
    parciais: v.violacoes.filter((x) => x.regra === "dia-abaixo-do-alvo").length,
    completude: v.completude.pct,
    equilibrio: v.equilibrio.map((e) => `${e.familia}${e.bloco}:${e.amplitude}`).join(" "),
    porRegra: v.porRegra,
  };
}

// --- linha de base ----------------------------------------------------------
const tH = Date.now();
const heur = alocar(ctx.entrada);
const msHeur = Date.now() - tH;
const baseline = contar(heur.sessoes);
console.log(
  `HEURÍSTICA (30 semanas, ${msHeur} ms): ${heur.sessoes.length} sessões · ` +
    `completude ${baseline.completude.toFixed(2)}% · ${baseline.erros} erros · ` +
    `${baseline.avisos} avisos · ${baseline.parciais} dias parciais`,
);
console.log(`arranque a quente: ${COM_PISTA ? "SIM (piso = heurística)" : "NÃO (controlo)"}\n`);

// --- janela rolante ---------------------------------------------------------
let acumulado: SessaoHorario[] = [];
let colocados = 0;
let totais = 0;
let msSolver = 0;

for (const [de, ate] of JANELAS) {
  console.log("-".repeat(72));
  console.log(`JANELA ${de}-${ate}`);
  const fixasDaJanela = layoutFixo(de, ate);
  // Tudo o que já foi decidido, mais o layout imposto: as semanas anteriores
  // contam como pré-requisitos cumpridos.
  const fixas = [...acumulado, ...fixasDaJanela];
  const res = await resolver(ctx, {
    ...OPCOES_PADRAO,
    de, ate, tempo: TEMPO, verboso: true, sessoesFixas: fixas,
    pista: COM_PISTA
      ? heur.sessoes.filter((s) => (s.semana ?? 0) >= de && (s.semana ?? 0) <= ate)
      : undefined,
  });
  colocados += res.blocosColocados;
  totais += res.blocosTotais;
  msSolver += res.msConstrucao + res.msSolve;
  acumulado = [...acumulado, ...fixasDaJanela, ...res.sessoes];
  const parcial = contar(acumulado);
  console.log(
    `  -> ${res.blocosColocados}/${res.blocosTotais} blocos · acumulado ${acumulado.length} sessões · ` +
      `${parcial.erros} erros · ${parcial.avisos} avisos · ${parcial.parciais} dias parciais`,
  );
}

// --- veredicto sobre as 30 semanas -----------------------------------------
const fim = contar(acumulado);
console.log("\n" + "#".repeat(72));
console.log("VEREDICTO DO VALIDADOR INDEPENDENTE — 30 SEMANAS DE UMA SÓ VEZ");
console.log("#".repeat(72));
console.log(`  blocos colocados : ${colocados}/${totais}`);
console.log(`  sessões          : ${acumulado.length}   (heurística: ${heur.sessoes.length})`);
console.log(`  completude       : ${fim.completude.toFixed(2)}%   (heurística: ${baseline.completude.toFixed(2)}%)`);
console.log(`  erros            : ${fim.erros}   (heurística: ${baseline.erros})`);
console.log(`  avisos           : ${fim.avisos}   (heurística: ${baseline.avisos})`);
console.log(`  dias parciais    : ${fim.parciais}   (heurística: ${baseline.parciais})`);
console.log(`  amplitude semanal: ${fim.equilibrio}   (heurística: ${baseline.equilibrio})`);
console.log(`  tempo do solver  : ${(msSolver / 1000).toFixed(1)} s em ${JANELAS.length} janelas (heurística: ${(msHeur / 1000).toFixed(1)} s)`);
console.log(`\n  violações por regra (solver):     ${JSON.stringify(fim.porRegra)}`);
console.log(`  violações por regra (heurística): ${JSON.stringify(baseline.porRegra)}`);
