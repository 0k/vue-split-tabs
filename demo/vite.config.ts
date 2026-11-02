import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [vue()],
  resolve: { alias: [
    { find: "@0k/vue-split-tabs/style.css", replacement: fileURLToPath(new URL("../dist/style.css", import.meta.url)) },
    { find: "@0k/vue-split-tabs", replacement: fileURLToPath(new URL("../dist/index.js", import.meta.url)) },
  ] },
  cacheDir: ".vite",
  server: { host: "127.0.0.1", fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] } },
  build: { target: "chrome91", outDir: "dist", emptyOutDir: true },
});
