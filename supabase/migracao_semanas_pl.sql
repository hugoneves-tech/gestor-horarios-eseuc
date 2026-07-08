-- Migração: permitir escolher as semanas em que as PL de cada UC decorrem.
-- Ex.: semanas_pl = [3, 6, 7] => as PL desta UC só são colocadas nessas semanas.
-- NULL/ausente = todas as semanas válidas (comportamento anterior).

alter table ucs add column if not exists semanas_pl jsonb;
