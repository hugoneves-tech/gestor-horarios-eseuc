-- Distribuição fixa da primeira semana do 2.º ano.

insert into public.regras (
  id, nome, tipo, categoria, descricao, escopo, ano_curricular, config, peso, ativa
)
values (
  'h_2ano_semana_1_sem_pl',
  '2.º ano: distribuição fixa da semana 1',
  'hard',
  'Calendário',
  'Na semana 1 do 2.º ano, quarta e sexta têm as aulas T definidas e quinta tem apenas 4h de TP de FT e ESDAC. Não existem aulas PL.',
  'ano',
  '2',
  '{
    "anos": [2],
    "traducaoSimples": "Quarta: T de FT, PSIS e ESDAC. Quinta: 4h de TP cruzadas de FT e ESDAC. Sexta: T de PS, PSIS e EIG. Não existem PL.",
    "motor": {
      "restricoesUC": [{
        "siglas": [],
        "tipos": ["T", "TP", "PL"],
        "semanasRestritas": [1],
        "diasProibidos": ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"]
      }],
      "layoutFixo": {
        "ano": 2,
        "sessoes": [
          {"semana":1,"dia":"Quarta","hora":"08:00","uc":"FT","tipo":"T","turmas":["T1","T2"]},
          {"semana":1,"dia":"Quarta","hora":"10:00","uc":"PSIS","tipo":"T","turmas":["T1","T2"]},
          {"semana":1,"dia":"Quarta","hora":"12:00","uc":"ESDAC","tipo":"T","turmas":["T1","T2"]},
          {"semana":1,"dia":"Quinta","hora":"08:00","uc":"FT","tipo":"TP","turmas":["TP1","TP2"]},
          {"semana":1,"dia":"Quinta","hora":"08:00","uc":"ESDAC","tipo":"TP","turmas":["TP3","TP4"]},
          {"semana":1,"dia":"Quinta","hora":"10:00","uc":"ESDAC","tipo":"TP","turmas":["TP1","TP2"]},
          {"semana":1,"dia":"Quinta","hora":"10:00","uc":"FT","tipo":"TP","turmas":["TP3","TP4"]},
          {"semana":1,"dia":"Quinta","hora":"14:00","uc":"FT","tipo":"TP","turmas":["TP5","TP6"]},
          {"semana":1,"dia":"Quinta","hora":"14:00","uc":"ESDAC","tipo":"TP","turmas":["TP7","TP8"]},
          {"semana":1,"dia":"Quinta","hora":"16:00","uc":"ESDAC","tipo":"TP","turmas":["TP5","TP6"]},
          {"semana":1,"dia":"Quinta","hora":"16:00","uc":"FT","tipo":"TP","turmas":["TP7","TP8"]},
          {"semana":1,"dia":"Sexta","hora":"08:00","uc":"PS","tipo":"T","turmas":["T1","T2"]},
          {"semana":1,"dia":"Sexta","hora":"10:00","uc":"PSIS","tipo":"T","turmas":["T1","T2"]},
          {"semana":1,"dia":"Sexta","hora":"12:00","uc":"EIG","tipo":"T","turmas":["T1","T2"]}
        ]
      }
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

-- O alvo continua a ser 6h por dia, mas os cinco dias úteis podem chegar a
-- 8h quando a completude do horário o exigir.
update public.regras
set
  descricao = 'Cada aluno deve ter preferencialmente 6 horas de aulas por dia. Para assegurar a completude, qualquer dia útil pode chegar às 8 horas; nunca mais de 8 horas por dia.',
  config = jsonb_set(
    jsonb_set(
      coalesce(config, '{}'::jsonb),
      '{motor,cargaDiariaEstudante,maxDiasNoMaximoPorSemana}',
      '5'::jsonb,
      true
    ),
    '{traducaoSimples}',
    to_jsonb('O motor procura limitar cada dia a 6h. Para completar a carga na semana correta, permite 8h em qualquer dia útil, sem nunca ultrapassar 8h por dia.'::text),
    true
  ),
  ativa = true
where id = 'h_carga_diaria_estudantes';
