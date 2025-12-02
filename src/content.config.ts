import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/blog" }),
  schema: z.object({
    slug: z.string().optional(),
    title: z.string(),
    // image: z.object({
    // src: z.string(),
    // alt: z.string(),
    // }),
    img_src: z.string().optional(),
    alt_text: z.string().optional(),
    tags: z.array(z.string()),
    date: z.date(),
    minutes: z.string().optional(),
    paragrafo: z.string(),
    draft: z.boolean().optional().default(false),
  })
});

export const collections = { blog };