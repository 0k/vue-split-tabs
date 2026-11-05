import { resolve } from "node:path";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue()],
  build: {
    emptyOutDir: false,
    target: "chrome91",
    lib: {
      entry: { index: resolve(import.meta.dirname, "src/index.ts"), frame: resolve(import.meta.dirname, "src/frame.ts") },
      formats: ["es"],
      fileName: (_format, name) => `${name}.js`,
    },
    rollupOptions: {
      external: ["vue"],
    },
  },
  test: { environment: "jsdom", setupFiles: ["./test/setup.ts"] },
});
