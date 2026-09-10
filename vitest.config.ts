import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    // `supabase/functions` entra porque os ajudantes puros de edge function
    // não tinham como ser testados: o vitest só via `src/`, e o resultado é que
    // parsers e tradutores que rodam em produção seguiam sem um único teste.
    // Só carrega arquivo SEM dependência do runtime do Deno — quem importa
    // `secrets.ts` (que lê `Deno.env`) continua fora do alcance daqui.
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "supabase/functions/**/*.{test,spec}.ts",
    ],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
