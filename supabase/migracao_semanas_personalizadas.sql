-- Migração para adicionar as semanas_personalizadas na tabela anos_semestres
alter table if exists anos_semestres add column if not exists semanas_personalizadas jsonb;
