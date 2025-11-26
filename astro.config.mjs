// @ts-check
import { defineConfig, fontProviders } from 'astro/config';

import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import mdx from '@astrojs/mdx';

import remarkToc from 'remark-toc';
import { remarkReadingTime } from './remark-reading-time.mjs';
// import { rehypeAccessibleEmojis } from 'rehype-accessible-emojis';

import { visualizer } from 'rollup-plugin-visualizer';
import rehypeExternalLinks from 'rehype-external-links';

// https://astro.build/config
export default defineConfig({
  site: 'https://alanbarzilay.com',
  integrations: [sitemap(), mdx()],

  vite: {
    plugins: [tailwindcss(), visualizer()]
  },
  markdown: {
    remarkPlugins: [remarkReadingTime, [remarkToc, { heading: 'Summary', maxDepth: 6 }]],
    rehypePlugins: [
      [
        rehypeExternalLinks,
        {
          content: { type: 'text', value: ' 🔗' },
          target: '_blank',
          rel: ['nofollow', 'noopener'],
        },
      ],
    ],
    // rehypePlugins: [rehypeAccessibleEmojis],
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

