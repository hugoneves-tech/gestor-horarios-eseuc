-- ===========================================================================
-- Fechar o RLS: de acesso anónimo (dev) → apenas utilizadores AUTENTICADOS.
-- Corre isto DEPOIS de teres confirmado que o login funciona, senão ficas sem
-- acesso à base de dados (o anon key deixa de poder ler/escrever).
-- ===========================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'cursos','anos_semestres','ucs','turmas','docentes','salas',
    'feriados','regras','versoes','solver_runs'
  ] loop
    -- remove a política permissiva de desenvolvimento
    execute format('drop policy if exists "dev_all" on %I;', t);
    execute format('drop policy if exists "auth_all" on %I;', t);
    -- só utilizadores autenticados podem ler/escrever
    execute format(
      'create policy "auth_all" on %I for all to authenticated using (true) with check (true);', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- (Futuro) Restringir por escola/papel: quando tiveres uma tabela de perfis,
-- trocar `using (true)` por uma condição baseada em auth.uid() / role.
-- ---------------------------------------------------------------------------
