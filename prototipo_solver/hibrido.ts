/**
 * ARQUITETURA HÍBRIDA — a heurística dá o ponto de partida, o solver melhora-o.
 *
 * Mede também a MEMÓRIA de pico de UMA resolução isolada, que é o número que
 * decide se isto cabe numa Netlify Function (teto de 4096 MB).
 */

import { blocosDaJanela, carregarContexto } from "./dados";
import { OPCOES_PADRAO, resolver } from "./modelo";
import { alocar } from "../src/motor/alocador";
import { validar } from "../src/validacao/validador";
import type { SessaoHorario } from "../src/types";

const DE = Number(process.env.JANELA_DE ?? 16);
const ATE = Number(process.env.JANELA_ATE ?? 29);
const TEMPO = Number(process.env.SOLVER_SEGUNDOS ?? 300);
const COM_PISTA = process.env.SEM_PISTA !== "1";

const ctx = carregarContexto();
const r = ctx.regras;
const blocoH = r.grelha.duracaoBlocoHoras;

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

const tH = Date.now();
const heur = alocar(ctx.entrada);
const msHeur = Date.now() - tH;
const pista = heur.sessoes.filter((s) => (s.semana ?? 0) >= DE && (s.semana ?? 0) <= ATE);
const relH = validar(pista, ctx.ucs, r);
console.log(`JANELA ${DE}-${ATE} · pista da heurística: ${pista.length} sessões (${msHeur} ms para as 30 semanas)`);
console.log(`  heurística nesta janela: ${relH.violacoes.filter((v) => v.gravidade === "erro").length} erros, ${relH.violacoes.filter((v) => v.gravidade === "aviso").length} avisos`);
console.log(`  blocos do inventário nesta janela: ${blocosDaJanela(ctx.inventario, DE, ATE).length}`);
console.log(`  arranque a quente: ${COM_PISTA ? "SIM" : "NÃO (controlo)"}\n`);

const memAntes = process.memoryUsage().rss;
const res = await resolver(ctx, {
  ...OPCOES_PADRAO,
  de: DE, ate: ATE, tempo: TEMPO,
  pista: COM_PISTA ? pista : undefined,
});
const memDepois = process.memoryUsage().rss;

const ss = [...layoutFixo(DE, ATE), ...res.sessoes];
const v = validar(ss, ctx.ucs, r);
console.log(`\nRESULTADO`);
console.log(`  blocos colocados : ${res.blocosColocados}/${res.blocosTotais} (${res.status})`);
console.log(`  sessões          : ${ss.length}  (heurística: ${pista.length})`);
console.log(`  erros / avisos   : ${v.violacoes.filter((x) => x.gravidade === "erro").length} / ${v.violacoes.filter((x) => x.gravidade === "aviso").length}`);
console.log(`  por regra        : ${JSON.stringify(v.porRegra)}`);
console.log(`  tempo            : construção ${res.msConstrucao} ms + resolução ${res.msSolve} ms`);
console.log(`  memória RSS      : ${(memAntes / 1024 / 1024).toFixed(0)} MB antes -> ${(memDepois / 1024 / 1024).toFixed(0)} MB depois`);
