const fs = require('fs');
const file = 'src/utils/distribuicao.ts';
let code = fs.readFileSync(file, 'utf8');

const regex = /if \(!ordemDias\.length\) return \[\];\s*const slots: Slot\[\] = \[\];\s*for \(const dia of ordemDias\) \{\s*let periodos = tipo === "T" \? periodosTDia\(dia\) : \(dia === "Sexta" \? PERIODOS_MANHA : periodosPrefDia\(dia\)\);\s*for \(const hora of periodos\) slots\.push\(\{ dia, hora \}\);\s*\}\s*\/\/ Bloco de ajuste \(metade oposta\) — só para PL e TP, nunca para T\.\s*if \(tipo === "PL" \|\| tipo === "TP"\) \{\s*for \(const dia of ordemDias\) \{\s*for \(const hora of periodosOver\) slots\.push\(\{ dia, hora \}\);\s*\}\s*\}/m;

const replacement2 = `  // SEMANA PARCIAL S1 (ex.: arranque à 4ª ou 5ª) → 6ª de manhã T (ambas as turmas) e TODAS
  // as TP no bloco 16-18 (admitindo 2 UCs diferentes nesse bloco). Sem quinta, sem PL.
  if (isFirstWeekS1 && !avail.includes("Segunda") && !avail.includes("Terça")) {
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
  }

  if (!ordemDias.length) return [];
  const slots: Slot[] = [];
  const parcialSem = isFirstWeekS1 && !avail.includes("Segunda") && !avail.includes("Terça");

  for (const dia of ordemDias) {
    let periodos = tipo === "T" ? periodosTDia(dia) : (dia === "Sexta" ? PERIODOS_MANHA : periodosPrefDia(dia));
    if (dia === "Quarta" && parcialSem) {
        if (tipo !== "T") continue;
        periodos = PERIODOS_MANHA;
    }
    for (const hora of periodos) slots.push({ dia, hora });
  }

  if (tipo === "PL" || tipo === "TP") {
    for (const dia of ordemDias) {
       if (dia === "Quarta" && parcialSem) continue;
       for (const hora of periodosOver) slots.push({ dia, hora });
    }
  }`;

if (regex.test(code)) {
  code = code.replace(regex, replacement2);
  fs.writeFileSync(file, code);
  console.log("Patched 8.");
} else {
  console.log("Regex failed.");
}
