-- Migração para adicionar limites máximos de aulas em simultâneo por UC
alter table if exists ucs add column if not exists max_simultaneo_t int;
alter table if exists ucs add column if not exists max_simultaneo_tp int;
alter table if exists ucs add column if not exists max_simultaneo_pl int;
