import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv, type Plugin} from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

function geminiApiDevMiddleware(): Plugin {
  return {
    name: 'gemini-api-dev-middleware',
    configureServer(server) {
      server.middlewares.use('/api/gemini', (req, res) => {
        const chunks: Buffer[] = [];

        req.on('data', (chunk) => {
          chunks.push(Buffer.from(chunk));
        });

        req.on('end', async () => {
          try {
            const { default: handler } = await import('./api/gemini');
            const body = Buffer.concat(chunks).toString('utf8');
            let statusCode = 200;

            const vercelResponse = {
              setHeader(name: string, value: number | string | readonly string[]) {
                res.setHeader(name, value);
                return this;
              },
              status(code: number) {
                statusCode = code;
                res.statusCode = code;
                return this;
              },
              json(payload: unknown) {
                res.statusCode = statusCode;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(payload));
                return this;
              },
            };

            await handler(
              {
                method: req.method,
                headers: req.headers,
                body,
              },
              vercelResponse
            );
          } catch (error) {
            console.error('Local Gemini API middleware failed:', error);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Local Gemini API middleware failed.' }));
          }
        });
      });
    },
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  for (const key of ['GEMINI_API_KEY', 'GEMINI_MODEL']) {
    if (!process.env[key] && env[key]) {
      process.env[key] = env[key];
    }
  }

  return {
    plugins: [
      geminiApiDevMiddleware(),
      react(), 
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
        manifest: {
          name: 'Aster Flashcard IR',
          short_name: 'Aster',
          description: 'Intelligent Recall Management System',
          theme_color: '#ffffff',
          background_color: '#ffffff',
          display: 'standalone',
          icons: [
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png'
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png'
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable'
            }
          ]
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
          navigateFallback: 'index.html',
          // Add your firebase config file to stay in cache
          additionalManifestEntries: [
            { url: 'firebase-blueprint.json', revision: null }
          ]
        }
      })
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
