-- Correções pedidas para o 2.º ano em 2026/2027.
-- Idempotente: pode ser executado novamente no SQL Editor do Supabase.
--
-- As regras pedagógicas ficam em public.regras/config.motor. O ficheiro
-- distribuicao.ts contém apenas os intérpretes genéricos destes parâmetros.

insert into public.regras
  (id, nome, tipo, categoria, descricao, escopo, ano_curricular, config, peso, ativa)
values
(
  'h_calendario_2ano_2026_2027',
  'Calendário oficial do 2.º ano — 2026/2027',
  'hard',
  'Calendário',
  'Aplica as interrupções letivas, mantém a numeração oficial até à semana 30 e impede aulas depois de 20/05/2027.',
  'ano',
  '2',
  '{
    "anos": [2],
    "anosLetivos": ["2026/2027"],
    "traducaoSimples": "Bloqueia as datas sem aulas e impede qualquer distribuição depois da semana 30 ou de 20/05/2027.",
    "motor": {
      "bloqueiosCalendario": [
        {"nome":"Início do ano sem aulas","dataInicio":"2026-09-07","dataFim":"2026-09-08","tipo":"Interrupção Letiva"},
        {"nome":"Latada","dataInicio":"2026-09-30","dataFim":"2026-10-02","tipo":"Interrupção Letiva"},
        {"nome":"Implantação da República","dataInicio":"2026-10-05","dataFim":"2026-10-05","tipo":"Feriado"},
        {"nome":"Restauração da Independência","dataInicio":"2026-12-01","dataFim":"2026-12-01","tipo":"Feriado"},
        {"nome":"Imaculada Conceição","dataInicio":"2026-12-08","dataFim":"2026-12-08","tipo":"Feriado"},
        {"nome":"Interrupção de 8 e 9 de fevereiro","dataInicio":"2027-02-08","dataFim":"2027-02-09","tipo":"Interrupção Letiva"},
        {"nome":"Férias da Páscoa — semana 22","dataInicio":"2027-03-22","dataFim":"2027-03-29","tipo":"Interrupção Letiva"}
      ],
      "limitesCalendario": {
        "semanaMaximaGlobal": 30,
        "dataFim": "2027-05-20"
      }
    },
    "validacao": {
      "blocosOficiais": [
        {"bloco":1,"semanaInicio":1,"semanaFim":7,"dataInicio":"2026-09-07","dataFim":"2026-10-23","semanasLetivas":7},
        {"bloco":2,"semanaInicio":8,"semanaFim":15,"dataInicio":"2026-10-26","dataFim":"2026-12-18","semanasLetivas":8},
        {"bloco":3,"semanaInicio":16,"semanaFim":24,"dataInicio":"2027-02-08","dataFim":"2027-04-09","semanasLetivas":8,"semanaPausa":22},
        {"bloco":4,"semanaInicio":25,"semanaFim":30,"dataInicio":"2027-04-12","dataFim":"2027-05-20","semanasLetivas":6}
      ]
    }
  }'::jsonb,
  10,
  true
),
(
  'h_tarde_09_09_2026',
  'Tarde livre em 09/09/2026',
  'hard',
  'Calendário',
  'Na semana 1, quarta-feira 09/09/2026 fica sem aulas no período da tarde.',
  'ano',
  '2',
  '{
    "anos": [2],
    "anosLetivos": ["2026/2027"],
    "traducaoSimples": "Não são distribuídas aulas na quarta-feira 09/09/2026 à tarde.",
    "motor": {
      "restricoesUC": [{
        "siglas": [],
        "diasProibidos": ["Quarta"],
        "periodosProibidos": ["tarde"],
        "tipos": [],
        "semanasRestritas": [1]
      }]
    }
  }'::jsonb,
  10,
  true
),
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
    "traducaoSimples": "EIG só inicia TP depois de ter decorrido pelo menos uma aula T.",
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
    "traducaoSimples": "PSIS só inicia TP depois de terem decorrido quatro aulas T.",
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
),
(
  'h_preenchimento_dias_2ano',
  'Completar dias letivos antes de abrir novos dias',
  'hard',
  'Estudantes',
  'Evita dias isolados apenas das 08h00 às 10h00: procura completar 6h no dia antes de abrir outro, mantendo o máximo absoluto de 8h.',
  'ano',
  '2',
  '{
    "anos": [2],
    "anosLetivos": ["2026/2027"],
    "traducaoSimples": "Privilegia dias de 6h, admite no máximo 8h e evita deixar dias apenas com uma aula das 08h00 às 10h00.",
    "motor": {
      "cargaDiariaEstudante": {
        "alvoHoras": 6,
        "maxHoras": 8,
        "maxDiasNoMaximoPorSemana": 3,
        "evitarDiasParciais": true
      }
    },
    "validacao": {
      "datasQueTinhamApenasUmaAula": [
        "2026-10-27",
        "2026-11-03",
        "2026-11-12",
        "2026-11-19",
        "2026-12-17",
        "2027-02-18",
        "2027-02-23",
        "2027-03-02",
        "2027-03-11",
        "2027-03-19",
        "2027-03-30",
        "2027-04-07"
      ]
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

-- Remove a regra antiga incorreta, caso ainda exista com outro identificador.
delete from public.regras
where id = 'h_tarde_livre_primeira_sexta'
   or (
     nome = 'Tarde livre na primeira sexta-feira'
     and id <> 'h_tarde_09_09_2026'
   );

-- Acrescenta ao catálogo de combinações a regra correta:
-- 2 TP de uma UC + 6 PL de OUTRA UC.
update public.regras
set config = jsonb_set(
  config,
  '{motor,blocos100,padroesAtivos}',
  (
    select jsonb_agg(distinct valor)
    from jsonb_array_elements(
      coalesce(config #> '{motor,blocos100,padroesAtivos}', '[]'::jsonb)
      || '["TP2_PL6_DUAS_UCS"]'::jsonb
    ) as x(valor)
  ),
  true
)
where id = 'h_blocos_ocupacao_100';

-- Mantém também as interrupções na tabela de calendário, para compatibilidade
-- com versões antigas da aplicação que ainda não interpretam bloqueiosCalendario.
insert into public.feriados (id, nome, tipo, data_inicio, data_fim)
values
  ('fer_inicio_2ano_2026', 'Início do ano sem aulas', 'Interrupção Letiva', '2026-09-07', '2026-09-08'),
  ('fer_latada_2026', 'Latada', 'Interrupção Letiva', '2026-09-30', '2026-10-02'),
  ('fer_5out_2026', 'Implantação da República', 'Feriado', '2026-10-05', '2026-10-05'),
  ('fer_1dez_2026', 'Restauração da Independência', 'Feriado', '2026-12-01', '2026-12-01'),
  ('fer_8dez_2026', 'Imaculada Conceição', 'Feriado', '2026-12-08', '2026-12-08'),
  ('fer_8_9fev_2027', 'Interrupção de 8 e 9 de fevereiro', 'Interrupção Letiva', '2027-02-08', '2027-02-09'),
  ('fer_pascoa_2027', 'Férias da Páscoa — semana 22', 'Interrupção Letiva', '2027-03-22', '2027-03-29'),
  ('fer_fim_aulas_2ano_2027', 'Fim das aulas do 2.º ano', 'Interrupção Letiva', '2027-05-21', '2027-12-31')
on conflict (id) do update set
  nome = excluded.nome,
  tipo = excluded.tipo,
  data_inicio = excluded.data_inicio,
  data_fim = excluded.data_fim;
