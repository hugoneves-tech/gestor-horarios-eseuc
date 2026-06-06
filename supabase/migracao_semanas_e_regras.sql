-- ===========================================================================
-- Migração: semanas bloqueadas (validadas) + regra de disponibilidade docente.
-- Corre uma vez no SQL Editor.
-- ===========================================================================

-- Semanas validadas/congeladas de cada versão (não mudam ao regenerar).
alter table versoes
  add column if not exists semanas_bloqueadas jsonb default '[]'::jsonb;

-- Regra de horários fixos/reduzidos de docentes (na BD já existente).
insert into regras (id, nome, tipo, categoria, descricao, escopo, ano_curricular, config, peso, ativa)
values (
  'h_docente_horario_fixo',
  'Respeitar horários fixos e reduzidos dos docentes',
  'hard', 'Docente',
  'Alguns docentes têm disponibilidade reduzida e específica (dias da semana e horas fixas). As aulas atribuídas só podem ser marcadas dentro da disponibilidade declarada de cada docente.',
  'transversal', 'todos',
  '{"traducaoSimples":"Ao atribuir docentes, o motor só coloca aulas nos dias/horas em que o docente está disponível (definido na ficha do docente)."}'::jsonb,
  10, true
)
on conflict (id) do nothing;

-- Regra: PL de MI em salas de computadores (paralelas às de laboratório).
insert into regras (id, nome, tipo, categoria, descricao, escopo, ano_curricular, config, peso, ativa)
values (
  'h_mi_pl_computador',
  'PL de MI em salas de computadores (paralelas às de laboratório)',
  'hard', 'Sala',
  'As PL de Metodologia de Investigação (MI) decorrem em salas de computadores, não nos laboratórios de simulação. Por isso podem ocorrer em simultâneo com outras PL, contando num conjunto de salas próprio (4 a 6 PL de MI em simultâneo).',
  'transversal', 'todos',
  '{"traducaoSimples":"As PL de MI usam salas de computadores: têm o seu próprio limite (até 6 em simultâneo) e não competem pelas manchas dos laboratórios de simulação."}'::jsonb,
  9, true
)
on conflict (id) do nothing;
