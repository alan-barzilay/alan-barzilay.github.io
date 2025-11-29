// @ts-check
import { defineConfig, fontProviders } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';

import remarkToc from 'remark-toc';
import { remarkReadingTime } from './remark-reading-time.mjs';
import remarkMath from 'remark-math';

import { visualizer } from 'rollup-plugin-visualizer';

import { rehypeAccessibleEmojis } from 'rehype-accessible-emojis';
import rehypeExternalLinks from 'rehype-external-links';
import rehypeKatex from 'rehype-katex';

export default defineConfig({
  site: 'https://alan-barzilay.github.io',
  integrations: [sitemap(), mdx()],

  vite: {
    plugins: [tailwindcss(), visualizer()]
  },
  markdown: {
    remarkPlugins: [remarkReadingTime, remarkMath, [remarkToc, { heading: 'Summary', maxDepth: 6 }]],
    rehypePlugins: [
      [
        rehypeExternalLinks,
        {
          content: { type: 'text', value: ' ↗' },
          target: '_blank',
          rel: ['nofollow', 'noopener'],
        },
      ],
      rehypeKatex, rehypeAccessibleEmojis
    ],
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

