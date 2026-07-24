-- Capacidade física transversal da ESEUC:
-- no máximo 6 sessões PL no mesmo bloco, somando turmas, UCs e anos.

insert into public.regras (
  id, nome, tipo, categoria, descricao, escopo, ano_curricular, config, peso, ativa
)
values (
  'h_limite_global_6_pl',
  'Máximo global de 6 PL por bloco',
  'hard',
  'Sala',
  'Em cada semana, dia e hora podem decorrer no máximo seis sessões PL em toda a escola, somando todas as turmas, UCs e anos curriculares.',
  'transversal',
  'todos',
  '{"traducaoSimples":"Os seis laboratórios são partilhados por toda a escola: nunca existem mais de 6 PL no mesmo bloco.","motor":{"maxPLporMancha":6}}'::jsonb,
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

-- MI mantém a tipologia de sala de computadores, mas deixa de ter uma
-- capacidade paralela: também conta dentro do máximo global de seis PL.
update public.regras
set
  nome = 'PL de MI em salas de computadores',
  descricao = 'As PL de Metodologia de Investigação (MI) decorrem em salas de computadores, mas contam para o limite operacional global de seis PL em simultâneo.',
  config = jsonb_set(
    coalesce(config, '{}'::jsonb),
    '{traducaoSimples}',
    to_jsonb('As PL de MI usam salas de computadores, mantendo-se dentro do máximo global de 6 PL por bloco.'::text),
    true
  )
where id = 'h_mi_pl_computador';
