import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function getStaticPaths() {
  const legacyDir = path.resolve(process.cwd(), 'src', 'slides_raw');
  
  const files = await fs.readdir(legacyDir);
  
  // Create a route for every .html file found
  return files
    .filter(file => file.endsWith('.html'))
    .map(file => ({
      params: { slug: file.replace('.html', '') },
    }));
}

// "Patcher" Logic (Runs during build)
export const GET: APIRoute = async ({ params }) => {
  const slug = params.slug;
  const filePath = path.resolve(process.cwd(), 'src', 'slides_raw', `${slug}.html`);

  try {
    let html = await fs.readFile(filePath, 'utf-8');

    // 1. Hide the HTML immediately with CSS
    // 2. Wait for window load
    // 3. Show the HTML
    const fixScript = `
      <style>
        html { opacity: 0; transition: opacity 0.3s ease; }
        html.ready { opacity: 1; }
      </style>
      <script>
        window.addEventListener('load', () => {
          document.documentElement.classList.add('ready');
        });
        // Backup safety: force show after 3 seconds
        setTimeout(() => document.documentElement.classList.add('ready'), 3000);
      </script>
      </head>
    `;
    
    const fixedHtml = html.replace('</head>', fixScript);

    return new Response(fixedHtml, {
      headers: { 'Content-Type': 'text/html' },
    });

  } catch (e) {
    return new Response('File not found', { status: 404 });
  }
};