import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], server: { port: Number(process.env.RELAY_WEB_PORT || 5173), strictPort: true, proxy: { '/api': `http://127.0.0.1:${process.env.RELAY_PORT || 3210}` } }, test: { include: ['tests/**/*.test.ts'], testTimeout: 15000 } } as any);
