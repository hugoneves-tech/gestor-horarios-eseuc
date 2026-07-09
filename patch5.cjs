const fs = require('fs');
const file = 'src/utils/distribuicao.ts';
let code = fs.readFileSync(file, 'utf8');

const target1 = `  // SEMANA PARCIAL S1 (ex.: arranque à 4ª ou 5ª no 2.º ano) → 6ª de manhã T (ambas as turmas) e TODAS
  // as TP no bloco 16-18 (admitindo 2 UCs diferentes nesse bloco). Sem quinta, sem PL.
  if (isSemestre1 && !avail.includes("Segunda") && !avail.includes("Terça")) {
    if (!avail.includes("Quarta")) {
      if (!avail.includes("Sexta")) return [];
      if (tipo === "T") {
        const slotsP: Slot[] = [];
        for (const hora of periodosTDia("Sexta")) slotsP.push({ dia: "Sexta", hora });
        return slotsP;
      }
      if (tipo === "TP") return [{ dia: "Sexta", hora: "16:00" }];
      return [];
    }
  }`;

const replacement1 = ``;

const target2 = `  if (!ordemDias.length) return [];

  const slots: Slot[] = [];
  const parcialSem = isSemestre1 && !avail.includes("Segunda") && !avail.includes("Terça");

  for (const dia of ordemDias) {
    let periodos = tipo === "T" ? periodosTDia(dia) : (dia === "Sexta" ? PERIODOS_MANHA : periodosPrefDia(dia));
    if (dia === "Quarta" && parcialSem) {
        // Semana parcial (arranque à 4ª): a 4ª é EXCLUSIVA das Teóricas, de manhã, com
        // AMBAS as turmas no mesmo bloco (como a 6ª): ordem fixa [08,10,12], sem rotação
        // nem metade de família — o anfiteatro leva as duas turmas em simultâneo.
        if (tipo !== "T") continue;
        periodos = PERIODOS_MANHA;
    }
    for (const hora of periodos) slots.push({ dia, hora });
  }

  // Bloco de ajuste (metade oposta) — só para PL e TP, nunca para T.
  if (tipo === "PL" || tipo === "TP") {
    for (const dia of ordemDias) {
       if (dia === "Quarta" && parcialSem) continue;
       for (const hora of periodosOver) slots.push({ dia, hora });
    }
  }`;

const replacement2 = `  if (!ordemDias.length) return [];

  const slots: Slot[] = [];

  for (const dia of ordemDias) {
    let periodos = tipo === "T" ? periodosTDia(dia) : (dia === "Sexta" ? PERIODOS_MANHA : periodosPrefDia(dia));
    for (const hora of periodos) slots.push({ dia, hora });
  }

  // Bloco de ajuste (metade oposta) — só para PL e TP, nunca para T.
  if (tipo === "PL" || tipo === "TP") {
    for (const dia of ordemDias) {
       for (const hora of periodosOver) slots.push({ dia, hora });
    }
  }`;

code = code.replace(target1, replacement1);
code = code.replace(target2, replacement2);
fs.writeFileSync(file, code);
console.log("Patched successfully.");
