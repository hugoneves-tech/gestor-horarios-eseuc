# Estudo do solver CP-SAT — vale a pena?

Medições de 2026-08-08. Todos os veredictos são do **validador independente**
(`src/validacao/validador.ts`), que não importa nada do motor nem do protótipo.
O protótipo vive em `prototipo_solver/` e não altera uma linha de `src/**`.

## 1. O resultado

| | Heurística atual | Solver em janela rolante |
|---|---|---|
| Sessões | 2588 | **2642** |
| Blocos colocados | — | **570 / 570** |
| Completude | 97,96 % | **100,00 %** |
| Erros | 0 | **0** |
| Avisos | 170 | **28** |
| Dias parciais | 168 | **24** |
| Amplitude semanal | A1:8 A2:2 B1:11 B2:1 | A1:11 A2:3 B1:11 B2:4 |
| Tempo | 17 s | 483 s (4 × 120 s) |

É a primeira vez que este projeto chega aos 100 % com zero erros nas 30 semanas.

O ganho que interessa não é a completude — é os **dias parciais: 168 → 24**.
E os 24 que restam são exatamente os que o horário feito à mão pelo coordenador
tem nas semanas 1-7, ou seja, são estruturais (a primeira semana tem um layout
imposto). **Das semanas 8 a 29 o solver não deixa um único dia incompleto.**

Na janela 1-7 o solver reproduz o horário de referência ao pormenor: as mesmas
916 sessões, os mesmos 0 erros, os mesmos 26 avisos, as mesmas 6 sextas usadas.

Onde perde ligeiramente: a **amplitude semanal** piora (4 avisos contra 2). O
solver empacota melhor os dias mas equilibra um pouco pior as semanas do 2.º
semestre. É afinável pelo peso `pesoEquilibrio`, hoje em 25.

## 2. O que faz isto funcionar: os cortes

O inventário tem **570 blocos em apenas 6 janelas de viabilidade distintas**.
Há exatamente **5 pontos onde bloco nenhum atravessa**: semanas **2, 8, 16, 17, 24**.

As janelas usadas são **1-7 · 8-15 · 16-23 · 24-29** (182 + 103 + 103 + 182).
Resolvidas por ordem, cada uma recebendo o que as anteriores colocaram como
pré-requisitos já cumpridos.

Cortar noutro sítio estraga tudo. O corte em 22/23, que parecia natural, deixa
**103 blocos órfãos** — sem janela que os reclame. A sonda `cortes.ts` responde a
isto em segundos e deve correr sempre que o calendário mudar.

Resolver um semestre inteiro de uma só vez **não funciona**: 15 semanas são
~40 000 variáveis e em 45 s ficam 45 blocos por colocar.

O orçamento de tempo também não é negociável: **45 s por janela dão 99,09 %**
(567/570, 36 dias parciais). Os 120 s são precisos.

## 3. Os três problemas por resolver

### 3.1 O resultado não é reprodutível — este é o grave

A mesma janela, o mesmo modelo (28 418 variáveis, 14 020 restrições), três
corridas:

| Tempo dado | Blocos colocados |
|---|---|
| 45 s | 182 / 182 |
| 120 s | 181 / 182 |
| 45 s (com pista) | 179 / 182 |

Mais tempo chegou a dar pior resultado. A causa é conhecida: 8 trabalhadores em
paralelo dentro do WASM com limite por relógio de parede — cada execução segue
uma trajetória diferente. Para um horário que vai para produção isto não serve:
corres duas vezes e obténs coisas diferentes, uma delas pior.

Caminhos possíveis, por medir:
- `numWorkers: 1` com limite de tempo determinístico (`maxDeterministicTime`),
  que torna a pesquisa reprodutível ao custo de velocidade;
- correr N vezes em paralelo e ficar com a melhor (o problema é embaraçosamente
  paralelo e cada corrida é independente).

### 3.2 O arranque a quente não é um piso

A pista da heurística só mapeia **8 % a 29 % dos blocos** de cada janela: poucas
sessões da heurística correspondem a uma composição do inventário ainda por usar.
Ajudou de facto (a janela 1-7 passou de 181/182 para 182/182), mas **não garante
"nunca pior que a heurística"**. Para garantir seria preciso injetar a solução
completa como pista, ou correr as duas e ficar com a melhor.

### 3.3 Empacotamento

- `cpsat-js` **não está declarado** no `package.json` nem no `package-lock.json`.
  Existe só em `node_modules`, instalado à mão. Num build limpo desaparece.
- 12,2 MB de pacote, dois binários WASM de ~6 MB (um com threads, outro sem).
- Pico de memória observado: **~1,3 GB**.
- 8 minutos de execução: **não cabe numa função síncrona da Netlify**. Precisa de
  uma função em segundo plano ou de um serviço à parte. (Confirmar os limites
  atuais da Netlify antes de decidir — não os dou por garantidos.)

## 4. Veredicto

**Vale a pena, e a decomposição em janelas é a ideia que o torna viável.** Mas não
está pronto para substituir a heurística. Falta resolver a reprodutibilidade —
sem isso, um motor que dá respostas diferentes à mesma pergunta não é um motor
de produção, por muito bom que seja o melhor resultado que consegue.

A arquitetura que faz sentido é **híbrida**: a heurística continua a dar uma
resposta em 17 segundos para uso interativo; o solver corre em segundo plano
quando se quer o horário definitivo, e só substitui a resposta da heurística se
o validador independente confirmar que é melhor.

## 5. Ficheiros

| Ficheiro | Para quê |
|---|---|
| `prototipo_solver/modelo.ts` | o modelo formal (C1–C10, objetivo, arranque a quente) |
| `prototipo_solver/dados.ts` | carrega o snapshot do Supabase e corre o inventário |
| `prototipo_solver/cortes.ts` | sonda: onde é que o calendário se pode cortar |
| `prototipo_solver/rolar.ts` | janela rolante encadeada + veredicto das 30 semanas |
| `prototipo_solver/bateria.ts` | comparação por janela contra a referência do coordenador |
| `prototipo_solver/hibrido.ts` | mede a memória de pico de uma resolução isolada |

Correr: `SOLVER_SEGUNDOS=120 npx tsx prototipo_solver/rolar.ts`
