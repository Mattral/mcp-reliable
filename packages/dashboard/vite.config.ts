import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // In dev, forward API calls to a locally running @mattral/server
      // (`node packages/server/dist/index.js`, default port 4317) so `vite`
      // can be run standalone without CORS configuration.
      "/api": "http://localhost:4317"
    }
  },
  build: {
    outDir: "dist",
    sourcemap: true
  }
});
