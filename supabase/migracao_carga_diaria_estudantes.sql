insert into public.regras (
  id, nome, tipo, categoria, descricao, escopo, ano_curricular, config, peso, ativa
) values (
  'h_carga_diaria_estudantes',
  'Carga diária dos estudantes: preferencialmente 6h, máximo 8h',
  'hard',
  'Estudantes',
  'Cada aluno deve ter preferencialmente até 6 horas de aulas por dia. São permitidas 8 horas, no máximo num dia por semana; nunca mais de 8 horas.',
  'transversal',
  'todos',
  '{"anos":[],"cursoIds":[],"motor":{"cargaDiariaEstudante":{"alvoHoras":6,"maxHoras":8,"maxDiasNoMaximoPorSemana":1}},"traducaoSimples":"O motor procura limitar cada dia a 6h. Excecionalmente permite 8h num único dia por semana, sem nunca ultrapassar 8h."}'::jsonb,
  10,
  true
)
on conflict (id) do update set
  nome = excluded.nome,
  tipo = excluded.tipo,
  categoria = excluded.categoria,
  descricao = excluded.descricao,
  escopo = excluded.escopo,
  ano_curricular = excluded.ano_curricular,
  config = excluded.config,
  peso = excluded.peso,
  ativa = excluded.ativa;
