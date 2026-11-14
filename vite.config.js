import { defineConfig } from 'vite';
import { attachRelay } from './relay.mjs';

// `npm run dev` and `npm run preview` get the same online-race relay at /ws that server.mjs runs in production.
const relay = () => ({
  name: 'satoyama-relay',
  configureServer(server) { if (server.httpServer) attachRelay(server.httpServer); },
  configurePreviewServer(server) { if (server.httpServer) attachRelay(server.httpServer); },
});

export default defineConfig({ plugins: [relay()] });
