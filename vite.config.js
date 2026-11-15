import { defineConfig } from "vite";

export default defineConfig({
  /**
   * GitHub Pages serves a project site from /<repo-name>/, so asset URLs
   * need that prefix. Capacitor and `npm run dev` serve from the root.
   * Set BASE=/gymsocial/ in the Pages build (the workflow does this).
   */
  base: process.env.BASE || "/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // two pages: the app, and the developer page (admin.html)
    rollupOptions: { input: { main: "index.html", admin: "admin.html" } },
  },
  server: { host: true, port: 5173 }, // host:true lets your phone open it on wifi
});
