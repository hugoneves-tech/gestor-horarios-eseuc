const fs = require('fs');
const file = 'src/components/ConfiguracaoCalendario.tsx';
let code = fs.readFileSync(file, 'utf8');

const target1 = `    const specificDate = motorRegra?.parametros?.[` + "`" + `ano\${uc.anoCurricular}_dataInicioSem\${anoSem.semestre}` + "`" + `];
    const startDateToUse = uc.dataInicio || specificDate || anoSem.dataInicioSemestre;`;

const replacement1 = `    const prop = \`dataInicioAno\${uc.anoCurricular}\` as keyof typeof anoSem;
    const specificDate = (anoSem as any)?.[prop] || motorRegra?.parametros?.[` + "`" + `ano\${uc.anoCurricular}_dataInicioSem\${anoSem.semestre}` + "`" + `];
    const startDateToUse = uc.dataInicio || specificDate || anoSem.dataInicioSemestre;`;

if (code.includes(target1)) {
  code = code.replace(target1, replacement1);
  fs.writeFileSync(file, code);
  console.log("Config patched successfully.");
} else {
  console.log("Target not found in config.");
}
