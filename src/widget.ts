// widget.ts - compose the skybridge HTML resource served to ChatGPT.
//
// Reads the bundled React widget (web/widget.build.js, produced by scripts/build-widget.mjs)
// and wraps it in a minimal HTML document with the mount node and styles. The MCP server
// registers this string as a UI resource; ChatGPT loads it in an iframe and drives it over
// the window.openai / postMessage bridge.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const WIDGET_URI = "ui://widget/amt-memory.html";

const here = dirname(fileURLToPath(import.meta.url));

// dist/widget.js -> ../web/widget.build.js at runtime; fall back to a source-relative path
// when running via ts tooling before a build.
function readBundle(): string {
  const candidates = [
    join(here, "..", "web", "widget.build.js"),
    join(here, "..", "..", "web", "widget.build.js"),
  ];
  for (const p of candidates) {
    try {
      return readFileSync(p, "utf8");
    } catch {
      /* try next */
    }
  }
  throw new Error(
    "web/widget.build.js not found. Run `npm run build:widget` (or `npm run build`) first.",
  );
}

const STYLES = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #1b1b1f; }
.amt-root { padding: 12px 14px; }
.amt-bar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; gap: 8px; }
.amt-title { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.amt-title strong { font-size: 15px; }
.amt-who { font-size: 11px; opacity: 0.6; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.amt-refresh { border: 1px solid rgba(127,127,127,0.35); background: transparent; color: inherit; border-radius: 8px; padding: 5px 10px; font-size: 12px; cursor: pointer; }
.amt-refresh:disabled { opacity: 0.5; cursor: default; }
.amt-cols { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
@media (max-width: 620px) { .amt-cols { grid-template-columns: 1fr; } }
.amt-col { border: 1px solid rgba(127,127,127,0.2); border-radius: 12px; padding: 10px; background: rgba(127,127,127,0.04); }
.amt-col-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.amt-col-head h3 { font-size: 12px; margin: 0; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.8; }
.amt-count { margin-left: auto; font-size: 11px; opacity: 0.6; }
.amt-dot { width: 8px; height: 8px; border-radius: 50%; background: #888; }
.amt-personal .amt-dot { background: #58a6ff; }
.amt-team .amt-dot { background: #3fb950; }
.amt-org .amt-dot { background: #d29922; }
.amt-col ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.amt-item { width: 100%; text-align: left; border: none; background: rgba(127,127,127,0.08); border-radius: 8px; padding: 7px 8px; cursor: pointer; color: inherit; display: flex; flex-direction: column; gap: 3px; }
.amt-item:hover { background: rgba(127,127,127,0.16); }
.amt-type { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.55; }
.amt-content { font-size: 12.5px; line-height: 1.35; }
.amt-empty { font-size: 12px; opacity: 0.6; margin: 4px 0; }
.amt-empty-all { padding: 8px 2px; }
@media (prefers-color-scheme: dark) { body { color: #e6edf3; } }
`.trim();

export function widgetHtml(): string {
  const bundle = readBundle();
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>${STYLES}</style>
  </head>
  <body>
    <div id="amt-root"></div>
    <script type="module">${bundle}</script>
  </body>
</html>`;
}
