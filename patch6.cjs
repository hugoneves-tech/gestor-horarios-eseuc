const fs = require('fs');
const file = 'src/utils/distribuicao.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/const parcialSem = isSemestre1[^;]+;/, '');
code = code.replace(/if \(dia === "Quarta" && parcialSem\) \{[\s\S]*?periodos = PERIODOS_MANHA;\n\s*\}/g, '');
code = code.replace(/if \(dia === "Quarta" && parcialSem\) continue;/g, '');

fs.writeFileSync(file, code);
console.log("Regex patched successfully.");
