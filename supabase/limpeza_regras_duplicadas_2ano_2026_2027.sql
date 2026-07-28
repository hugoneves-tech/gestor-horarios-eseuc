-- Executar depois de migracao_regras_correcao_2ano_2026_2027.sql.
-- Conserva apenas as regras canónicas e remove as versões anteriormente
-- criadas pela interface com ids reg_<timestamp> ou ids legados.

delete from public.regras
where nome = 'EIG: T antes das TP'
  and id <> 'h_eig_t_antes_tp';

delete from public.regras
where nome = 'PSIS: 4 aulas T antes das TP'
  and id <> 'h_psis_4t_antes_tp';

delete from public.regras
where nome = 'Tarde livre em 09/09/2026'
  and id <> 'h_tarde_09_09_2026';

-- Resultado esperado: exatamente uma linha de cada regra.
select id, nome, ativa, config
from public.regras
where id in (
  'h_eig_t_antes_tp',
  'h_psis_4t_antes_tp',
  'h_tarde_09_09_2026',
  'h_calendario_2ano_2026_2027',
  'h_preenchimento_dias_2ano',
  'h_blocos_ocupacao_100'
)
order by id;
