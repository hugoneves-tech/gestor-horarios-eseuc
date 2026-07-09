const fs = require('fs');
const file = 'src/data/mappers.ts';
let code = fs.readFileSync(file, 'utf8');

const target1 = `  ativo: a.ativo, data_inicio_semestre: a.dataInicioSemestre ?? null,
  semanas_personalizadas: a.semanasPersonalizadas ?? null,`;

const replacement1 = `  ativo: a.ativo, data_inicio_semestre: a.dataInicioSemestre ?? null,
  semanas_personalizadas: a.semanasPersonalizadas ?? null,
  data_inicio_ano1: a.dataInicioAno1 ?? null,
  data_inicio_ano2: a.dataInicioAno2 ?? null,
  data_inicio_ano3: a.dataInicioAno3 ?? null,
  data_inicio_ano4: a.dataInicioAno4 ?? null,`;

const target2 = `  ativo: !!r.ativo, dataInicioSemestre: r.data_inicio_semestre ?? undefined,
  semanasPersonalizadas: r.semanas_personalizadas ?? undefined,`;

const replacement2 = `  ativo: !!r.ativo, dataInicioSemestre: r.data_inicio_semestre ?? undefined,
  semanasPersonalizadas: r.semanas_personalizadas ?? undefined,
  dataInicioAno1: r.data_inicio_ano1 ?? undefined,
  dataInicioAno2: r.data_inicio_ano2 ?? undefined,
  dataInicioAno3: r.data_inicio_ano3 ?? undefined,
  dataInicioAno4: r.data_inicio_ano4 ?? undefined,`;

if (code.includes(target1) && code.includes(target2)) {
  code = code.replace(target1, replacement1);
  code = code.replace(target2, replacement2);
  fs.writeFileSync(file, code);
  console.log("Mappers patched successfully.");
} else {
  console.log("Target not found in mappers.");
}
