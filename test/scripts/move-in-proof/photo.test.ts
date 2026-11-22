import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { PHOTO_HEIGHT, PHOTO_WIDTH, crc32, renderPhoto } from "../../../scripts/move-in-proof/photo.mjs";

function chunks(png: Buffer) {
  const found: Array<{ type: string; data: Buffer; crc: number }> = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("latin1");
    const data = png.subarray(offset + 8, offset + 8 + length);
    found.push({ type, data, crc: png.readUInt32BE(offset + 8 + length) });
    offset += 12 + length;
  }
  return found;
}

describe("renderPhoto", () => {
  it("writes a valid RGB PNG of the photo size", () => {
    const png = renderPhoto("recipe-001");
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const [header, ...rest] = chunks(png);
    expect(header.type).toBe("IHDR");
    expect(header.data.readUInt32BE(0)).toBe(PHOTO_WIDTH);
    expect(header.data.readUInt32BE(4)).toBe(PHOTO_HEIGHT);
    expect([...header.data.subarray(8)]).toEqual([8, 2, 0, 0, 0]);
    expect(rest.map((chunk) => chunk.type)).toEqual(["IDAT", "IEND"]);
    for (const chunk of [header, ...rest]) {
      expect(chunk.crc).toBe(crc32(Buffer.concat([Buffer.from(chunk.type, "latin1"), chunk.data])));
    }
    const pixels = inflateSync(rest[0].data);
    expect(pixels.length).toBe(PHOTO_HEIGHT * (1 + PHOTO_WIDTH * 3));
  });

  it("draws the same bytes for the same key and different bytes for another key", () => {
    expect(renderPhoto("recipe-001").equals(renderPhoto("recipe-001"))).toBe(true);
    expect(renderPhoto("recipe-001").equals(renderPhoto("recipe-002"))).toBe(false);
  });

  it("takes a custom size", () => {
    const [header] = chunks(renderPhoto("event", { width: 4, height: 3 }));
    expect(header.data.readUInt32BE(0)).toBe(4);
    expect(header.data.readUInt32BE(4)).toBe(3);
  });
});

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });
});
