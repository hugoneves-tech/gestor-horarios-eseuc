-- ===========================================================================
-- REGRA GERAL DE COMPOSIÇÃO DE BLOCOS
--
-- Decisões do coordenador (02/08/2026), a partir dos emails das coordenadoras e
-- da tabela de precedências da FT. Ver `ESPEC_REGRA_GERAL_BLOCOS.md`.
--
-- A validade de um bloco DEIXA de ser "corresponde a um padrão da lista" e passa
-- a ser uma REGRA GERAL:
--
--   1. cobre exatamente as 12 folhas-aluno de uma turma teórica;
--   2. no máximo 2 TP da mesma UC por bloco (bloco INTEIRO: as duas turmas
--      teóricas e os outros anos curriculares);
--   3. no máximo 3 PL da mesma UC, mesmo âmbito;
--   4. nunca TP e PL da mesma UC no mesmo bloco;
--   5. mais todas as restantes restrições já existentes.
--
-- As FORMAS de bloco passam a ser uma CONSEQUÊNCIA destes limites, não uma
-- enumeração. Por aritmética desaparecem `4 TP da mesma UC`, `2TP+6PL` e
-- `3TP+3PL`; e passam a existir `2TP+1TP+1TP`, `1TP+1TP+1TP+1TP`, `2TP+1TP+3PL`
-- e todas as outras que fechem as 12 folhas dentro dos limites.
--
-- IDEMPOTENTE: pode ser corrida as vezes que forem precisas.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. LIMITES UNIVERSAIS DE COMPOSIÇÃO
--
-- É a mudança central. `maxTPporUCporMancha` estava em 4 — o valor que
-- autorizava o bloco de quatro TP da mesma UC. Passa a 2, e junta-se-lhe
-- `maxPLporUCporMancha` = 3. Valem para TODAS as UCs, como supletivo de toda a
-- escola: uma UC pode declarar um valor MAIS BAIXO (no catálogo `ucs`, colunas
-- `max_simultaneo_tp`/`max_simultaneo_pl`), nunca mais alto — o motor fica
-- sempre com o mínimo.
--
-- A razão não é preferência: dois é o que duas docentes conseguem dar em
-- simultâneo, e três PL é um desdobramento completo de práticas.
-- ---------------------------------------------------------------------------

insert into public.regras (
  id, nome, tipo, categoria, descricao, escopo, ano_curricular, config, peso, ativa
)
values (
  'h_motor_limites_universais_uc',
  'Limites universais por UC num bloco (2 TP, 3 PL)',
  'hard',
  'Docente',
  'Em cada bloco, e contando o bloco inteiro (Turma A + Turma B + outros anos curriculares), nenhuma unidade curricular pode ter mais do que 2 aulas TP nem mais do que 3 aulas PL em simultâneo. Uma UC pode declarar um limite mais baixo; nunca mais alto.',
  'transversal',
  'todos',
  '{"traducaoSimples":"Duas TP e tres PL da mesma UC ao mesmo tempo, no maximo. E o que a equipa de docentes e os laboratorios conseguem dar.","motor":{"limitesUniversaisPorUC":{"maxTPporUCporMancha":2,"maxPLporUCporMancha":3,"ambitoContagem":"bloco"}}}'::jsonb,
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

-- A regra antiga de capacidade de TP autorizava 4 TP da mesma UC por mancha.
-- Fica desativada: quem manda agora é `h_motor_limites_universais_uc`. Não se
-- apaga, para que o histórico da decisão continue legível no Supabase.
update public.regras
set
  ativa = false,
  descricao =
    'SUBSTITUÍDA por h_motor_limites_universais_uc. Autorizava 4 TP da mesma UC por mancha, o que permitia o bloco de quatro TP seguidas da mesma unidade curricular. O limite passou a 2.'
where id = 'h_motor_capacidade_tp';

-- ---------------------------------------------------------------------------
-- 2. A LISTA DE PADRÕES DEIXA DE SER VETO
--
-- `padroesAtivos` e `custosPadroes` continuam a ser lidos, mas passaram a valer
-- SÓ COMO PREFERÊNCIA: os custos ancoram a hierarquia entre formas e a marca
-- `ativo` já não impede nenhum bloco. Quem PROÍBE são os limites do ponto 1.
--
-- Os padrões que os limites tornaram impossíveis (TP4_MESMA_UC, TP2_PL6_DUAS_UCS
-- e TP3_PL3) são retirados da lista de ativos para que ninguém os leia como
-- ainda disponíveis; se lá ficassem, o motor ignorava-os na mesma.
-- ---------------------------------------------------------------------------

update public.regras
set
  descricao =
    'Hierarquia de PREFERÊNCIA entre formas de bloco a 100%. Já não é um veto: a validade de um bloco vem da regra geral (cobrir as 12 folhas-aluno e caber nos limites de 2 TP e 3 PL da mesma UC). Os custos aqui declarados só ordenam as tentativas.',
  config = jsonb_set(
    jsonb_set(
      jsonb_set(
        coalesce(config, '{}'::jsonb),
        '{motor,blocos100,padroesAtivos}',
        '["T1","TP2_PL3_PL3","TP2_DUAS_UCS"]'::jsonb,
        true
      ),
      '{motor,blocos100,padraoAEvitar}',
      'null'::jsonb,
      true
    ),
    '{traducaoSimples}',
    to_jsonb('A lista de padroes passou a ser so preferencia. O que e legal sai dos limites: 12 folhas-aluno cobertas, no maximo 2 TP e 3 PL da mesma UC.'::text),
    true
  )
where id = 'h_blocos_ocupacao_100';

-- `padraoUltimoRecurso` apontava para TP3_PL3, uma composição que os limites
-- tornaram impossível. Deixa de existir último recurso: não há forma nenhuma
-- que só seja usada por falta de alternativa.
update public.regras
set config = config #- '{motor,blocos100,padraoUltimoRecurso}'
where id = 'h_blocos_ocupacao_100'
  and config #> '{motor,blocos100,padraoUltimoRecurso}' is not null;

-- ---------------------------------------------------------------------------
-- 3. RITMO DAS TURMAS TP
--
-- Resposta ao "desfasamento enorme entre as várias TP" de que ambas as
-- coordenadoras se queixam: as turmas TP da mesma UC não podem divergir mais do
-- que 1 bloco entre si, em qualquer momento da ordem de calendário.
--
-- `ambito` = "familia": comparam-se as turmas TP dentro da mesma turma teórica.
-- É o desfasamento que o estudante e o docente sentem, e o único comparável
-- quando há semanas em que só uma família tem aulas. Pôr "uc" compara todas as
-- turmas TP da unidade curricular, atravessando as duas famílias.
-- ---------------------------------------------------------------------------

insert into public.regras (
  id, nome, tipo, categoria, descricao, escopo, ano_curricular, config, peso, ativa
)
values (
  'h_motor_ritmo_tp',
  'Ritmo das turmas TP da mesma UC',
  'hard',
  'Estudante',
  'As turmas TP da mesma unidade curricular não podem divergir mais do que um bloco entre si, em nenhum momento do semestre. Nenhuma turma avança duas aulas enquanto outra ainda não teve a primeira.',
  'transversal',
  'todos',
  '{"traducaoSimples":"As varias TP da mesma UC andam em fila, nunca em bicha: no maximo um bloco de diferenca entre elas.","motor":{"ritmoTP":{"ativo":true,"maxDesvioBlocos":1,"ambito":"familia"}}}'::jsonb,
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
-- 4. SEM MARATONAS DA MESMA UC
--
-- Os emails reportam 6h seguidas de PsiS na TP4 e 6h seguidas de EIG na TP1 a
-- 19/10, mais 2h à tarde no mesmo dia. Nenhum grupo de estudantes pode ter mais
-- do que 2 blocos seguidos (4h) da mesma unidade curricular no mesmo dia.
-- ---------------------------------------------------------------------------

insert into public.regras (
  id, nome, tipo, categoria, descricao, escopo, ano_curricular, config, peso, ativa
)
values (
  'h_motor_sem_maratonas_uc',
  'Sem maratonas: máximo de 2 blocos seguidos da mesma UC',
  'hard',
  'Estudante',
  'Nenhum grupo de estudantes pode ter mais do que dois blocos seguidos (4h) da mesma unidade curricular no mesmo dia.',
  'transversal',
  'todos',
  '{"traducaoSimples":"No maximo 4h seguidas da mesma UC no mesmo dia. Acima disso deixa de ser aula.","motor":{"maratonaUC":{"ativo":true,"maxBlocosSeguidosMesmaUC":2}}}'::jsonb,
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
-- 5. PRECEDÊNCIA ESCALONADA (tabela da FT)
--
-- Tabela explícita enviada pela coordenação da FT:
--
--   | Antes de              | é preciso ter        |
--   |-----------------------|----------------------|
--   | 1.ª e 2.ª PL          | 1.ª T e 1.ª TP       |
--   | 3.ª e 4.ª PL          | 2.ª T e 2.ª TP       |
--   | 5.ª e 6.ª PL          | 3.ª T e 3.ª TP       |
--   | 7.ª PL                | 4.ª T e 4.ª TP       |
--   | 8.ª, 9.ª e 10.ª PL    | 5.ª TP               |
--
-- O mecanismo é GENÉRICO: `escaloes` é uma tabela por UC que diz, para a
-- n-ésima PL de um desdobramento, quantas T e quantas TP têm de estar dadas
-- antes. Onde existir tabela, é ela que manda e o rácio proporcional
-- (`racioTPPL`) deixa de se aplicar a essa UC; sem tabela, o rácio fica como
-- default. Para acrescentar outra UC, junte-se outro objeto à lista.
-- ---------------------------------------------------------------------------

insert into public.regras (
  id, nome, tipo, categoria, descricao, escopo, ano_curricular, config, peso, ativa
)
values (
  'h_motor_precedencias_escalonadas_pl',
  'Precedência escalonada das PL (tabela por UC)',
  'hard',
  'Estudante',
  'Para cada UC com tabela declarada, a n-ésima aula PL de um desdobramento só pode ocorrer depois de estarem dadas as aulas T e TP que a tabela exige. Substitui o rácio proporcional nas UCs que a declaram.',
  'transversal',
  'todos',
  '{"traducaoSimples":"Antes da 1a e da 2a PL, a 1a T e a 1a TP. Antes da 3a e da 4a, a 2a T e a 2a TP. E assim por diante, pela tabela da coordenacao.","motor":{"precedenciasEscalonadasPL":[{"siglas":["FT"],"escaloes":[{"ateNesimaPL":2,"minimoT":1,"minimoTP":1},{"ateNesimaPL":4,"minimoT":2,"minimoTP":2},{"ateNesimaPL":6,"minimoT":3,"minimoTP":3},{"ateNesimaPL":7,"minimoT":4,"minimoTP":4},{"ateNesimaPL":10,"minimoT":0,"minimoTP":5}]}]}}'::jsonb,
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
-- 6. Verificação rápida (opcional; devolve o estado depois da migração)
-- ---------------------------------------------------------------------------
--
-- select id, ativa, config #> '{motor}' as motor
-- from public.regras
-- where id in (
--   'h_motor_limites_universais_uc',
--   'h_motor_capacidade_tp',
--   'h_blocos_ocupacao_100',
--   'h_motor_ritmo_tp',
--   'h_motor_sem_maratonas_uc',
--   'h_motor_precedencias_escalonadas_pl'
-- )
-- order by id;
