import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3001",
      "/reset-password": "http://localhost:3001",
      "/password-updated": "http://localhost:3001",
      "/.well-known/change-password": "http://localhost:3001",
    },
  },
});
