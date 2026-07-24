-- Regra anual e configurável para que cada bloco de uma turma teórica tenha 100% dos alunos.
-- Idempotente: pode ser executada novamente sem duplicar a regra.

insert into regras (id, nome, tipo, categoria, descricao, escopo, ano_curricular, config, peso, ativa)
values (
  'h_blocos_ocupacao_100',
  'Ocupação obrigatória de 100% em todos os blocos',
  'hard',
  'Estudante',
  'Cada bloco, por turma teórica, é indivisível e só pode usar uma das combinações pedagógicas aprovadas. Sessões que não completem 100% não são publicadas.',
  'transversal',
  'todos',
  '{
    "traducaoSimples": "Todos os blocos têm sempre 100% dos estudantes e a sexta-feira utiliza toda a capacidade disponível, incluindo 18h-20h.",
    "anosLetivos": [],
    "motor": {
      "blocos100": {
        "exigirCoberturaTotal": true,
        "preferirSextaLivre": false,
        "padroesAtivos": ["T1", "TP4_MESMA_UC", "TP2_DUAS_UCS", "TP2_PL3_PL3", "TP3_PL3"],
        "padraoAEvitar": "TP3_PL3",
        "percentagens": { "T": 100, "TP": 25, "PL": 8.3333333333 }
      }
    }
  }'::jsonb,
  10,
  true
)
on conflict (id) do update set
  nome = excluded.nome,
  tipo = excluded.tipo,
  categoria = excluded.categoria,
  descricao = excluded.descricao,
  config = regras.config || excluded.config,
  peso = 10,
  ativa = true;
