import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const proxyConfig = {
  '/api': {
    target: 'http://localhost:3001',
    changeOrigin: true
  },
  '/socket.io': {
    target: 'http://localhost:3001',
    ws: true
  },
  '/downloads': {
    target: 'http://localhost:3001',
    changeOrigin: true
  }
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: proxyConfig
  },
  preview: {
    port: 4173,
    host: '0.0.0.0',
    proxy: proxyConfig
  }
});
