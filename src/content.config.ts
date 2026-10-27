// Las wikis llegan a .content/docs/<proyecto>/ desde tools/fetch.mjs; aquí solo se leen.
import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const docs = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./.content/docs", generateId: ({ entry }) => entry.replace(/\.md$/, "") }),
  schema: z.object({
    project: z.string(),
    path: z.string(),
    title: z.string(),
    type: z.string(),
    description: z.string().optional().default(""),
    owner: z.string().optional().default(""),
    claims: z.number().default(0),
    updated: z.string().nullable(),
    author: z.string().nullable(),
    source: z.string(),
  }),
});

export const collections = { docs };
