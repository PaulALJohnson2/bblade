import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'BBlade — Stock',
        short_name: 'BBlade',
        description: 'Bar & kitchen stock taking for independent pubs.',
        theme_color: '#2563EB',
        background_color: '#2563EB',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the app shell so it opens with no signal.
        globPatterns: ['**/*.{js,css,html,svg,png,json,woff2}'],
        navigateFallback: '/index.html',
        // Never intercept the Firebase auth handler (/__/auth) — must hit the network.
        navigateFallbackDenylist: [/^\/__/],
        cleanupOutdatedCaches: true,
        // Always fetch the SW + app shell fresh on update so installed PWAs don't
        // get stuck on a stale build after a deploy.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
    }),
  ],
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
