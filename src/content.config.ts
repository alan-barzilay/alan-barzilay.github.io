import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/raw_blog" }),
  schema: ({ image }) => z.object({
    slug: z.string().optional(),
    title: z.string(),
    // image: z.object({
    // src: z.string(),
    // alt: z.string(),
    // }),
    img_src: image().optional(),
    alt_text: z.string().optional(),
    tags: z.array(z.string()),
    date: z.string().transform((str) => {// i hate this, fucking stupid mmddyyyy default
      const [day, month, year] = str.split(/[\/-]/).map(Number); // Split by slash or dash
      return new Date(year, month - 1, day); //cursed JavaScript's 0-indexed months. // WHAT THE ACTUAL FUCK
    }),
    minutes: z.string().optional(),
    paragrafo: z.string(),
    draft: z.boolean().optional().default(false),
  })
});

export const collections = { blog };