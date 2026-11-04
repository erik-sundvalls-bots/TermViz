import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 44731,
    strictPort: true,
  },
  preview: {
    host: "0.0.0.0",
    port: 44731,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      input: {
        index: "index.html",
        mapper: "termviz-mapper-test.html",
        sample: "termviz-test-1.html",
      },
    },
  },
});
