import react from "@vitejs/plugin-react";
import dns from "node:dns";
import { defineConfig, loadEnv } from "vite";

dns.setDefaultResultOrder("ipv4first");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.VITE_SUPABASE_URL;

  return {
    plugins: [react()],
    server: {
      proxy: target
        ? {
            "/supabase": {
              target,
              changeOrigin: true,
              secure: true,
              ws: true,
              timeout: 30000,
              proxyTimeout: 30000,
              rewrite: (path) => path.replace(/^\/supabase/, ""),
            },
          }
        : undefined,
    },
  };
});
