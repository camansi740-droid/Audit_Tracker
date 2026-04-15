import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      '__API_URL__': JSON.stringify(
        mode === 'production' 
          ? 'https://auditflow-ai-app.onrender.com'
          : 'http://localhost:3001'
      ),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/api/clients': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          timeout: 300000,        // 5 minutes — for download-all ZIP generation
          proxyTimeout: 300000,   // 5 minutes — backend processing time
        },
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          timeout: 60000,
          proxyTimeout: 60000,
        },
      },
    },
  };
});