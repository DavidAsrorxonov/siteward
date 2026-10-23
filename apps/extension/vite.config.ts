import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config";

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  server: {
    port: 5173,
    strictPort: true,
    cors: {
      origin: /^chrome-extension:\/\/[a-p]{32}$/,
    },
  },
});
