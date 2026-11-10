import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  appType: "spa",
  server: {
    host: "127.0.0.1",
    hmr: false,
    watch: { ignored: ["**/data/**"] },
  },
});
