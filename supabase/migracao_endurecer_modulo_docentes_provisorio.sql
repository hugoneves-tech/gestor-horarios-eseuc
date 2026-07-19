drop policy if exists "auth_all" on public.cargas_docentes_provisorias;
drop policy if exists "auth_all" on public.atribuicoes_aulas_docente_provisorias;
drop policy if exists "membros" on public.cargas_docentes_provisorias;
drop policy if exists "membros" on public.atribuicoes_aulas_docente_provisorias;

create policy "membros" on public.cargas_docentes_provisorias
  for all to authenticated using ((select public.is_member((select auth.uid()))))
  with check ((select public.is_member((select auth.uid()))));
create policy "membros" on public.atribuicoes_aulas_docente_provisorias
  for all to authenticated using ((select public.is_member((select auth.uid()))))
  with check ((select public.is_member((select auth.uid()))));

revoke all on function public.sincronizar_dependencias_uc() from public, anon, authenticated;

create index if not exists cargas_docentes_provisorias_uc_idx
  on public.cargas_docentes_provisorias (uc_id);
create index if not exists cargas_docentes_provisorias_ano_semestre_idx
  on public.cargas_docentes_provisorias (ano_semestre_id);
create index if not exists atribuicoes_aulas_docente_provisorias_docente_idx
  on public.atribuicoes_aulas_docente_provisorias (docente_id);
create index if not exists atribuicoes_aulas_docente_provisorias_uc_idx
  on public.atribuicoes_aulas_docente_provisorias (uc_id);
