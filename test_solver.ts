/**
 * Teste do SOLVER (`src/motor/solver`) com os dados REAIS do snapshot.
 *
 * Não mede qualidade — isso é o que os guiões de `prototipo_solver/` fazem, e
 * demora minutos. Aqui testam-se as garantias que, se falharem, fazem
 * desaparecer aulas do horário sem dar erro nenhum:
 *
 *  1. Os cortes derivam-se do inventário, não estão escritos à mão. As janelas
 *     automáticas têm de bater certo com as que foram medidas.
 *  2. PARTIÇÃO — cada bloco pertence a EXATAMENTE uma janela. Um bloco órfão é
 *     uma aula que desaparece em silêncio; um bloco em duas janelas é uma aula
 *     dada a dobrar.
 *  3. Todo o corte usado é um corte limpo.
 *  4. O PISO DE QUALIDADE. O solver não é determinista: a mesma janela já deu
 *     182/182 blocos numa corrida e 179/182 noutra. `otimizar` tem de terminar
 *     sempre com uma comparação e devolver a proposta de partida quando o
 *     solver não a bate. Testa-se com o solver amarrado a uma só janela, onde
 *     ele NÃO PODE ganhar — o horário devolvido tem de ser o de partida, intacto.
 *
 * Localização do snapshot: `SB_SNAPSHOT_DIR`.
 */

import { carregarContexto } from "./prototipo_solver/dados";
import {
  cortesLimpos,
  janelasAutomaticas,
  blocosOrfaos,
  otimizar,
  contextoDe,
} from "./src/motor/solver";
import { blocosDaJanela } from "./src/motor/solver/modelo";
import { alocar } from "./src/motor/alocador";

let falhas = 0;
const ok = (nome: string, cond: boolean, detalhe = "") => {
  console.log(`${cond ? "  ok  " : "FALHA "} ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  if (!cond) falhas++;
};

const ctxProto = carregarContexto();
const ctx = contextoDe(ctxProto.entrada);
const inv = ctx.inventario;

console.log(`inventário: ${inv.blocos.length} blocos\n`);

// --- 1. cortes e janelas ----------------------------------------------------
const limpos = cortesLimpos(inv);
const janelas = janelasAutomaticas(inv);
console.log(`cortes limpos   : ${limpos.join(", ")}`);
console.log(`janelas automáticas: ${janelas.map(([a, b]) => `${a}-${b}`).join(" · ")}\n`);

const esperadas = "1-7 · 8-15 · 16-23 · 24-29";
ok(
  "janelas automáticas são as medidas",
  janelas.map(([a, b]) => `${a}-${b}`).join(" · ") === esperadas,
  `esperado ${esperadas}`,
);

// --- 2. partição ------------------------------------------------------------
const contagem = new Map<number, number>();
for (const [de, ate] of janelas) {
  for (const b of blocosDaJanela(inv, de, ate)) {
    const i = inv.blocos.indexOf(b);
    contagem.set(i, (contagem.get(i) ?? 0) + 1);
  }
}
const orfaos = blocosOrfaos(inv, janelas);
const duplicados = [...contagem.values()].filter((n) => n > 1).length;
ok("bloco nenhum fica órfão", orfaos === 0, `${orfaos} órfãos`);
ok("bloco nenhum cai em duas janelas", duplicados === 0, `${duplicados} duplicados`);
ok(
  "a soma das janelas é o inventário",
  contagem.size === inv.blocos.length,
  `${contagem.size} de ${inv.blocos.length}`,
);

// --- 3. os cortes usados são limpos ----------------------------------------
const usados = janelas.slice(1).map(([de]) => de);
const sujos = usados.filter((c) => !limpos.includes(c));
ok("todo o corte usado é limpo", sujos.length === 0, sujos.length ? `sujos: ${sujos.join(", ")}` : "");

// --- 4. o piso de qualidade -------------------------------------------------
// Amarrado a uma só janela, o solver produz um horário parcial. Não pode ganhar
// à proposta completa — e `otimizar` tem de dar por isso.
console.log("\na verificar o piso de qualidade (uma janela, 10 s)…");
const partida = alocar(ctxProto.entrada).sessoes;
const res = await otimizar(ctxProto.entrada, {
  janelas: [janelas[0]],
  segundosPorJanela: 10,
  propostaDePartida: partida,
});
console.log(
  `  solver: ${res.medidaSolver.sessoes} sessões, completude ${res.medidaSolver.completude.toFixed(2)}% · ` +
    `partida: ${res.medidaPartida.sessoes} sessões, completude ${res.medidaPartida.completude.toFixed(2)}%`,
);
ok("escolheu a proposta de partida", res.origem === "proposta-de-partida", `escolheu ${res.origem}`);
ok(
  "devolveu a proposta de partida intacta",
  res.sessoes.length === partida.length,
  `${res.sessoes.length} vs ${partida.length}`,
);

console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM" : `${falhas} TESTE(S) FALHARAM`}`);
process.exit(falhas === 0 ? 0 : 1);
