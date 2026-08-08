-- ===========================================================================
-- Limita o veto do arranque ao 1.º SEMESTRE.
--
-- PROBLEMA: a regra `h_2ano_semana_1_sem_pl` bloqueia todos os dias e tipos de
-- aula na "semana 1" para dar lugar ao layout fixo do arranque. Como a semana
-- era indicada sem semestre, o veto apanhava também a semana 1 do 2.º SEMESTRE
-- (semana global 16) — que não tem layout fixo nenhum. Resultado: a semana 16
-- ficava COMPLETAMENTE VAZIA, apesar de haver carga por colocar.
--
-- CORREÇÃO: acrescentar `semestre: 1` à restrição. A semana 16 passa a ser
-- gerada normalmente. Com o Carnaval a bloquear segunda e terça (8 e 9 de
-- fevereiro de 2027), sobram quarta, quinta e sexta; e como a janela das aulas
-- T é segunda/quarta/sexta-de-manhã, as teóricas caem naturalmente na quarta e
-- na sexta, com a quinta para as TP.
--
-- ⚠️ FECHA A APLICAÇÃO ANTES DE CORRER (a auto-gravação desfaz alterações SQL).
-- ===========================================================================

update regras
   set config = jsonb_set(
         config,
         '{motor,restricoesUC}',
         (
           select jsonb_agg(jsonb_set(r, '{semestre}', '1'::jsonb, true))
             from jsonb_array_elements(config -> 'motor' -> 'restricoesUC') as r
         ),
         true
       )
 where id = 'h_2ano_semana_1_sem_pl'
   and config -> 'motor' -> 'restricoesUC' is not null
returning id;


-- ===========================================================================
-- CONFIRMAÇÃO — corre numa execução SEPARADA.
-- Cada restrição desta regra deve passar a ter "semestre": 1.
-- ===========================================================================
select id,
       jsonb_pretty(config -> 'motor' -> 'restricoesUC') as restricoes
  from regras
 where id = 'h_2ano_semana_1_sem_pl';
