import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function getStaticPaths() {
  const legacyDir = path.resolve(process.cwd(), 'src', 'slides_raw');
  const files = await fs.readdir(legacyDir);
  
  return files
    .filter(file => file.endsWith('.html'))
    .map(file => ({
      params: { slug: file.replace('.html', '') },
    }));
}

export const GET: APIRoute = async ({ params }) => {
  const slug = params.slug;
  const filePath = path.resolve(process.cwd(), 'src', 'slides_raw', `${slug}.html`);

  try {
    let html = await fs.readFile(filePath, 'utf-8');

    // We use html::before for the background and html::after for the spinner
    // This allows us to hide the underlying content while keeping the loader visible
    // without needing to inject complex HTML structures into the body.
    const fixScript = `
      <style>
        /* The Overlay  */
        html::before {
          content: "";
          position: fixed;
          inset: 0;
          background-color: #1a1a1a; 
          z-index: 990; /* Max Z-Index to cover everything */
          transition: opacity 0.4s ease, visibility 0.4s;
        }

        /* The Spinner*/
        html::after {
          content: "";
          position: fixed;
          top: 50%;
          left: 50%;
          width: 48px;
          height: 48px;
          margin-top: -24px; 
          margin-left: -24px; 
          
          /* Spinner Look */
          border: 4px solid #e5e7eb; 
          border-top-color: #3b82f6;
          border-radius: 50%;
          z-index: 999; /* higher than overlay */
          animation: spin 1s linear infinite;
          transition: opacity 0.4s ease, visibility 0.4s;
        }

        /* Animation */
        @keyframes spin { 
          0% { transform: rotate(0deg); } 
          100% { transform: rotate(360deg); } 
        }

        /* "Ready" State - Hide the loader elements */
        html.ready::before,
        html.ready::after {
          opacity: 0;
          visibility: hidden;
          pointer-events: none;
        }
      </style>

      <script>
        // Helper to reveal content
        function showContent() {
          document.documentElement.classList.add('ready');
        }

        // Wait for everything (images, styles, scripts) to load
        window.addEventListener('load', showContent);

        // Backup safety: force show after 3 seconds if an asset hangs
        setTimeout(showContent, 3000);
      </script>
      </head>
    `;
    
    // Inject the script before the head closes
    const fixedHtml = html.replace('</head>', fixScript);

    return new Response(fixedHtml, {
      headers: { 'Content-Type': 'text/html' },
    });

  } catch (e) {
    return new Response('File not found', { status: 404 });
  }
};