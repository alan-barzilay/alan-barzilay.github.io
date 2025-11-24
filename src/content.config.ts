// 1. Import utilities from `astro:content`
import { defineCollection, z } from 'astro:content';

// 2. Import loader(s)
import { glob } from 'astro/loaders';

// 3. Define your collection(s)
const blog = defineCollection({
    loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/blog" }),
      schema: z.object({
        title: z.string(),
        // image: z.object({
        // src: z.string(),
        // alt: z.string(),
        // }),
        img_src: z.string(),
        tags: z.array(z.string()),

        date: z.date(), 
        read_time: z.string().optional(), 
        minutes: z.string().optional(), 

        paragrafo: z.string()
    })
 });

// 4. Export a single `collections` object to register your collection(s)
export const collections = { blog };