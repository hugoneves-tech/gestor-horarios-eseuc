-- Aumenta de 1 para 3 o número de dias semanais que podem atingir 8h.
-- O alvo mantém-se nas 6h; os dias de 8h só são usados quando necessários
-- para preservar a carga na semana correta e aproximar a completude de 100%.

update regras
set
  descricao = 'Cada aluno deve ter preferencialmente até 6 horas de aulas por dia. Para assegurar a completude, são permitidas 8 horas até três dias por semana; nunca mais de 8 horas.',
  config = jsonb_set(
    jsonb_set(
      coalesce(config, '{}'::jsonb),
      '{motor,cargaDiariaEstudante,maxDiasNoMaximoPorSemana}',
      '3'::jsonb,
      true
    ),
    '{traducaoSimples}',
    to_jsonb('O motor procura limitar cada dia a 6h. Para completar a carga na semana correta, permite 8h até três dias por semana, sem nunca ultrapassar 8h.'::text),
    true
  )
where id = 'h_carga_diaria_estudantes';
