import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(resolve(root, "src/index.ts"), "utf8");
const colorsMatch = source.match(/colors:\s*\{([\s\S]*?)\n\s*\},/);
const fontMatch = source.match(/fontFamily:\s*'([^']+)'/);
const radiusMatch = source.match(/card:\s*(\d+)/);

if (!colorsMatch || !fontMatch || !radiusMatch) {
  throw new Error("Could not read the shared Local Basket theme tokens.");
}

const kebab = (value) => value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
const colorVariables = [...colorsMatch[1].matchAll(/^\s*([A-Za-z]\w*):\s*"([^"]+)",?\s*$/gm)]
  .map(([, name, value]) => {
    const hex = value.match(/^#([0-9a-f]{6})$/i);
    const cssValue = hex
      ? hex[1].match(/.{2}/g).map((channel) => Number.parseInt(channel, 16)).join(" ")
      : value;
    return `  --lb-${kebab(name)}: ${cssValue};`;
  });

const css = `/* Generated from src/index.ts by scripts/generate-theme-css.mjs. Do not edit by hand. */\n:root {\n${colorVariables.join("\n")}\n  --lb-font-family: ${fontMatch[1]};\n  --lb-radius-card: ${radiusMatch[1]}px;\n}\n`;
await writeFile(resolve(root, "src/theme.css"), css);
