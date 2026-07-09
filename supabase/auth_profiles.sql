-- ===========================================================================
-- Perfis + Convites (acesso institucional ESEUC)
--   • Cada utilizador autenticado tem um perfil (papel da app + flag admin).
--   • Só admins gerem convites; o registo livre é bloqueado (ver nota no fim).
--   • As linhas de `profiles` são escritas pelo SERVIDOR (service role) ao criar
--     um utilizador convidado — o cliente nunca insere perfis.
-- Corre isto uma vez no SQL Editor.
-- ===========================================================================

create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  papel       text default 'coordenador_1',   -- perfil da app (diretor_1, coordenador_2, …)
  is_admin    boolean default false,
  created_at  timestamptz default now()
);

create table if not exists convites (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  papel       text not null default 'coordenador_1',
  criado_por  uuid references auth.users(id),
  usado       boolean default false,
  created_at  timestamptz default now()
);

-- Helper SECURITY DEFINER: evita recursão de RLS ao verificar admin/membro.
create or replace function public.is_admin(uid uuid)
returns boolean language sql security definer stable
set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = uid), false);
$$;

create or replace function public.is_member(uid uuid)
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (select 1 from public.profiles where id = uid);
$$;

-- --- RLS de profiles / convites -----------------------------------------
alter table profiles enable row level security;
alter table convites enable row level security;

drop policy if exists "profiles_read" on profiles;
create policy "profiles_read" on profiles for select to authenticated
  using (id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists "convites_admin" on convites;
create policy "convites_admin" on convites for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ===========================================================================
-- Fechar o RLS das tabelas de dados: passa a exigir um PERFIL (utilizador
-- convidado), não apenas estar autenticado. Substitui o rls_auth.sql.
-- ===========================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'cursos','anos_semestres','ucs','turmas','docentes','salas',
    'feriados','regras','versoes','solver_runs'
  ] loop
    execute format('drop policy if exists "dev_all" on %I;', t);
    execute format('drop policy if exists "auth_all" on %I;', t);
    execute format('drop policy if exists "membros" on %I;', t);
    execute format(
      'create policy "membros" on %I for all to authenticated using (public.is_member(auth.uid())) with check (public.is_member(auth.uid()));', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- BOOTSTRAP DO ADMIN (hugoneves@ese.uc.pt)
-- 1) Cria o utilizador no Dashboard: Authentication → Users → Add user
--    (email hugoneves@ese.uc.pt, define password, marca "Auto Confirm User").
-- 2) Corre o comando abaixo para o tornar administrador:
--
--    insert into public.profiles (id, email, papel, is_admin)
--    select id, email, 'diretor_1', true from auth.users where email = 'hugoneves@ese.uc.pt'
--    on conflict (id) do update set is_admin = true, papel = 'diretor_1';
--
-- ---------------------------------------------------------------------------
-- NOTA: para bloquear mesmo o registo livre, desliga em
--   Authentication → Sign In / Providers → "Allow new users to sign up".
--   A criação de contas convidadas passa a ser feita pelo servidor (service role).
-- ---------------------------------------------------------------------------
