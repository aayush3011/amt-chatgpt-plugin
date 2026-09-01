// Bundle web/widget.jsx (with React) into a single self-contained ESM module,
// web/widget.build.js, which the MCP server embeds into the skybridge HTML resource.
// Bundling means the widget needs no runtime CDN/network fetch inside ChatGPT's iframe.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [join(root, "web", "widget.jsx")],
  bundle: true,
  format: "esm",
  target: ["es2020"],
  jsx: "automatic",
  minify: true,
  outfile: join(root, "web", "widget.build.js"),
  logLevel: "info",
});

console.log("widget bundled -> web/widget.build.js");
