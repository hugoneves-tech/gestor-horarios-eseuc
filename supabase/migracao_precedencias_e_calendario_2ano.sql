-- Regras pedagógicas específicas do 2.º ano, mantidas no Supabase.
-- O motor apenas interpreta config.motor; não contém siglas nem quantidades fixas.

insert into regras (id, nome, tipo, categoria, descricao, escopo, ano_curricular, config, peso, ativa)
values
(
  'h_eig_t_antes_tp',
  'EIG: T antes das TP',
  'hard',
  'Estudantes',
  'Em EIG tem de existir pelo menos uma aula T antes de começar qualquer aula TP.',
  'ano',
  '2',
  '{
    "anos": [2],
    "anosLetivos": ["2026/2027"],
    "motor": {
      "precedenciasUC": [{
        "siglas": ["EIG"],
        "tipoAntes": "T",
        "tipoDepois": "TP",
        "minimoAntes": 1
      }]
    }
  }'::jsonb,
  10,
  true
),
(
  'h_psis_4t_antes_tp',
  'PSIS: 4 aulas T antes das TP',
  'hard',
  'Estudantes',
  'Em PSIS têm de decorrer quatro aulas T antes de começar qualquer aula TP.',
  'ano',
  '2',
  '{
    "anos": [2],
    "anosLetivos": ["2026/2027"],
    "motor": {
      "precedenciasUC": [{
        "siglas": ["PSIS"],
        "tipoAntes": "T",
        "tipoDepois": "TP",
        "minimoAntes": 4
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

-- Corrige a regra existente da primeira semana: 09/09/2026 é quarta-feira,
-- e o bloqueio pretendido é nessa tarde, não na sexta-feira.
update regras
set
  nome = 'Tarde livre em 09/09/2026',
  descricao = 'Na semana 1, quarta-feira 09/09/2026 fica sem aulas no período da tarde.',
  config = jsonb_set(
    jsonb_set(
      config,
      '{motor,restricoesUC,0,diasProibidos}',
      '["Quarta"]'::jsonb,
      true
    ),
    '{motor,restricoesUC,0,periodosProibidos}',
    '["tarde"]'::jsonb,
    true
  )
where nome = 'Tarde livre na primeira sexta-feira'
   or id = 'h_tarde_livre_primeira_sexta';
