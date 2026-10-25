// Builds the Colorfigures proof of concept: one self-contained figure page (engine + board drawing + bridge inlined)
// and the host page that drives it. Output: poc/dist/
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';

const out = new URL('../poc/dist/', import.meta.url);
mkdirSync(out, { recursive: true });
const res = await build({
  entryPoints: [new URL('../poc/boardFigure.ts', import.meta.url).pathname],
  bundle: true, format: 'iife', write: false, minify: false, target: 'es2020',
});
const js = res.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
writeFileSync(new URL('esp32-board.figure.html', out), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DOIT ESP32 DevKit V1</title></head><body>
<script>
${js}
</script>
</body></html>
`);
copyFileSync(new URL('../poc/host.html', import.meta.url), new URL('host.html', out));
console.log('wrote poc/dist/esp32-board.figure.html and poc/dist/host.html');
