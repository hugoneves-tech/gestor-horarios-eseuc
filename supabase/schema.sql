-- ===========================================================================
-- Gestor de Horários ESEUC — schema Supabase (PostgreSQL)
-- Corre isto no SQL Editor do Supabase (uma vez). É idempotente.
--
-- IDs são TEXT para preservar os identificadores existentes ("c1", "uc_mi", …).
-- Estruturas aninhadas (turmasConfig, disponibilidade, sessões…) ficam em JSONB.
-- ===========================================================================

-- --- Catálogo base -------------------------------------------------------

create table if not exists cursos (
  id            text primary key,
  nome          text not null,
  sigla         text,
  departamento  text,
  created_at    timestamptz default now()
);

create table if not exists anos_semestres (
  id                    text primary key,
  ano_letivo            text not null,
  semestre              int  not null,
  edicao                text,
  ativo                 boolean default false,
  data_inicio_semestre  date,
  semanas_personalizadas jsonb,
  data_inicio_ano1      date,
  data_inicio_ano2      date,
  data_inicio_ano3      date,
  data_inicio_ano4      date,
  created_at            timestamptz default now()
);

create table if not exists ucs (
  id                      text primary key,
  nome                    text not null,
  sigla                   text,
  curso_id                text references cursos(id) on delete set null,
  ano_curricular          int,
  carga_horaria_teorica   int default 0,
  carga_horaria_pratica   int default 0,   -- PL
  carga_horaria_tp        int default 0,
  carga_horaria_s         int default 0,   -- Seminários
  carga_horaria_e         int default 0,   -- Estágio / Ensino Clínico
  ects                    int,
  semestre                int,
  semana_inicio           int,
  semana_fim              int,
  num_semanas             int,
  data_inicio             date,
  data_fim                date,
  periodo                 text,
  observacoes             text,
  semanas_pl              jsonb,
  max_simultaneo_t        int,
  max_simultaneo_tp       int,
  max_simultaneo_pl       int,
  plano_distribuicao      jsonb,
  turmas_config           jsonb default '[]'::jsonb,
  created_at              timestamptz default now()
);

create table if not exists turmas (
  id              text primary key,
  nome            text not null,
  curso_id        text references cursos(id) on delete set null,
  alunos          int default 0,
  vagas           int default 0,
  tipo            text,
  ano_curricular  int,
  bloco           text,                    -- 'hospitalar' | 'comunitaria' (3.º ano)
  created_at      timestamptz default now()
);

create table if not exists docentes (
  id                    text primary key,
  nome                  text not null,
  email                 text,
  departamento          text,
  max_horas_semanais    int,
  unidades_curriculares text[] default '{}',
  disponibilidade       jsonb  default '{}'::jsonb,
  is_pos_graduacao      boolean default false,
  atribuicoes_ucs       jsonb  default '{}'::jsonb,
  created_at            timestamptz default now()
);

create table if not exists salas (
  id           text primary key,
  nome         text not null,
  tipo         text,
  capacidade   int,
  equipamento  text[] default '{}',
  tipologia    text,
  tipologias   text[] default '{}',
  created_at   timestamptz default now()
);

create table if not exists feriados (
  id           text primary key,
  nome         text not null,
  tipo         text,
  data_inicio  date not null,
  data_fim     date not null,
  created_at   timestamptz default now()
);

create table if not exists regras (
  id              text primary key,
  nome            text not null,
  tipo            text,                    -- 'hard' | 'soft'
  categoria       text,
  descricao       text,
  escopo          text,                    -- 'transversal' | 'ano'
  ano_curricular  text,                    -- número ou 'todos'
  config          jsonb default '{}'::jsonb,
  peso            int default 5,
  ativa           boolean default true,
  created_at      timestamptz default now()
);

-- --- Horários gerados ----------------------------------------------------

create table if not exists versoes (
  id               text primary key,
  nome             text not null,
  ano_semestre_id  text references anos_semestres(id) on delete cascade,
  criada_em        timestamptz default now(),
  criada_por       text,
  ativa            boolean default false,
  score            int default 0,
  sessoes          jsonb default '[]'::jsonb,  -- array de SessaoHorario
  created_at       timestamptz default now()
);

create table if not exists solver_runs (
  id                  text primary key,
  data_execucao       timestamptz default now(),
  versao_id           text references versoes(id) on delete cascade,
  status              text,
  duracao_ms          int,
  tentativas          int,
  score               int,
  conflitos_contidos  int,
  detalhes            jsonb default '{}'::jsonb,
  created_at          timestamptz default now()
);

create index if not exists idx_ucs_curso       on ucs(curso_id);
create index if not exists idx_versoes_anosem   on versoes(ano_semestre_id);
create index if not exists idx_solverruns_versao on solver_runs(versao_id);

-- ===========================================================================
-- RLS — POLÍTICA TEMPORÁRIA E PERMISSIVA
-- ---------------------------------------------------------------------------
-- ⚠️ Por agora liberta tudo (anon) para o protótipo funcionar sem login.
--    ISTO DEIXA A BASE DE DADOS ABERTA a quem tiver a URL + anon key.
--    ANTES de meter dados reais: ligar Supabase Auth e substituir estas
--    políticas por `to authenticated` (ver bloco comentado no fim).
-- ===========================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'cursos','anos_semestres','ucs','turmas','docentes','salas',
    'feriados','regras','versoes','solver_runs'
  ] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists "dev_all" on %I;', t);
    execute format(
      'create policy "dev_all" on %I for all to anon, authenticated using (true) with check (true);', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- QUANDO LIGARES A AUTENTICAÇÃO, troca a política acima por algo como:
--
--   drop policy if exists "dev_all" on ucs;
--   create policy "auth_read"  on ucs for select to authenticated using (true);
--   create policy "auth_write" on ucs for all    to authenticated using (true) with check (true);
--   -- (repetir por tabela; mais tarde restringir por escola/papel)
-- ---------------------------------------------------------------------------
