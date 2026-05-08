import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

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
              rewrite: (path) => path.replace(/^\/supabase/, ""),
            },
          }
        : undefined,
    },
  };
});
