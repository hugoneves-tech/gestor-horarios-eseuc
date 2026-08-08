/**
 * BATERIA DE MEDIÇÕES — corre o solver em várias janelas e produz a tabela
 * final do estudo. A heurística é corrida UMA vez e recortada a cada janela.
 * Todos os veredictos são do VALIDADOR INDEPENDENTE.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { blocosDaJanela, carregarContexto } from "./dados";
import { OPCOES_PADRAO, resolver } from "./modelo";
import { alocar } from "../src/motor/alocador";
import { validar } from "../src/validacao/validador";
import type { SessaoHorario } from "../src/types";

const TEMPO = Number(process.env.SOLVER_SEGUNDOS ?? 180);
const ctx = carregarContexto();
const r = ctx.regras;
const blocoH = r.grelha.duracaoBlocoHoras;

const JANELAS: [number, number, string][] = [
  [1, 7, "S1 semanas 1-7 (a janela do enunciado)"],
  [8, 15, "S1 semanas 8-15 (onde a heurística perde blocos)"],
  [1, 15, "1.º semestre completo"],
  [16, 29, "2.º semestre completo"],
];

// --- heurística, uma vez ----------------------------------------------------
const tH = Date.now();
const heur = alocar(ctx.entrada);
const msHeur = Date.now() - tH;
const relHeur = validar(heur.sessoes, ctx.ucs, r);
console.log(
  `HEURÍSTICA ATUAL (30 semanas): ${heur.sessoes.length} sessões em ${msHeur} ms · ` +
    `completude ${relHeur.completude.pct.toFixed(2)}% · ` +
    `${relHeur.violacoes.filter((v) => v.gravidade === "erro").length} erros · ` +
    `${relHeur.violacoes.filter((v) => v.gravidade === "aviso").length} avisos`,
);
console.log(`  limites em vigor: máx ${r.capacidade.maxTPporUCporMancha} TP/UC e ${r.capacidade.maxPLporUCporMancha} PL/UC por mancha (config MIGRADA)\n`);

// --- referência -------------------------------------------------------------
const brutoRef = JSON.parse(
  readFileSync(join(import.meta.dirname ?? ".", "..", "referencia_sessoes.json"), "utf8"),
) as { semana: number; diaSemana: string; horaInicio: string; ucSigla: string; tipoAula: string; turma: string }[];
const nomesT = r.estruturaTurmas.nomesTurmasTeoricas;
const prefT = r.estruturaTurmas.prefixos.teorica;
const semanaLayout = Math.min(...brutoRef.map((s) => s.semana));
const sessoesRef: SessaoHorario[] = brutoRef.map((s, i) => {
  const m = s.turma.match(new RegExp(`^${prefT}(\\d+)$`));
  const hh = Number(s.horaInicio.slice(0, 2)) + blocoH;
  return {
    id: i + 1, ucNome: s.ucSigla, ucSigla: s.ucSigla,
    tipoAula: s.tipoAula as SessaoHorario["tipoAula"],
    docente: "", sala: "", salaTipo: "",
    turma: m ? (nomesT[Number(m[1]) - 1] ?? s.turma) : s.turma,
    diaSemana: s.diaSemana, horaInicio: s.horaInicio,
    horaFim: `${String(hh).padStart(2, "0")}:${s.horaInicio.slice(3)}`,
    bloqueado: s.semana === semanaLayout, semana: s.semana,
  };
});

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

interface Linha {
  quem: string; sessoes: number; erros: number; avisos: number;
  diasParciais: number; sextas: number; amplitude: string; tempo: string;
}

function avaliar(quem: string, ss: SessaoHorario[], tempo: string): Linha {
  const v = validar(ss, ctx.ucs, r);
  const ultimoDia = r.grelha.dias[r.grelha.dias.length - 1];
  const sextas = new Set(ss.filter((s) => s.diaSemana === ultimoDia).map((s) => `${s.semana}`)).size;
  return {
    quem,
    sessoes: ss.length,
    erros: v.violacoes.filter((x) => x.gravidade === "erro").length,
    avisos: v.violacoes.filter((x) => x.gravidade === "aviso").length,
    diasParciais: v.violacoes.filter((x) => x.regra === "dia-abaixo-do-alvo").length,
    sextas,
    amplitude: v.equilibrio.map((e) => `${e.familia}${e.bloco}:${e.amplitude}`).join(" "),
    tempo,
  };
}

const tabela: { janela: string; linhas: Linha[] }[] = [];

for (const [de, ate, nome] of JANELAS) {
  console.log("=".repeat(78));
  console.log(`JANELA ${nome}  [semanas ${de}-${ate}]`);
  console.log("=".repeat(78));
  const nBlocos = blocosDaJanela(ctx.inventario, de, ate).length;
  console.log(`  blocos do inventário nesta janela: ${nBlocos}`);

  const linhas: Linha[] = [];
  const ref = sessoesRef.filter((s) => (s.semana ?? 0) >= de && (s.semana ?? 0) <= ate);
  if (ref.length > 0) linhas.push(avaliar("referência do coordenador", ref, "—"));
  linhas.push(
    avaliar("heurística atual", heur.sessoes.filter((s) => (s.semana ?? 0) >= de && (s.semana ?? 0) <= ate), `${msHeur} ms (30 sem.)`),
  );

  const fixas = layoutFixo(de, ate);
  const res = await resolver(ctx, { ...OPCOES_PADRAO, de, ate, tempo: TEMPO, verboso: true, sessoesFixas: fixas });
  const ss = [...fixas, ...res.sessoes];
  linhas.push(
    avaliar(
      `solver CP-SAT (${res.blocosColocados}/${res.blocosTotais} blocos, ${res.status})`,
      ss,
      `${((res.msConstrucao + res.msSolve) / 1000).toFixed(1)} s`,
    ),
  );
  tabela.push({ janela: `${nome} [${de}-${ate}]`, linhas });
  console.log("");
}

console.log("\n" + "#".repeat(78));
console.log("TABELA FINAL — veredicto do validador independente");
console.log("#".repeat(78));
for (const { janela, linhas } of tabela) {
  console.log(`\n${janela}`);
  console.log(
    "  " + "quem".padEnd(46) + "sessões  erros  avisos  diasParc  sextas  amplitude       tempo",
  );
  for (const l of linhas) {
    console.log(
      "  " + l.quem.padEnd(46) +
        String(l.sessoes).padStart(7) +
        String(l.erros).padStart(7) +
        String(l.avisos).padStart(8) +
        String(l.diasParciais).padStart(10) +
        String(l.sextas).padStart(8) +
        "  " + l.amplitude.padEnd(16) + l.tempo,
    );
  }
}
