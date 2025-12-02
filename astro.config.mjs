// @ts-check
import { defineConfig, fontProviders  } from 'astro/config';

import sitemap from '@astrojs/sitemap';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  integrations: [sitemap()],

  vite: {
    plugins: [tailwindcss()]
  },
  experimental: {
    fonts: [
      {
        name: "Montserrat",
        cssVariable: "--font-montserrat",
        provider: fontProviders.google(),
        weights: [400, 700],
        styles: ["normal", "italic"],
        subsets: ["latin"],
      },
      {
        name: "JetBrains Mono",
        cssVariable: "--font-jetbrains-mono", 
        provider: fontProviders.google(),
        weights: [400, 900],
        styles: ["normal"],
        subsets: ["latin"],
        fallbacks: ["monospace"],
      },
    ],
},
});


