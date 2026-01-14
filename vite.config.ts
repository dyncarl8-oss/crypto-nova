import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [
      react(),
      {
        name: 'terminal-logger',
        configureServer(server) {
          server.middlewares.use('/api/log', (req, res) => {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
              try {
                const { level, message } = JSON.parse(body);
                const color = level === 'error' ? '\x1b[31m' : level === 'warn' ? '\x1b[33m' : '\x1b[32m';
                console.log(`${color}[FRONTEND ${level.toUpperCase()}]\x1b[0m ${message}`);
              } catch (e) { }
              res.end();
            });
          });
        }
      }
    ],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.WHOP_API_KEY': JSON.stringify(env.WHOP_API_KEY),
      'process.env.WHOP_RESOURCE_ID': JSON.stringify(env.WHOP_RESOURCE_ID)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});
