/**
 * Puppeteer website creation time lapse generator
 *
 * This script monitors a specified web page by taking screenshots at regular intervals.
 * It compares the new screenshot buffer against the previous one. 
 * If the buffers are different, it means the page content has visually changed,
 * and the new screenshot is saved to disk with a timestamp so that we can 
 * easily have a sorted list of the screenshots and create a gif from it.
 * 
 * 
 * https://github.com/typicode/tlapse
 * isso usa chalk ft. problemas de seguranca e n tava funcionando pra mim (culpa do chromium quebrado no meu pc)
 * usar puppeteer direto serve e ai n fica uma dependencia extra, GG
 *
 */
// astro preferences disable devToolbar // to remove devtoolbar from screenshots


import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import path from 'path';
import { Buffer } from 'buffer';

// --- Configuration ---
const SUBDIR = 'cardjpeg';
const PAGE = 'blog';
const TARGET_URL = `http://localhost:4321/${PAGE}`; // <-- URL you want to monitor
const WIDTH = 1280;
const HEIGHT = 800;

const INTERVAL_MS =  30000 // 60000; // 60,000 milliseconds = 1 minute
const SCREENSHOT_DIR = path.join(process.cwd(), `screenshots/${SUBDIR}`);

let lastScreenshotBuffer = Buffer.from('');
let browser = null;
let page = null;
let runCount = 0;

// --- Funcs ---
//main
async function monitorPage() {
    await ensureDirectoryExists();

    try {
        // 1. Launch and configure the browser
        browser = await puppeteer.launch({product: 'firefox', headless: true });
        page = await browser.newPage();
        console.log(`[INFO] Browser launched succesfully...`);
        await page.setViewport({ width: WIDTH, height: HEIGHT });
        console.log(`[INFO] Viewport configured succesfully...`);

        // 2. Navigate to the target page
        console.log(`[INFO] Navigating to ${TARGET_URL}...`);
        await page.goto(TARGET_URL, { waitUntil: 'networkidle0' });
        console.log('[INFO] Page loaded successfully.');

        // 3. Start making screenshots
        console.log(`[START] Monitoring started. Checking every ${INTERVAL_MS / 1000} seconds...`);
        checkAndScreenshot();

    } catch (error) {
        console.error(`[FATAL ERROR] Setup failed: ${error.message}`);
        if (browser) await browser.close();
        process.exit(1);
    }
}

async function checkAndScreenshot() {
// Takes a screenshot, compares it to the last one, and saves it if different
    runCount++;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    console.log(`\n--- Run ${runCount}: Checking page at ${timestamp} ---`);

    try {
        // 1. Take the new screenshot
        const newScreenshotBuffer = await page.screenshot({
            fullPage: true,
            type: 'jpeg' // PNG is lossless, making comparison more reliable. Should also be light enough
            ,quality:90
        });
        
        // 2. Compare the new buffer with the last saved buffer 
        // False in first run because lastScreenshotBuffer will be empty
        // From time to time this will fuck up, but is reliable enough for now
        const areBuffersEqual = Buffer.compare(lastScreenshotBuffer, newScreenshotBuffer) === 0;

        if (areBuffersEqual) {
            console.log('[STATUS] No visual change detected. Skipping save.');
        } else {
            // 3. If different, save the new screenshot
            console.log('[STATUS] Visual change DETECTED!');
            const filename = path.join(SCREENSHOT_DIR, `screenshot-${timestamp}.jpeg`);
            await fs.writeFile(filename, newScreenshotBuffer);
            console.log(`[SAVED] New screenshot saved to: ${filename}`);
   
            lastScreenshotBuffer = newScreenshotBuffer;
        }

    } catch (error) {
        console.error(`[ERROR] Failed to process screenshot: ${error.message}`);
    }

    // 4. Rinse and repeat
    setTimeout(checkAndScreenshot, INTERVAL_MS);
}

async function ensureDirectoryExists() {
    try {
        await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
        console.log(`[INFO] Directory ready: ${SCREENSHOT_DIR}`);
    } catch (error) {
        console.error(`[ERROR] Could not create directory: ${error.message}`);
        process.exit(1);
    }
}



// --- Running ---
// Handle termination signals (Ctrl+C)
process.on('SIGINT', async () => {
    console.log('\n[INFO] Monitoring interrupted. Closing browser...');
    if (browser) {
        await browser.close();
    }
    process.exit(0);
});

monitorPage();
