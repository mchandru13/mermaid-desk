import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed port for `devUrl` and builds to `dist/`.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**", "**/research/**"],
    },
  },
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        manualChunks: {
          mermaid: ["mermaid"],
          monaco: ["monaco-editor"],
        },
      },
    },
  },
});
