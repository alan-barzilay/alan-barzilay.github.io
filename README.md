# My personal website

A simple website built with [Astro](https://astro.build/) and styled using Tailwind CSS.

## Prerequisites

- [Node.js](https://nodejs.org/) (v22 or later)
- [pnpm](https://pnpm.io/)

## Getting Started

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Run the development server:**
   ```bash
   pnpm dev
   ```
   *Note: This script automatically runs `pnpm clean` (removing the cached `.astro` folder) before launching the server. This is an Astro best practice to ensure cached assets or content schemas do not get out of sync during development.*

## Available Scripts

These scripts are defined in [package.json](file:///home/barzilay/git/meu_site/redesign/package.json):

- **`pnpm dev`**: Starts the local development server with cache clearing.
- **`pnpm build`**: Builds the static production site to the `dist/` directory.
- **`pnpm preview`**: Previews the built site locally (useful for testing/verifying production builds before deployment).
- **`pnpm clean`**: Deletes the cached `.astro/` folder manually.
- **`pnpm astro <command>`**: Runs any arbitrary command using the local `astro` CLI (e.g., `pnpm astro sync` to generate content collection types).
