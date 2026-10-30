import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API runs on port 3000; Vite forwards every /api request to it.
const api = { '/api': 'http://localhost:3000' };

export default defineConfig({
  plugins: [react()],
  server: { proxy: api },
  preview: { proxy: api },
});
