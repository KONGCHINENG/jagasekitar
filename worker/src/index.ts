import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

// Load the repo-root .env so every workspace shares one file.
config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });

const once = process.argv.includes('--once');

// Source adapters (FIRMS, Open-Meteo, Infobanjir) and scheduling arrive in Phase 3.
async function runAll(): Promise<void> {
  console.log(`[worker] ${new Date().toISOString()} no adapters registered yet`);
}

await runAll();
if (!once) {
  console.log('[worker] watch mode: scheduling is added in Phase 3. Press Ctrl+C to exit.');
}
