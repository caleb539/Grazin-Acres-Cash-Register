import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: "Grazin' Acres Register",
        short_name: 'Register',
        description: "In-store checkout for Grazin' Acres",
        theme_color: '#2f4a2b',
        background_color: '#f6f3ea',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
});
