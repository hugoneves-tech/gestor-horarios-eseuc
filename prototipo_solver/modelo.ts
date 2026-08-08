/**
 * O modelo mudou-se para `src/motor/solver/modelo.ts`, onde a aplicação lhe
 * consegue chegar. Este ficheiro fica como ponte para os guiões de medição
 * (`bateria.ts`, `rolar.ts`, `hibrido.ts`), que continuam a importar daqui.
 *
 * Há uma só cópia do modelo. Duas divergiriam.
 *
 * O `Contexto` do protótipo (que lê o snapshot do disco) é um superconjunto do
 * `ContextoSolver` que o modelo exige, por isso encaixa sem conversão.
 */

export * from "../src/motor/solver/modelo";
export { carregarContexto } from "./dados";
