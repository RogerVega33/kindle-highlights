import { copyFile, mkdir } from 'node:fs/promises';

await mkdir(new URL('../build/database/', import.meta.url), { recursive: true });
await copyFile(new URL('../database/schema.sql', import.meta.url), new URL('../build/database/schema.sql', import.meta.url));
