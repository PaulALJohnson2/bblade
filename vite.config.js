import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Distinct port so Bar Blade never collides with other local apps
    // (e.g. a Next.js app on 3000). strictPort makes Vite fail loudly if the
    // port is taken, rather than silently drifting to another one.
    port: 5180,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-firebase': ['firebase/app', 'firebase/firestore'],
        },
      },
    },
  },
});
