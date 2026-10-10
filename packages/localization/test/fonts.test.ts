import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Inspect actual sfnt/cmap data rather than assuming a filename proves coverage.
function tables(font: Buffer) {
  const result = new Map<string, number>();
  for (let i = 0; i < font.readUInt16BE(4); i++) {
    const record = 12 + i * 16;
    result.set(font.toString("ascii", record, record + 4), font.readUInt32BE(record + 8));
  }
  return result;
}
function hasGlyph(font: Buffer, cmap: number, point: number) {
  for (let i = 0; i < font.readUInt16BE(cmap + 2); i++) {
    const subtable = cmap + font.readUInt32BE(cmap + 4 + i * 8 + 4);
    if (font.readUInt16BE(subtable) !== 4) continue;
    const count = font.readUInt16BE(subtable + 6) / 2;
    const ends = subtable + 14;
    const starts = ends + count * 2 + 2;
    const deltas = starts + count * 2;
    const ranges = deltas + count * 2;
    for (let segment = 0; segment < count; segment++) {
      const start = font.readUInt16BE(starts + segment * 2);
      if (point < start || point > font.readUInt16BE(ends + segment * 2)) continue;
      const range = font.readUInt16BE(ranges + segment * 2);
      const delta = font.readInt16BE(deltas + segment * 2);
      const glyph = range === 0 ? point : font.readUInt16BE(ranges + segment * 2 + range + (point - start) * 2);
      if (range && glyph === 0) continue;
      if (((glyph + delta) & 0xffff) !== 0) return true;
    }
  }
  return false;
}

test("bundled static Telugu weights contain Telugu selector and mixed Latin glyphs", () => {
  for (const [name, weight] of [["Regular", 400], ["Medium", 500], ["SemiBold", 600], ["Bold", 700]] as const) {
    const font = readFileSync(new URL(`../assets/NotoSansTelugu-${name}.ttf`, import.meta.url));
    const index = tables(font);
    assert.equal(index.has("fvar"), false, `${name} must be static for predictable native loading`);
    assert.equal(font.readUInt16BE(index.get("OS/2")! + 4), weight);
    for (const character of "తెలుగుEnglish012₹") {
      assert.ok(hasGlyph(font, index.get("cmap")!, character.codePointAt(0)!), `${name} missing ${character}`);
    }
  }
});
