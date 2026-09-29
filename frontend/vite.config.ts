import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// During development the Vite server runs on 5173 and forwards API calls to
// the FastAPI process on 8000. In production the built assets are served by
// FastAPI itself and same-origin paths are used.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
