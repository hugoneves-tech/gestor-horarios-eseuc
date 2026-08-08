-- ============================================================================
-- MIGRAÇÃO: contrato de regras do motor v2 (Fase 2 da reescrita)
--
-- Objetivo: levar para a tabela `regras` tudo o que hoje está escrito no
-- código-fonte e que, por isso, o utilizador não consegue alterar. Cada bloco
-- indica qual a decisão do inventário que está a migrar.
--
-- Propriedades:
--   * IDEMPOTENTE — pode correr as vezes que forem precisas. Os `insert` usam
--     `on conflict (id) do update`; os `update` fundem JSON com `||`, pelo que
--     não destroem chaves irmãs já existentes.
--   * ADITIVA — nenhuma regra é apagada nem desativada.
--   * SEM SIGLAS DE UC — a associação a unidades curriculares concretas é
--     DADO (colunas da tabela `ucs` ou listas `siglas` já gravadas noutras
--     regras), nunca um literal desta migração.
--
-- O carregador `src/regras/carregar.ts` reconhece as regras pelo CONTEÚDO de
-- `config.motor`, não pelo `id`. Os ids abaixo são escolhidos por legibilidade.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. JANELA DAS AULAS TEÓRICAS  (a correção mais importante desta migração)
--
-- Inventário do distribuidor, itens #22/#23 e contradição #2:
--   `ordemDias` para as T era uma ORDEM DE TENTATIVA, não um filtro. Quando os
--   dias preferidos estavam cheios, a aula T caía em terça ou quinta-feira.
--   Nenhum ponto do motor nem do validador exprimia a regra real.
--
-- A regra institucional (regra `h_eseuc_auditorio`, até agora só em prosa):
--   2.ª e 4.ª feira o dia inteiro; 6.ª feira só de manhã; nunca 3.ª, 5.ª, nem
--   6.ª à tarde. `modo: "veto"` = fora desta janela é PROIBIDO.
--
-- Exceções pontuais continuam a fazer-se por `layoutFixo`, no Supabase.
-- ----------------------------------------------------------------------------

update public.regras
set
  descricao = 'Aulas T apenas às segundas e quartas-feiras (todo o dia) e às sextas-feiras de manhã. Nunca às terças, quintas, nem à sexta à tarde.',
  config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
    'traducaoSimples',
    'As aulas teóricas só podem ser marcadas à segunda e à quarta (manhã ou tarde) e à sexta de manhã. Terça, quinta e sexta à tarde ficam proibidas.'
  ) || jsonb_build_object(
    'motor',
    coalesce(config -> 'motor', '{}'::jsonb) || '{
      "janelasPorTipoAula": [
        {
          "tipo": "T",
          "modo": "veto",
          "ordemPreferenciaDias": ["Segunda", "Quarta", "Sexta"],
          "janelas": [
            { "dia": "Segunda", "periodos": ["manha", "tarde"], "horas": [] },
            { "dia": "Quarta",  "periodos": ["manha", "tarde"], "horas": [] },
            { "dia": "Sexta",   "periodos": ["manha"],          "horas": [] }
          ]
        }
      ]
    }'::jsonb
  )
where id = 'h_eseuc_auditorio';


-- ----------------------------------------------------------------------------
-- 2. JANELAS DOS RESTANTES TIPOS DE AULA
--
-- Inventário do distribuidor, itens #24/#25/#26: existiam ordens de tentativa
-- por tipo (TP, PL, S) escritas no código. São PREFERÊNCIAS, não vetos — daí
-- `modo: "preferencia"`, que mantém todos os dias permitidos mas ordena a
-- procura. A distinção veto/preferência passa a ser explícita e editável.
-- ----------------------------------------------------------------------------

insert into public.regras (id, nome, tipo, categoria, descricao, escopo, ano_curricular, config, peso, ativa)
values (
  'h_motor_janelas_tp_pl_s',
  'Ordem preferida de dias para TP, PL e Seminário',
  'soft',
  'Calendário',
  'Ordem pela qual o motor tenta os dias da semana para as aulas TP, PL e S. É uma preferência: nenhum dia útil fica proibido.',
  'transversal',
  'todos',
  '{
    "traducaoSimples": "As TP, PL e seminários podem decorrer em qualquer dia útil; esta regra apenas define por que ordem o motor os experimenta.",
    "motor": {
      "janelasPorTipoAula": [
        {
          "tipo": "TP",
          "modo": "preferencia",
          "ordemPreferenciaDias": ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"],
          "janelas": [
            { "dia": "Segunda", "periodos": [], "horas": [] },
            { "dia": "Terça",   "periodos": [], "horas": [] },
            { "dia": "Quarta",  "periodos": [], "horas": [] },
            { "dia": "Quinta",  "periodos": [], "horas": [] },
            { "dia": "Sexta",   "periodos": [], "horas": [] }
          ]
        },
        {
          "tipo": "PL",
          "modo": "preferencia",
          "ordemPreferenciaDias": ["Terça", "Quinta", "Segunda", "Quarta", "Sexta"],
          "janelas": [
            { "dia": "Segunda", "periodos": [], "horas": [] },
            { "dia": "Terça",   "periodos": [], "horas": [] },
            { "dia": "Quarta",  "periodos": [], "horas": [] },
            { "dia": "Quinta",  "periodos": [], "horas": [] },
            { "dia": "Sexta",   "periodos": [], "horas": [] }
          ]
        },
        {
          "tipo": "S",
          "modo": "preferencia",
          "ordemPreferenciaDias": ["Quinta", "Terça", "Segunda", "Quarta", "Sexta"],
          "janelas": [
            { "dia": "Segunda", "periodos": [], "horas": [] },
            { "dia": "Terça",   "periodos": [], "horas": [] },
            { "dia": "Quarta",  "periodos": [], "horas": [] },
            { "dia": "Quinta",  "periodos": [], "horas": [] },
            { "dia": "Sexta",   "periodos": [], "horas": [] }
          ]
        }
      ]
    }
  }'::jsonb,
  6,
  true
)
on conflict (id) do update set
  nome = excluded.nome,
  tipo = excluded.tipo,
  categoria = excluded.categoria,
  descricao = excluded.descricao,
  escopo = excluded.escopo,
  ano_curricular = excluded.ano_curricular,
  config = coalesce(regras.config, '{}'::jsonb) || excluded.config,
  peso = excluded.peso;


-- ----------------------------------------------------------------------------
-- 3. GRELHA HORÁRIA
--
-- Inventário do distribuidor, itens #1, #16, #36, #82 e inventário de blocos,
-- itens #5, #6, #73: os dias úteis, as seis horas de início, o bloco de 2h, o
-- limiar manhã/tarde às 14:00 e a proteção do almoço (12:00 <-> 14:00) estavam
-- todos escritos no código, em vários sítios independentes.
-- ----------------------------------------------------------------------------

update public.regras
set config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
  'motor',
  coalesce(config -> 'motor', '{}'::jsonb) || '{
    "grelhaHoraria": {
      "dias": ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"],
      "horaAbertura": "08:00",
      "horaFecho": "20:00",
      "duracaoBlocoHoras": 2,
      "horasInicio": ["08:00", "10:00", "12:00", "14:00", "16:00", "18:00"],
      "limiarTardeHora": 14,
      "pausaAlmoco": { "horaAntes": "12:00", "horaDepois": "14:00" }
    }
  }'::jsonb
)
where id = 'h_eseuc_horario_08_20';


-- ----------------------------------------------------------------------------
-- 4. ESTRUTURA DE TURMAS
--
-- Inventário do distribuidor, itens #33, #34, #35, #42, #43, #44, #124, #144 e
-- inventário de blocos, itens #7, #8: a hierarquia de turmas estava repetida em
-- pelo menos seis sítios do distribuidor e reimplementada de forma
-- independente em `blocos100.ts` e em `validacao.ts`.
--
-- Passa a ser declarada uma única vez: 2 turmas teóricas, cada uma com 4 TP,
-- cada TP com 3 PL, e 2 meio-cohorts por família (usados para emparelhar TP
-- com PL dentro do mesmo bloco).
-- ----------------------------------------------------------------------------

update public.regras
set config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
  'motor',
  coalesce(config -> 'motor', '{}'::jsonb) || '{
    "estruturaTurmas": {
      "turmasTeoricas": 2,
      "nomesTurmasTeoricas": ["Turma A", "Turma B"],
      "tpPorTurmaTeorica": 4,
      "plPorTP": 3,
      "meioCohortsPorFamilia": 2,
      "prefixos": { "teorica": "T", "tp": "TP", "pl": "PL" }
    }
  }'::jsonb
)
where id = 'h_eseuc_estrutura_360';


-- ----------------------------------------------------------------------------
-- 5. TURNOS POR FAMÍLIA (manhã/tarde)
--
-- Inventário do distribuidor, itens #39, #53, #63 e inventário de blocos,
-- item #70 e sobreposição #6: a preferência de turno vivia parcialmente no
-- código (`semestre === 1`) e parcialmente no `localStorage` do browser — ou
-- seja, fora da base de dados e divergente entre computadores.
--
-- A regra `h_eseuc_turnos_por_bloco` já descrevia isto em prosa, incluindo a
-- exceção das primeiras 8 semanas do 2.º semestre. Passa a ser legível pelo
-- motor.
-- ----------------------------------------------------------------------------

update public.regras
set config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
  'motor',
  coalesce(config -> 'motor', '{}'::jsonb) || '{
    "turnos": {
      "familiaDeManhaPorSemestre": { "1": "A", "2": "B" },
      "excecoes": [
        {
          "semestre": 2,
          "semanaInicio": 16,
          "semanaFim": 23,
          "familiaDeManha": "A"
        }
      ]
    }
  }'::jsonb
)
where id = 'h_eseuc_turnos_por_bloco';


-- ----------------------------------------------------------------------------
-- 6. HIERARQUIA DE CUSTOS DOS PADRÕES DE BLOCO A 100%
--
-- Inventário de blocos, itens #1, #12 a #16 e #18: os padrões existiam como
-- union type no código e o único custo configurável era o binário
-- "padrão a evitar = 1001, restantes = 1". A ordem de preferência entre os
-- outros cinco padrões não existia em lado nenhum.
--
-- Hierarquia decidida pelo coordenador (menor custo = mais preferido):
--   T1 < TP2_PL3_PL3 (preferido) < TP2_DUAS_UCS < TP4_MESMA_UC
--     < TP2_PL6_DUAS_UCS << TP3_PL3 (último recurso)
--
-- TP3_PL3 tem custo muito alto MAS continua ativo: é custo, nunca veto, para
-- nunca impedir a cobertura a 100%. O motor contabiliza-o no relatório final.
-- ----------------------------------------------------------------------------

update public.regras
set config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
  'motor',
  coalesce(config -> 'motor', '{}'::jsonb) || jsonb_build_object(
    'blocos100',
    coalesce(config -> 'motor' -> 'blocos100', '{}'::jsonb) || '{
    "custosPadroes": {
      "T1": 0,
      "TP2_PL3_PL3": 10,
      "TP2_DUAS_UCS": 20,
      "TP4_MESMA_UC": 30,
      "TP2_PL6_DUAS_UCS": 40,
      "TP3_PL3": 1000
    },
    "padraoUltimoRecurso": "TP3_PL3"
  }'::jsonb
  )
)
where id = 'h_blocos_ocupacao_100';


-- ----------------------------------------------------------------------------
-- 7. CAPACIDADE DE TP POR MANCHA
--
-- Inventário do distribuidor, itens #51, #75, #96 e #111: `MAX_TP_POR_UC_MANCHA`
-- caía num literal `4` quando a opção não vinha definida, e o limite global de
-- TP por mancha era `null` com um comentário "sem limite nesta fase".
--
-- `ambitoContagem: "bloco"` fixa a decisão do coordenador: os máximos contam o
-- BLOCO INTEIRO (Turma A + Turma B + outros anos), não por turma.
-- ----------------------------------------------------------------------------

insert into public.regras (id, nome, tipo, categoria, descricao, escopo, ano_curricular, config, peso, ativa)
values (
  'h_motor_capacidade_tp',
  'Capacidade de TP em simultâneo por mancha',
  'hard',
  'Sala',
  'Número máximo de sessões TP em simultâneo numa mancha horária, no total e por unidade curricular. Os máximos contam o bloco inteiro, somando todas as turmas e anos curriculares.',
  'transversal',
  'todos',
  '{
    "traducaoSimples": "Numa mesma mancha não podem decorrer mais de 4 TP da mesma unidade curricular. Não existe limite global de TP: o que limita é o número de salas comuns disponíveis.",
    "motor": {
      "capacidadeTP": {
        "maxTPporMancha": null,
        "maxTPporUCporMancha": 4,
        "ambitoContagem": "bloco"
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
  config = coalesce(regras.config, '{}'::jsonb) || excluded.config,
  peso = excluded.peso;


-- ----------------------------------------------------------------------------
-- 8. CRONOLOGIA PEDAGÓGICA GERAL T -> TP -> PL
--
-- Inventário do distribuidor, itens #129 e #130 e contradição #6, e inventário
-- de blocos, item #54 e duplicação G: a cronologia geral era aplicada sempre,
-- em código, e de duas formas incompatíveis (um filtro duro configurável só
-- para T->TP, e uma penalização de custo genérica sempre ligada). O gate
-- TP->PL nunca consultava as precedências configuráveis.
--
-- Passa a ser uma precedência normal, com `siglas` vazio = todas as UCs. As
-- precedências específicas de UC que já existem na base de dados continuam a
-- valer e, sendo mais exigentes, sobrepõem-se a esta.
-- ----------------------------------------------------------------------------

update public.regras
set config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
  'motor',
  coalesce(config -> 'motor', '{}'::jsonb) || '{
    "precedenciasUC": [
      {
        "siglas": [],
        "tipoAntes": "T",
        "tipoDepois": "TP",
        "minimoAntes": 1,
        "unidade": "blocos",
        "contagem": "porTurma"
      },
      {
        "siglas": [],
        "tipoAntes": "TP",
        "tipoDepois": "PL",
        "minimoAntes": 1,
        "unidade": "blocos",
        "contagem": "porTurma"
      }
    ]
  }'::jsonb
)
where id = 'h_eseuc_ordem_t_tp_pl';


-- ----------------------------------------------------------------------------
-- 9. CALENDÁRIO: FRONTEIRA DE SEMESTRE E SEMANAS DE PAUSA
--
-- Inventário do distribuidor, itens #2, #3 e #17, e inventário de blocos,
-- "conhecimento de domínio embutido": a fronteira semanas 1-15 / 16-30 estava
-- escrita dezenas de vezes nos dois ficheiros, e o número de semanas por
-- semestre caía num literal `15`.
--
-- `pausasNaoContamNaNumeracao: true` fixa a decisão do coordenador: as pausas
-- letivas (Páscoa, Queima) são "semana zero" e não avançam a numeração
-- pedagógica das unidades curriculares.
-- ----------------------------------------------------------------------------

update public.regras
set config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
  'motor',
  coalesce(config -> 'motor', '{}'::jsonb) || '{
    "calendario": {
      "fronteiraSemestre": 15,
      "semanasPorSemestre": 15,
      "pausasNaoContamNaNumeracao": true
    }
  }'::jsonb
)
where id = 'h_calendario_2ano_2026_2027';


-- ----------------------------------------------------------------------------
-- 10. LAYOUT FIXO: ÂMBITO DE SEMESTRE EXPLÍCITO
--
-- Inventário de blocos/App, item #96: o layout fixo só era aplicado quando
-- `semestreAlvo === 1` e `layoutFixo.ano === 2`, ambos literais no código. O
-- `ano` já vinha da regra; o `semestre` não existia. Fica explícito, para que
-- um layout de 2.º semestre passe a ser possível sem tocar no código.
-- ----------------------------------------------------------------------------

update public.regras
set config = jsonb_set(
  coalesce(config, '{}'::jsonb),
  '{motor,layoutFixo,semestre}',
  to_jsonb(1),
  true
)
where id = 'h_2ano_semana_1_sem_pl'
  and config -> 'motor' -> 'layoutFixo' is not null;


-- ----------------------------------------------------------------------------
-- 11. CARGA DIÁRIA: DIAS PARCIAIS
--
-- Inventário de blocos, itens #44 e #46 e sobreposição #3: `evitarDiasParciais`
-- existia como campo mas nunca era gravado, e `maxDiasNoMaximoPorSemana` era
-- forçado a 5 em código por cima do que estivesse configurado.
--
-- A regra transversal declara agora os três campos. A regra de ano curricular
-- que já existe continua a sobrepor-se, e o carregador reporta essa
-- sobreposição em vez de a aplicar em silêncio.
-- ----------------------------------------------------------------------------

update public.regras
set config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
  'motor',
  coalesce(config -> 'motor', '{}'::jsonb) || jsonb_build_object(
    'cargaDiariaEstudante',
    coalesce(config -> 'motor' -> 'cargaDiariaEstudante', '{}'::jsonb) || '{
    "evitarDiasParciais": true
  }'::jsonb
  )
)
where id = 'h_carga_diaria_estudantes';


-- ----------------------------------------------------------------------------
-- 12. COBERTURA TOTAL DA CARGA DAS UCs
--
-- Inventário de blocos, item #3: `exigirCoberturaTotal` só existia como default
-- do código. A regra que exprime a exigência já existia em prosa.
-- ----------------------------------------------------------------------------

update public.regras
set config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
  'motor',
  coalesce(config -> 'motor', '{}'::jsonb) || '{ "exigirCoberturaTotal": true }'::jsonb
)
where id = 'h_transversal_carga_total_uc';


-- ----------------------------------------------------------------------------
-- NÃO MIGRADO NESTA FASE (deliberadamente)
--
--  a) `poolsSala` — conjuntos de salas com capacidade própria (laboratórios de
--     simulação vs. salas de informática). O esquema já os suporta, mas a
--     associação "que unidade curricular usa que conjunto de salas" é um
--     atributo da UC, não uma lista de siglas dentro de uma regra. Migrar isto
--     exige acrescentar uma coluna à tabela `ucs` e fica para a fase seguinte.
--     Até lá vale o máximo global de PL por mancha, que é o limite operacional
--     efetivo da escola.
--
--  b) `conflitosUC` — pares de unidades curriculares que não podem partilhar a
--     mesma mancha por partilharem docente. A informação certa é a atribuição
--     de docentes, já existente no projeto; derivá-la daí é mais fiável do que
--     manter uma lista de pares à mão.
--
--  c) Casos de calendário concretos que estavam em código com ano e semana
--     literais (reserva de quarta-feira na semana 16 do 2.º semestre; fecho do
--     1.º semestre com a sexta-feira da semana 15 livre). São layouts de um ano
--     letivo específico: pertencem a `layoutFixo` ou a `restricoesUC`, criados
--     pelo coordenador na interface, e não a uma migração genérica.
-- ============================================================================
