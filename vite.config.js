import { defineConfig } from "vite";

export default defineConfig({
  // Dev stays at /. The GitHub Pages build sets TERMVIZ_BASE=/TermViz/.
  base: process.env.TERMVIZ_BASE || "/",
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
        ipsKg: "ips-kg-demo.html",
      },
    },
  },
});
