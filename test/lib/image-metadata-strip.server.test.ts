import { describe, it, expect, vi } from "vitest";
import { storeImage } from "~/lib/image-storage.server";

/**
 * Byte-level checks that uploads are stored without location or other
 * private metadata. Every fixture is built here from raw chunks so the test
 * can assert exactly which chunks survive.
 */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("latin1");

function bytesAsText(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function storeAndRead(bytes: Uint8Array, name: string, type: string) {
  const bucket = { put: vi.fn().mockResolvedValue(undefined) };
  const file = new File([Uint8Array.from(bytes)], name, { type });
  await storeImage({
    bucket: bucket as unknown as R2Bucket,
    file,
    namespace: "spoons/user-1/recipe-1",
    now: () => 1,
    randomId: () => "id",
  });
  const stored = bucket.put.mock.calls[0][1] as File;
  return { file, stored, storedBytes: new Uint8Array(await stored.arrayBuffer()) };
}

/** A big-endian TIFF block whose first IFD holds the given entries, followed by `trailer`. */
function tiff(entries: Array<{ tag: number; type: number; count: number; value: number }>, trailer = ""): Uint8Array {
  const trailerBytes = textEncoder.encode(trailer);
  const out = new Uint8Array(8 + 2 + entries.length * 12 + 4 + trailerBytes.length);
  const view = new DataView(out.buffer);
  out.set(textEncoder.encode("MM"), 0);
  view.setUint16(2, 42);
  view.setUint32(4, 8);
  view.setUint16(8, entries.length);
  entries.forEach((entry, index) => {
    const at = 10 + index * 12;
    view.setUint16(at, entry.tag);
    view.setUint16(at + 2, entry.type);
    view.setUint32(at + 4, entry.count);
    view.setUint16(at + 8, entry.value);
  });
  out.set(trailerBytes, out.length - trailerBytes.length);
  return out;
}

const ORIENTATION_TAG = 0x0112;
const GPS_IFD_TAG = 0x8825;

function orientationOf(tiffBytes: Uint8Array): number | null {
  const view = new DataView(tiffBytes.buffer, tiffBytes.byteOffset, tiffBytes.byteLength);
  const count = view.getUint16(8);
  for (let index = 0; index < count; index += 1) {
    const at = 10 + index * 12;
    if (view.getUint16(at) === ORIENTATION_TAG) return view.getUint16(at + 8);
  }
  return null;
}

// --- PNG -------------------------------------------------------------------

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array | string): Uint8Array {
  const dataBytes = typeof data === "string" ? textEncoder.encode(data) : data;
  const out = new Uint8Array(12 + dataBytes.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, dataBytes.length);
  out.set(textEncoder.encode(type), 4);
  out.set(dataBytes, 8);
  view.setUint32(8 + dataBytes.length, crc32(out.subarray(4, 8 + dataBytes.length)));
  return out;
}

function png(...chunks: Uint8Array[]): Uint8Array {
  return concat(PNG_SIGNATURE, ...chunks);
}

interface ParsedPngChunk {
  type: string;
  data: Uint8Array;
  raw: Uint8Array;
  crcValid: boolean;
}

function parsePng(bytes: Uint8Array): ParsedPngChunk[] {
  expect(Array.from(bytes.subarray(0, 8))).toEqual(Array.from(PNG_SIGNATURE));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: ParsedPngChunk[] = [];
  let offset = 8;
  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const type = bytesAsText(bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const crc = view.getUint32(offset + 8 + length);
    chunks.push({
      type,
      data,
      raw: bytes.subarray(offset, offset + 12 + length),
      crcValid: crc === crc32(bytes.subarray(offset + 4, offset + 8 + length)),
    });
    offset += 12 + length;
  }
  return chunks;
}

const IHDR = pngChunk("IHDR", new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]));
const IDAT = pngChunk("IDAT", new Uint8Array([0x78, 0x9c, 0x63, 0xf8, 0x0f, 0x00, 0x01, 0x01, 0x01, 0x00]));
const IEND = pngChunk("IEND", new Uint8Array());
const ICCP = pngChunk("iCCP", "sRGB profile\0\0compressed-profile-bytes");
const XMP_ITXT = pngChunk(
  "iTXt",
  'XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta><exif:GPSLatitude>51,30.1N</exif:GPSLatitude></x:xmpmeta>',
);
const GPS_EXIF = pngChunk(
  "eXIf",
  tiff([{ tag: GPS_IFD_TAG, type: 4, count: 1, value: 0 }], "GPSLatitude private location"),
);

describe("PNG metadata stripping on upload", () => {
  it("drops eXIf, tEXt, zTXt, iTXt (XMP) and tIME chunks and keeps image chunks byte for byte", async () => {
    const input = png(
      IHDR,
      ICCP,
      GPS_EXIF,
      pngChunk("tEXt", "Comment\0taken at 12 Private Lane"),
      pngChunk("zTXt", "Author\0\0compressed-author"),
      XMP_ITXT,
      pngChunk("tIME", new Uint8Array([0x07, 0xea, 10, 9, 12, 0, 0])),
      IDAT,
      IEND,
    );

    const { storedBytes, stored } = await storeAndRead(input, "dish.png", "image/png");

    expect(stored.type).toBe("image/png");
    const chunks = parsePng(storedBytes);
    expect(chunks.map((chunk) => chunk.type)).toEqual(["IHDR", "iCCP", "IDAT", "IEND"]);
    expect(chunks.every((chunk) => chunk.crcValid)).toBe(true);
    expect(Array.from(storedBytes)).toEqual(Array.from(png(IHDR, ICCP, IDAT, IEND)));
    const text = bytesAsText(storedBytes);
    expect(text).not.toContain("GPSLatitude");
    expect(text).not.toContain("Private Lane");
    expect(text).not.toContain("compressed-author");
  });

  it("replaces an eXIf chunk that has an orientation with one holding only that orientation", async () => {
    const input = png(
      IHDR,
      pngChunk(
        "eXIf",
        tiff(
          [
            { tag: ORIENTATION_TAG, type: 3, count: 1, value: 6 },
            { tag: GPS_IFD_TAG, type: 4, count: 1, value: 0 },
          ],
          "GPSLatitude private location",
        ),
      ),
      IDAT,
      IEND,
    );

    const { storedBytes } = await storeAndRead(input, "dish.png", "image/png");

    const chunks = parsePng(storedBytes);
    expect(chunks.map((chunk) => chunk.type)).toEqual(["IHDR", "eXIf", "IDAT", "IEND"]);
    expect(chunks.every((chunk) => chunk.crcValid)).toBe(true);
    const exif = chunks[1]!.data;
    expect(orientationOf(exif)).toBe(6);
    expect(new DataView(exif.buffer, exif.byteOffset).getUint16(8)).toBe(1);
    expect(bytesAsText(storedBytes)).not.toContain("GPSLatitude");
    expect(chunks[2]!.raw).toEqual(IDAT);
  });

  it("reads orientation from an eXIf chunk written with an Exif header prefix", async () => {
    const input = png(
      IHDR,
      pngChunk("eXIf", concat(textEncoder.encode("Exif\0\0"), tiff([{ tag: ORIENTATION_TAG, type: 3, count: 1, value: 3 }]))),
      IDAT,
      IEND,
    );

    const { storedBytes } = await storeAndRead(input, "dish.png", "image/png");

    const exif = parsePng(storedBytes)[1]!;
    expect(exif.type).toBe("eXIf");
    expect(exif.crcValid).toBe(true);
    expect(orientationOf(exif.data)).toBe(3);
  });

  it("stores a PNG with no metadata chunks unchanged", async () => {
    const input = png(IHDR, ICCP, IDAT, IEND);
    const { file, stored } = await storeAndRead(input, "dish.png", "image/png");
    expect(stored).toBe(file);
  });

  it("drops bytes appended after IEND", async () => {
    const input = concat(png(IHDR, IDAT, IEND), textEncoder.encode("GPSLatitude appended"));
    const { storedBytes } = await storeAndRead(input, "dish.png", "image/png");
    expect(Array.from(storedBytes)).toEqual(Array.from(png(IHDR, IDAT, IEND)));
  });

  it("stores a PNG with a truncated chunk unchanged instead of guessing at it", async () => {
    const truncatedText = pngChunk("tEXt", "Comment\0in a truncated chunk").subarray(0, 20);
    const input = png(IHDR, pngChunk("tEXt", "Comment\0x"), IDAT, truncatedText);
    const { file, stored } = await storeAndRead(input, "dish.png", "image/png");
    expect(stored).toBe(file);
  });

  it("stores a PNG whose tail is too short for a chunk header unchanged", async () => {
    const input = concat(png(IHDR, pngChunk("tEXt", "Comment\0x"), IDAT), new Uint8Array([0, 0, 0, 9, 0x74]));
    const { file, stored } = await storeAndRead(input, "dish.png", "image/png");
    expect(stored).toBe(file);
  });

  it("detects PNG bytes even when the declared type and name disagree", async () => {
    const input = png(IHDR, pngChunk("tEXt", "Comment\0GPSLatitude"), IDAT, IEND);
    const { storedBytes } = await storeAndRead(input, "upload", "application/octet-stream");
    expect(parsePng(storedBytes).map((chunk) => chunk.type)).toEqual(["IHDR", "IDAT", "IEND"]);
  });
});

// --- WebP ------------------------------------------------------------------

function webpChunk(fourcc: string, data: Uint8Array | string): Uint8Array {
  const dataBytes = typeof data === "string" ? textEncoder.encode(data) : data;
  const padded = dataBytes.length + (dataBytes.length % 2);
  const out = new Uint8Array(8 + padded);
  out.set(textEncoder.encode(fourcc), 0);
  new DataView(out.buffer).setUint32(4, dataBytes.length, true);
  out.set(dataBytes, 8);
  return out;
}

function webp(...chunks: Uint8Array[]): Uint8Array {
  const body = concat(textEncoder.encode("WEBP"), ...chunks);
  const header = new Uint8Array(8);
  header.set(textEncoder.encode("RIFF"), 0);
  new DataView(header.buffer).setUint32(4, body.length, true);
  return concat(header, body);
}

const VP8X_ICC = 0x20;
const VP8X_ALPHA = 0x10;
const VP8X_EXIF = 0x08;
const VP8X_XMP = 0x04;

function vp8x(flags: number): Uint8Array {
  // flags, 3 reserved bytes, canvas width-1 and height-1 (24-bit each).
  return webpChunk("VP8X", new Uint8Array([flags, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
}

interface ParsedWebpChunk {
  fourcc: string;
  data: Uint8Array;
  raw: Uint8Array;
}

function parseWebp(bytes: Uint8Array): ParsedWebpChunk[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(bytesAsText(bytes.subarray(0, 4))).toBe("RIFF");
  expect(view.getUint32(4, true)).toBe(bytes.length - 8);
  expect(bytesAsText(bytes.subarray(8, 12))).toBe("WEBP");
  const chunks: ParsedWebpChunk[] = [];
  let offset = 12;
  while (offset < bytes.length) {
    const size = view.getUint32(offset + 4, true);
    const end = offset + 8 + size + (size % 2);
    chunks.push({
      fourcc: bytesAsText(bytes.subarray(offset, offset + 4)),
      data: bytes.subarray(offset + 8, offset + 8 + size),
      raw: bytes.subarray(offset, end),
    });
    offset = end;
  }
  return chunks;
}

const WEBP_ICCP = webpChunk("ICCP", "icc-profile-bytes");
const WEBP_ALPH = webpChunk("ALPH", new Uint8Array([0, 1, 2]));
// An odd-length bitstream, so the chunk carries a padding byte.
const WEBP_VP8 = webpChunk("VP8 ", new Uint8Array([0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, 0x01, 0x00, 0x01]));
const WEBP_GPS_EXIF = webpChunk("EXIF", tiff([{ tag: GPS_IFD_TAG, type: 4, count: 1, value: 0 }], "GPSLatitude private"));
const WEBP_XMP = webpChunk("XMP ", "<x:xmpmeta><exif:GPSLongitude>0,7.5W</exif:GPSLongitude></x:xmpmeta>");

describe("WebP metadata stripping on upload", () => {
  it("drops EXIF and XMP chunks, clears their VP8X flags and keeps ICCP and image chunks byte for byte", async () => {
    const input = webp(
      vp8x(VP8X_ICC | VP8X_ALPHA | VP8X_EXIF | VP8X_XMP),
      WEBP_ICCP,
      WEBP_ALPH,
      WEBP_VP8,
      WEBP_GPS_EXIF,
      WEBP_XMP,
    );

    const { storedBytes, stored } = await storeAndRead(input, "dish.webp", "image/webp");

    expect(stored.type).toBe("image/webp");
    const chunks = parseWebp(storedBytes);
    expect(chunks.map((chunk) => chunk.fourcc)).toEqual(["VP8X", "ICCP", "ALPH", "VP8 "]);
    expect(chunks[0]!.data[0]).toBe(VP8X_ICC | VP8X_ALPHA);
    expect(Array.from(storedBytes)).toEqual(
      Array.from(webp(vp8x(VP8X_ICC | VP8X_ALPHA), WEBP_ICCP, WEBP_ALPH, WEBP_VP8)),
    );
    const text = bytesAsText(storedBytes);
    expect(text).not.toContain("GPSLatitude");
    expect(text).not.toContain("GPSLongitude");
  });

  it("keeps only the orientation from an EXIF chunk and leaves the EXIF flag set", async () => {
    const input = webp(
      vp8x(VP8X_EXIF | VP8X_XMP),
      WEBP_VP8,
      webpChunk(
        "EXIF",
        tiff(
          [
            { tag: ORIENTATION_TAG, type: 3, count: 1, value: 8 },
            { tag: GPS_IFD_TAG, type: 4, count: 1, value: 0 },
          ],
          "GPSLatitude private",
        ),
      ),
      WEBP_XMP,
    );

    const { storedBytes } = await storeAndRead(input, "dish.webp", "image/webp");

    const chunks = parseWebp(storedBytes);
    expect(chunks.map((chunk) => chunk.fourcc)).toEqual(["VP8X", "VP8 ", "EXIF"]);
    expect(chunks[0]!.data[0]).toBe(VP8X_EXIF);
    expect(orientationOf(chunks[2]!.data)).toBe(8);
    expect(bytesAsText(storedBytes)).not.toContain("GPS");
  });

  it("reads orientation from an EXIF chunk written with an Exif header prefix", async () => {
    const input = webp(
      vp8x(VP8X_EXIF),
      WEBP_VP8,
      webpChunk("EXIF", concat(textEncoder.encode("Exif\0\0"), tiff([{ tag: ORIENTATION_TAG, type: 3, count: 1, value: 2 }]))),
    );
    const { storedBytes } = await storeAndRead(input, "dish.webp", "image/webp");
    const chunks = parseWebp(storedBytes);
    expect(chunks[2]!.fourcc).toBe("EXIF");
    expect(orientationOf(chunks[2]!.data)).toBe(2);
  });

  it("stores a simple WebP with no metadata unchanged", async () => {
    const input = webp(WEBP_VP8);
    const { file, stored } = await storeAndRead(input, "dish.webp", "image/webp");
    expect(stored).toBe(file);
  });

  it("drops bytes past the RIFF size", async () => {
    const input = concat(webp(vp8x(0), WEBP_VP8), textEncoder.encode("GPS trailing bytes"));
    const { storedBytes } = await storeAndRead(input, "dish.webp", "image/webp");
    expect(Array.from(storedBytes)).toEqual(Array.from(webp(vp8x(0), WEBP_VP8)));
  });

  it("stores a WebP with a chunk running past the RIFF size unchanged", async () => {
    const input = webp(vp8x(VP8X_XMP), WEBP_VP8, WEBP_XMP.subarray(0, 12));
    const { file, stored } = await storeAndRead(input, "dish.webp", "image/webp");
    expect(stored).toBe(file);
  });

  it("stores a WebP whose tail is too short for a chunk header unchanged", async () => {
    const input = webp(WEBP_VP8, WEBP_XMP, textEncoder.encode("XMP "));
    const { file, stored } = await storeAndRead(input, "dish.webp", "image/webp");
    expect(stored).toBe(file);
  });

  it("strips a metadata chunk that sits in a simple-format file without VP8X", async () => {
    const input = webp(WEBP_VP8, WEBP_XMP);
    const { storedBytes } = await storeAndRead(input, "dish.webp", "image/webp");
    expect(Array.from(storedBytes)).toEqual(Array.from(webp(WEBP_VP8)));
  });
});

// --- JPEG APP13 (IPTC) -----------------------------------------------------

describe("JPEG IPTC metadata stripping on upload", () => {
  it("stores a JPEG too short to hold a segment unchanged", async () => {
    const { file, stored } = await storeAndRead(new Uint8Array([0xff, 0xd8, 0xff]), "dish.jpg", "image/jpeg");
    expect(stored).toBe(file);
  });

  it("drops APP13 (Photoshop IPTC) segments as well as APP1", async () => {
    const segment = (marker: number, payload: string) => {
      const data = textEncoder.encode(payload);
      return new Uint8Array([0xff, marker, ((data.length + 2) >> 8) & 0xff, (data.length + 2) & 0xff, ...data]);
    };
    const scan = new Uint8Array([0xff, 0xda, 0x00, 0x02, 0x11, 0x22]);
    const app0 = segment(0xe0, "JFIF\0public");
    const input = concat(new Uint8Array([0xff, 0xd8]), app0, segment(0xed, "Photoshop 3.0\x008BIM City: Private Town"), scan);

    const { storedBytes } = await storeAndRead(input, "dish.jpg", "image/jpeg");

    expect(Array.from(storedBytes)).toEqual(Array.from(concat(new Uint8Array([0xff, 0xd8]), app0, scan)));
  });
});
