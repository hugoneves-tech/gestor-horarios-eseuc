import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    // O worker do solver (`src/motor/solver/worker.ts`) importa o OR-Tools em
    // WebAssembly, que é grande e vem em vários pedaços. O formato IIFE, que é o
    // que o Vite usa por omissão para workers, não suporta divisão em pedaços e
    // faz o build falhar. Módulos ES suportam — e todos os browsers que esta
    // aplicação serve sabem carregar `new Worker(..., { type: "module" })`.
    worker: {
      format: 'es',
    },
    // O `cpsat-js` traz um binário WebAssembly de 6 MB ao lado do seu código. Se o
    // Vite o pré-empacotar para `node_modules/.vite/deps`, o código vai lá parar
    // mas o `.wasm` não — e o pedido do binário cai na rota apanha-tudo da SPA,
    // que responde com o `index.html`. O carregador recebe `<!doctype…` onde
    // esperava o cabeçalho do WebAssembly e aborta. Excluí-lo do pré-empacotamento
    // mantém o par código+binário junto, no sítio onde o carregador o procura.
    optimizeDeps: {
      exclude: ['cpsat-js'],
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
