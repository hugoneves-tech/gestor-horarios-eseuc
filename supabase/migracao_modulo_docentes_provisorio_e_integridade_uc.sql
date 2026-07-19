-- MÓDULO PROVISÓRIO / APENAS PARA TESTES
-- Distribuição do serviço docente por UC, tipologia, turma e número ordinal da aula.

create table if not exists public.cargas_docentes_provisorias (
  id text primary key,
  docente_id text not null references public.docentes(id) on delete cascade,
  uc_id text not null references public.ucs(id) on delete cascade,
  ano_semestre_id text not null references public.anos_semestres(id) on delete cascade,
  tipologia text not null check (tipologia in ('T','TP','PL','S')),
  numero_turmas integer not null check (numero_turmas > 0),
  horas_por_turma integer not null check (horas_por_turma > 0 and mod(horas_por_turma, 2) = 0),
  modo_turmas text not null default 'automatico' check (modo_turmas in ('automatico','manual','misto')),
  turmas_selecionadas jsonb not null default '[]'::jsonb,
  provisoria boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.atribuicoes_aulas_docente_provisorias (
  id text primary key,
  carga_id text not null references public.cargas_docentes_provisorias(id) on delete cascade,
  docente_id text not null references public.docentes(id) on delete cascade,
  uc_id text not null references public.ucs(id) on delete cascade,
  ano_semestre_id text not null references public.anos_semestres(id) on delete cascade,
  tipologia text not null check (tipologia in ('T','TP','PL','S')),
  turma text not null,
  numero_aula integer not null check (numero_aula > 0),
  origem text not null default 'automatica' check (origem in ('automatica','manual')),
  bloqueada boolean not null default false,
  created_at timestamptz not null default now(),
  unique (ano_semestre_id, uc_id, tipologia, turma, numero_aula)
);

create index if not exists cargas_docentes_provisorias_docente_idx
  on public.cargas_docentes_provisorias (docente_id, ano_semestre_id);
create index if not exists cargas_docentes_provisorias_uc_idx
  on public.cargas_docentes_provisorias (uc_id);
create index if not exists cargas_docentes_provisorias_ano_semestre_idx
  on public.cargas_docentes_provisorias (ano_semestre_id);
create index if not exists atribuicoes_aulas_docente_provisorias_carga_idx
  on public.atribuicoes_aulas_docente_provisorias (carga_id);
create index if not exists atribuicoes_aulas_docente_provisorias_docente_idx
  on public.atribuicoes_aulas_docente_provisorias (docente_id);
create index if not exists atribuicoes_aulas_docente_provisorias_uc_idx
  on public.atribuicoes_aulas_docente_provisorias (uc_id);

alter table public.cargas_docentes_provisorias enable row level security;
alter table public.atribuicoes_aulas_docente_provisorias enable row level security;
drop policy if exists "membros" on public.cargas_docentes_provisorias;
drop policy if exists "membros" on public.atribuicoes_aulas_docente_provisorias;
create policy "membros" on public.cargas_docentes_provisorias
  for all to authenticated using ((select public.is_member((select auth.uid()))))
  with check ((select public.is_member((select auth.uid()))));
create policy "membros" on public.atribuicoes_aulas_docente_provisorias
  for all to authenticated using ((select public.is_member((select auth.uid()))))
  with check ((select public.is_member((select auth.uid()))));

-- Mantém horários JSONB e dados docentes coerentes mesmo quando a UC é alterada
-- diretamente no Supabase, fora da aplicação.
create or replace function public.sincronizar_dependencias_uc()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sigla_antiga text := old.sigla;
  mudanca_pedagogica boolean := false;
begin
  if tg_op = 'UPDATE' then
    mudanca_pedagogica :=
      old.ano_curricular is distinct from new.ano_curricular or
      old.semestre is distinct from new.semestre or
      old.carga_horaria_teorica is distinct from new.carga_horaria_teorica or
      old.carga_horaria_pratica is distinct from new.carga_horaria_pratica or
      old.carga_horaria_tp is distinct from new.carga_horaria_tp or
      old.carga_horaria_s is distinct from new.carga_horaria_s or
      old.semana_inicio is distinct from new.semana_inicio or
      old.semana_fim is distinct from new.semana_fim or
      old.num_semanas is distinct from new.num_semanas or
      old.data_inicio is distinct from new.data_inicio or
      old.data_fim is distinct from new.data_fim or
      old.semanas_pl is distinct from new.semanas_pl or
      old.turmas_config is distinct from new.turmas_config or
      old.plano_distribuicao is distinct from new.plano_distribuicao;
  end if;

  delete from public.solver_runs
  where versao_id in (
    select v.id from public.versoes v
    where exists (select 1 from jsonb_array_elements(coalesce(v.sessoes, '[]'::jsonb)) s where s->>'ucSigla' = sigla_antiga)
  );

  if tg_op = 'DELETE' or mudanca_pedagogica then
    update public.versoes v
    set sessoes = coalesce((
      select jsonb_agg(s)
      from jsonb_array_elements(coalesce(v.sessoes, '[]'::jsonb)) s
      where s->>'ucSigla' <> sigla_antiga
    ), '[]'::jsonb), score = 0
    where exists (select 1 from jsonb_array_elements(coalesce(v.sessoes, '[]'::jsonb)) s where s->>'ucSigla' = sigla_antiga);
  else
    update public.versoes v
    set sessoes = coalesce((
      select jsonb_agg(case when s->>'ucSigla' = sigla_antiga
        then s || jsonb_build_object('ucSigla', new.sigla, 'ucNome', new.nome)
        else s end)
      from jsonb_array_elements(coalesce(v.sessoes, '[]'::jsonb)) s
    ), '[]'::jsonb)
    where old.sigla is distinct from new.sigla or old.nome is distinct from new.nome;
  end if;

  if tg_op = 'DELETE' then
    update public.docentes
    set unidades_curriculares = array_remove(coalesce(unidades_curriculares, '{}'::text[]), sigla_antiga),
        atribuicoes_ucs = coalesce(atribuicoes_ucs, '{}'::jsonb) - sigla_antiga
    where sigla_antiga = any(coalesce(unidades_curriculares, '{}'::text[]))
       or coalesce(atribuicoes_ucs, '{}'::jsonb) ? sigla_antiga;
    return old;
  end if;

  if mudanca_pedagogica then
    delete from public.cargas_docentes_provisorias where uc_id = new.id;
  end if;

  if old.sigla is distinct from new.sigla then
    update public.docentes
    set unidades_curriculares = array(
          select case when x = old.sigla then new.sigla else x end
          from unnest(coalesce(unidades_curriculares, '{}'::text[])) x
        ),
        atribuicoes_ucs = case when coalesce(atribuicoes_ucs, '{}'::jsonb) ? old.sigla
          then (coalesce(atribuicoes_ucs, '{}'::jsonb) - old.sigla)
               || jsonb_build_object(new.sigla, atribuicoes_ucs->old.sigla)
          else coalesce(atribuicoes_ucs, '{}'::jsonb) end
    where old.sigla = any(coalesce(unidades_curriculares, '{}'::text[]))
       or coalesce(atribuicoes_ucs, '{}'::jsonb) ? old.sigla;
  end if;
  return new;
end;
$$;

revoke all on function public.sincronizar_dependencias_uc() from public, anon, authenticated;

drop trigger if exists trg_sincronizar_dependencias_uc on public.ucs;
create trigger trg_sincronizar_dependencias_uc
after update or delete on public.ucs
for each row execute function public.sincronizar_dependencias_uc();
