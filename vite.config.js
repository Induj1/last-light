import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backendPort = Number(process.env.PORT) || 3001;

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": `http://127.0.0.1:${backendPort}`,
      "/ws": { target: `ws://127.0.0.1:${backendPort}`, ws: true },
    },
  },
});
