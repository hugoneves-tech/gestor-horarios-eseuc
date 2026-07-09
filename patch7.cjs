const fs = require('fs');
const file = 'src/utils/distribuicao.ts';
let code = fs.readFileSync(file, 'utf8');

const target1 = `  flexivel: boolean = false, // PL de MI: qualquer dia, no período da família (tapa-buracos)
  isSemestre1: boolean = true // Só se aplica a regras de arranque do 1º semestre (ex. 4ª feira)
): Slot[] {`;

const replacement1 = `  flexivel: boolean = false, // PL de MI: qualquer dia, no período da família (tapa-buracos)
  isFirstWeekS1: boolean = false // Só se aplica à semana 1 do 1º semestre
): Slot[] {`;

const target3 = `      const pool = poolDoTipo(tipoAula, semana.diasBloqueados, manha, 0, false, uc.semestre === 1);`;
const replacement3 = `      const pool = poolDoTipo(tipoAula, semana.diasBloqueados, manha, 0, false, uc.semestre === 1 && semanaGlobal === 1);`;

const target4 = `    let pool = poolDoTipo(t.tipo, wk.diasBloqueados, manhaEf, rotacao, t.flexivel, semestre === 1);`;
const replacement4 = `    let pool = poolDoTipo(t.tipo, wk.diasBloqueados, manhaEf, rotacao, t.flexivel, semestre === 1 && wk.semanaGlobal === 1);`;

if (code.includes(target1)) code = code.replace(target1, replacement1);
if (code.includes(target3)) code = code.replace(target3, replacement3);
if (code.includes(target4)) code = code.replace(target4, replacement4);

fs.writeFileSync(file, code);
