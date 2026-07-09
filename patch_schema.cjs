const fs = require('fs');
const file = 'supabase/schema.sql';
let code = fs.readFileSync(file, 'utf8');

const target = `  ativo                 boolean default false,
  data_inicio_semestre  date,
  semanas_personalizadas jsonb,`;

const replacement = `  ativo                 boolean default false,
  data_inicio_semestre  date,
  semanas_personalizadas jsonb,
  data_inicio_ano1      date,
  data_inicio_ano2      date,
  data_inicio_ano3      date,
  data_inicio_ano4      date,`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync(file, code);
  console.log("Schema patched successfully.");
} else {
  console.log("Target not found in schema.");
}
