import { defineConfig } from "vite";

const base = process.env.TERMVIZ_BASE || "/";
const baseWithSlash = base.endsWith("/") ? base : `${base}/`;

export default defineConfig({
  // Dev: /. Production: TERMVIZ_BASE=/TermViz/. PR preview: /TermViz/previews/pr-<n>/.
  base: baseWithSlash,
  plugins: [
    {
      name: "termviz-html-base",
      transformIndexHtml(html) {
        return html.replaceAll("%BASE_URL%", baseWithSlash);
      },
    },
  ],
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
