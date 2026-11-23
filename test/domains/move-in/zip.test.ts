import { describe, expect, it } from "vitest";
import { ArchiveError, bytesSource, openZip } from "~/domains/move-in/adapters/archive/zip";
import { makeZip } from "./support/make-zip";

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

async function errorOf(promise: Promise<unknown>): Promise<ArchiveError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ArchiveError) return error;
    throw error;
  }
  throw new Error("expected an ArchiveError");
}

describe("openZip", () => {
  it("lists entries and reads deflated and stored ones", async () => {
    const zip = makeZip([
      { name: "database.json", data: '{"recipes":[]}' },
      { name: "data/recipes/a/images/original.webp", data: new Uint8Array([1, 2, 3]), store: true },
    ]);
    const archive = await openZip(bytesSource(zip));
    expect(archive.entries.map((entry) => entry.name)).toEqual(["database.json", "data/recipes/a/images/original.webp"]);
    expect(text(await archive.read(archive.get("database.json")!))).toBe('{"recipes":[]}');
    expect([...(await archive.read(archive.get("data/recipes/a/images/original.webp")!))]).toEqual([1, 2, 3]);
    expect(archive.get("missing")).toBeUndefined();
  });

  it("finds the end record behind a trailing comment", async () => {
    const archive = await openZip(bytesSource(makeZip([{ name: "a.txt", data: "hi" }], { comment: "made by hand" })));
    expect(text(await archive.read(archive.entries[0]))).toBe("hi");
  });

  it("reads only the ranges it needs", async () => {
    const zip = makeZip([{ name: "photo.webp", data: new Uint8Array(200_000), store: true }, { name: "b.txt", data: "b" }]);
    const reads: Array<[number, number]> = [];
    const source = bytesSource(zip);
    const archive = await openZip({ size: source.size, read: (offset, length) => (reads.push([offset, length]), source.read(offset, length)) });
    await archive.read(archive.get("b.txt")!);
    expect(reads.reduce((total, [, length]) => total + length, 0)).toBeLessThan(zip.length);
  });

  it("calls a file that is not a zip not-a-zip", async () => {
    expect((await errorOf(openZip(bytesSource(new TextEncoder().encode("hello, not a zip at all, sorry"))))).code).toBe("not-a-zip");
    expect((await errorOf(openZip(bytesSource(new Uint8Array(0))))).code).toBe("not-a-zip");
  });

  it("calls a cut-off zip not-a-zip", async () => {
    const zip = makeZip([{ name: "a.txt", data: "hi" }]);
    const cut = new Uint8Array([...zip.slice(0, 10), ...zip.slice(zip.length - 22)]);
    expect((await errorOf(openZip(bytesSource(cut))))).toMatchObject({ code: "not-a-zip" });
  });

  it("calls a local header that is not one not-a-zip", async () => {
    const zip = makeZip([{ name: "a.txt", data: "hi" }]);
    zip[0] = 0;
    const archive = await openZip(bytesSource(zip));
    expect((await errorOf(archive.read(archive.entries[0]))).code).toBe("not-a-zip");
  });

  it("refuses encrypted entries and unknown compression", async () => {
    const archive = await openZip(bytesSource(makeZip([
      { name: "secret.txt", data: "x", store: true, flags: 1 },
      { name: "bzip.txt", data: "x", method: 12 },
    ])));
    expect((await errorOf(archive.read(archive.get("secret.txt")!))).code).toBe("encrypted");
    expect((await errorOf(archive.read(archive.get("bzip.txt")!))).code).toBe("unsupported-compression");
  });

  it("refuses an entry larger than the caller allows", async () => {
    const archive = await openZip(bytesSource(makeZip([{ name: "big.txt", data: "x".repeat(2000) }])));
    expect((await errorOf(archive.read(archive.entries[0], { maxBytes: 1000 }))).code).toBe("entry-too-large");
  });

  it.each([
    ["entry count", 10, 2, 0xffff],
    ["directory size", 12, 4, 0xffffffff],
    ["directory offset", 16, 4, 0xffffffff],
  ])("refuses a zip64 archive it cannot read yet (%s)", async (_field, at, width, value) => {
    const zip = makeZip([{ name: "a.txt", data: "hi" }]);
    const view = new DataView(zip.buffer);
    if (width === 2) view.setUint16(zip.length - 22 + at, value, true);
    else view.setUint32(zip.length - 22 + at, value, true);
    expect((await errorOf(openZip(bytesSource(zip)))).code).toBe("too-large");
  });

  it("calls a directory that is too short or misspelled not-a-zip", async () => {
    const short = makeZip([{ name: "a.txt", data: "hi" }]);
    new DataView(short.buffer).setUint16(short.length - 22 + 10, 2, true);
    expect((await errorOf(openZip(bytesSource(short)))).code).toBe("not-a-zip");
    const misspelled = makeZip([{ name: "a.txt", data: "hi" }]);
    const directoryOffset = new DataView(misspelled.buffer).getUint32(misspelled.length - 22 + 16, true);
    misspelled[directoryOffset] = 0;
    expect((await errorOf(openZip(bytesSource(misspelled)))).code).toBe("not-a-zip");
  });

  it("calls an entry whose header lies past the end not-a-zip", async () => {
    const zip = makeZip([{ name: "a.txt", data: "hi" }]);
    const directoryOffset = new DataView(zip.buffer).getUint32(zip.length - 22 + 16, true);
    new DataView(zip.buffer).setUint32(directoryOffset + 42, zip.length - 10, true);
    const archive = await openZip(bytesSource(zip));
    expect((await errorOf(archive.read(archive.entries[0]))).code).toBe("not-a-zip");
  });

  it("calls a corrupt deflate stream not-a-zip", async () => {
    const zip = makeZip([{ name: "a.txt", data: "hello hello hello" }]);
    const archive = await openZip(bytesSource(zip));
    const dataStart = 30 + "a.txt".length;
    zip.fill(0xff, dataStart, dataStart + 4);
    expect((await errorOf(archive.read(archive.entries[0]))).code).toBe("not-a-zip");
  });
});
