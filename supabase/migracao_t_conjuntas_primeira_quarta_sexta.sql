-- Regra pedida para o 2.º ano, 2026/2027:
-- na primeira quarta e sexta-feira, T1 e T2 têm exatamente a mesma aula T
-- de PsiS, no mesmo bloco e no Auditório Geral ESEUC. Estes dois blocos
-- de 2h garantem 4 horas T por turma antes das TP.
--
-- Idempotente: pode ser executado novamente no SQL Editor do Supabase.

insert into public.regras
  (id, nome, tipo, categoria, descricao, escopo, ano_curricular, config, peso, ativa)
values
(
  'h_t_conjunta_primeira_quarta_sexta',
  'Primeira quarta e sexta com aula T conjunta',
  'hard',
  'Sala',
  'Na semana 1, quarta e sexta-feira têm um bloco T conjunto de PsiS: a mesma UC decorre simultaneamente para a Turma A e a Turma B no mesmo auditório, perfazendo quatro horas T por turma antes das TP.',
  'ano',
  '2',
  '{
    "anos": [2],
    "anosLetivos": ["2026/2027"],
    "traducaoSimples": "PsiS é dada conjuntamente a T1 e T2 na primeira quarta e sexta-feira. São dois blocos de 2h, garantindo 4h T a cada turma antes de começar qualquer TP de PsiS.",
    "motor": {
      "aulasTConjuntas": [{
        "anos": [2],
        "semanas": [1],
        "dias": ["Quarta", "Sexta"],
        "horarios": ["08:00", "10:00", "12:00"],
        "sala": "Auditório Geral ESEUC",
        "obrigatoriaPorDia": true,
        "siglasObrigatorias": ["PSIS"]
      }]
    }
  }'::jsonb,
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

-- A precedência é expressa em horas: dois blocos de 2h por turma = 4h.
insert into public.regras
  (id, nome, tipo, categoria, descricao, escopo, ano_curricular, config, peso, ativa)
values
(
  'h_psis_4t_antes_tp',
  'PSIS: 4 aulas T antes das TP',
  'hard',
  'Estudantes',
  'Em PSIS têm de decorrer quatro horas T por turma antes de começar qualquer aula TP.',
  'ano',
  '2',
  '{
    "anos": [2],
    "anosLetivos": ["2026/2027"],
    "traducaoSimples": "Cada turma recebe 2h T na quarta e 2h T na sexta. As TP só podem começar depois destas 4h T.",
    "motor": {
      "precedenciasUC": [{
        "siglas": ["PSIS"],
        "tipoAntes": "T",
        "tipoDepois": "TP",
        "minimoAntes": 4,
        "unidade": "horas"
      }]
    }
  }'::jsonb,
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

-- Remove versões documentais anteriores da regra, para não aparecerem duplicadas
-- e para não subsistir a formulação incompleta que mencionava apenas a sexta-feira.
delete from public.regras
where id <> 'h_t_conjunta_primeira_quarta_sexta'
  and (
    lower(nome) like '%primeira sexta%aula t%conjunta%'
    or lower(nome) like '%primeira quarta%sexta%aula t%conjunta%'
  );
