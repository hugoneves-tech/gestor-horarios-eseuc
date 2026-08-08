-- ===========================================================================
-- ALINHAR AS REGRAS DO MOTOR COM O HORÁRIO DE REFERÊNCIA DO COORDENADOR
--
-- O coordenador forneceu o horário das semanas 1-7 que considera CORRETO. Passado
-- pelo validador independente, esse horário passa em tudo — composição a 100%,
-- limites de 2 TP e 3 PL da mesma UC por bloco, janelas das aulas T, pausa de
-- almoço, capacidade global de laboratórios — EXCETO em três regras nossas, que
-- estavam mais apertadas do que a prática que ele valida.
--
-- Esta migração corrige exatamente essas três, e nada mais. As três correções
-- foram decididas pelo coordenador depois de ver as violações.
--
-- IDEMPOTENTE: pode ser corrida as vezes que forem precisas.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. MARATONAS: o teto passa a ser do DIA, não da enfiada
--
-- A regra anterior proibia mais do que 2 blocos seguidos (4h) da mesma unidade
-- curricular. O horário de referência tem 3 blocos seguidos (6h) da mesma UC em
-- vários dias, e o coordenador aceita-os.
--
-- O que a coordenação reclamou, e que se mantém proibido, é o DIA de 8h da mesma
-- unidade curricular: 6h seguidas de manhã mais 2h à tarde. Por isso a regra
-- passa a ter dois tetos independentes:
--
--   maxBlocosSeguidosMesmaUC = 3   -> até 6h de enfiada
--   maxBlocosMesmaUCporDia   = 3   -> nunca mais do que 6h no mesmo dia
--
-- É o segundo que proíbe as 8h/dia; o primeiro deixa de ser o que estrangula.
-- ---------------------------------------------------------------------------

insert into public.regras (
  id, nome, tipo, categoria, descricao, escopo, ano_curricular, config, peso, ativa
)
values (
  'h_motor_sem_maratonas_uc',
  'Sem maratonas: até 3 blocos seguidos e no máximo 3 blocos por dia da mesma UC',
  'hard',
  'Estudante',
  'Nenhum grupo de estudantes pode ter mais do que três blocos seguidos (6h) da mesma unidade curricular, nem mais do que três blocos da mesma unidade curricular no mesmo dia, seguidos ou não. O segundo teto é o que proíbe o dia de 8h da mesma UC (6h de manhã mais 2h à tarde) de que a coordenação se queixou.',
  'transversal',
  'todos',
  '{"traducaoSimples":"Ate 6h seguidas da mesma UC, e nunca mais do que 6h da mesma UC no mesmo dia. O que se proibe e o dia de 8h da mesma unidade curricular.","motor":{"maratonaUC":{"ativo":true,"maxBlocosSeguidosMesmaUC":3,"maxBlocosMesmaUCporDia":3}}}'::jsonb,
  9,
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

-- ---------------------------------------------------------------------------
-- 2. RITMO DAS TP: o desvio passa a medir-se em SEMANAS, com o máximo de 2
--
-- O desvio estava em 1 BLOCO. Com um só bloco de folga, todas as unidades
-- curriculares se sincronizam nos mesmos desdobramentos: em cada momento todas
-- as TP querem a mesma turma, e deixa de existir procura para emparelhar uma TP
-- com outra TP num bloco. Foi o que estrangulou a composição a 100% e derrubou a
-- completude do alocador.
--
-- Medir em blocos era, além disso, injusto para as UCs densas: a unidade
-- curricular com 19 blocos de TP em 6 semanas anda a mais de três blocos por
-- semana, e dois blocos de avanço nem meio dia representam. Passa a medir-se em
-- SEMANAS de atraso entre aulas HOMÓLOGAS: a n-ésima aula de uma turma e a
-- n-ésima da outra não podem ficar a mais de 2 semanas de distância.
--
-- O número 2 não é escolhido: é o que se MEDE no horário de referência do
-- coordenador. Nas semanas 1-7, o atraso máximo entre turmas TP é de exatamente
-- 2 semanas em todas as unidades curriculares e nas duas famílias — tanto na UC
-- de 3 blocos por turma como na de 19. Em blocos, a mesma referência chega a 7
-- blocos de avanço, o que mostra que a contagem em blocos estava a medir o
-- ritmo da UC e não o desfasamento entre as suas turmas.
--
-- Continua a responder ao "desfasamento enorme entre as várias TP" das
-- coordenadoras: o que elas reportaram eram turmas a semanas de distância.
-- ---------------------------------------------------------------------------

insert into public.regras (
  id, nome, tipo, categoria, descricao, escopo, ano_curricular, config, peso, ativa
)
values (
  'h_motor_ritmo_tp',
  'Ritmo das turmas TP da mesma UC (máximo 2 semanas de atraso)',
  'hard',
  'Estudante',
  'As turmas TP da mesma unidade curricular não podem ficar a mais de duas semanas de atraso umas das outras: a n-ésima aula de uma turma e a n-ésima aula de outra têm de cair dentro da mesma quinzena. É o desfasamento máximo medido no horário de referência do coordenador, igual em todas as unidades curriculares. Ponha `unidade` a "blocos" para voltar a contar em número de aulas de avanço, com `maxDesvioBlocos`.',
  'transversal',
  'todos',
  '{"traducaoSimples":"As varias TP da mesma UC andam em fila: nenhuma pode ficar mais de duas semanas atras das outras.","motor":{"ritmoTP":{"ativo":true,"unidade":"semanas","maxDesvioSemanas":2,"maxDesvioBlocos":2,"ambito":"familia"}}}'::jsonb,
  9,
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

-- ---------------------------------------------------------------------------
-- 3. TP E PL DA MESMA UC NA MESMA MANCHA: deixa de ser proibido
--
-- A proibição vinha da suposição de que a TP e a PL da mesma unidade curricular
-- são dadas pela mesma docente. O horário de referência junta-as quatro vezes, e
-- o coordenador confirmou que são docentes diferentes.
--
-- A regra fica CONFIGURÁVEL e DESLIGADA por omissão. Quem tiver uma UC em que a
-- docente seja de facto a mesma pessoa liga-a pondo `ativo` a true nesta regra.
-- Não se apaga o mecanismo: apaga-se o veto universal.
-- ---------------------------------------------------------------------------

insert into public.regras (
  id, nome, tipo, categoria, descricao, escopo, ano_curricular, config, peso, ativa
)
values (
  'h_motor_tp_pl_mesma_mancha',
  'TP e PL da mesma UC podem partilhar a mancha',
  'hard',
  'Docente',
  'Deixa de ser proibido que a mesma unidade curricular tenha uma aula TP e uma aula PL na mesma mancha horária: no horário de referência do coordenador isso acontece e as aulas são dadas por docentes diferentes. Ponha `ativo` a true para voltar a proibir, nas escolas ou anos em que a docente da TP e a da PL sejam a mesma pessoa.',
  'transversal',
  'todos',
  '{"traducaoSimples":"A mesma UC pode ter uma TP e uma PL a mesma hora, porque sao docentes diferentes.","motor":{"tpPLmesmaUC":{"ativo":false}}}'::jsonb,
  5,
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

-- ---------------------------------------------------------------------------
-- 4. Verificação rápida (opcional; devolve o estado depois da migração)
-- ---------------------------------------------------------------------------
--
-- select id, ativa, config #> '{motor}' as motor
-- from public.regras
-- where id in (
--   'h_motor_sem_maratonas_uc',
--   'h_motor_ritmo_tp',
--   'h_motor_tp_pl_mesma_mancha'
-- )
-- order by id;
