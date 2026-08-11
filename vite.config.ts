import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  base: "/",

  server: {
    host: "::",
    // 8080 continua sendo o padrão; PORT permite subir uma segunda instância
    // sem brigar com a que já estiver rodando. `--port` na linha de comando
    // (é o que a suíte E2E usa) continua vencendo os dois.
    port: Number(process.env.PORT) || 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // As rotas já são lazy (Suspense em App.tsx). O que sobrava no chunk de
        // entrada era vendor: separá-lo tira ~40% do primeiro download e o
        // torna cacheável entre deploys — vendor muda muito menos que o app.
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          charts: ["recharts"],
          supabase: ["@supabase/supabase-js"],
          motion: ["framer-motion"],
        },
      },
    },
  },
}));
