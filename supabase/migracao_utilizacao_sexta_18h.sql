-- Passa a utilizar a sexta-feira como um dia letivo normal, incluindo 18h-20h.
-- Idempotente e aplicável sobre instalações que já tenham a regra de blocos a 100%.

update regras
set config = jsonb_set(
  jsonb_set(
    coalesce(config, '{}'::jsonb),
    '{motor,blocos100,preferirSextaLivre}',
    'false'::jsonb,
    true
  ),
  '{traducaoSimples}',
  to_jsonb('Todos os blocos têm sempre 100% dos estudantes e a sexta-feira utiliza toda a capacidade disponível, incluindo 18h-20h.'::text),
  true
)
where id = 'h_blocos_ocupacao_100';
