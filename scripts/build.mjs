import { readFile, writeFile } from 'node:fs/promises';
import { build } from 'vite';

await build();
const html = (await readFile('index.html', 'utf8'))
  .replace('    <script type="module" src="/src/main.ts"></script>', '    <link rel="stylesheet" href="./game.css" />\n    <script defer src="./game.js"></script>');
await writeFile('dist/index.html', html);
