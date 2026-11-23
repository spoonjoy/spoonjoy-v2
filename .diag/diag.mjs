import { Miniflare, fetch as mfFetch } from "miniflare";
const script = `export default { async fetch() {
  const out = [];
  for (const [name, url, headers] of [
    ["apple", "https://appleid.apple.com/auth/keys", { Accept: "application/json", "User-Agent": "Spoonjoy" }],
    ["echo", "https://httpbin.org/anything", { Accept: "application/json", "User-Agent": "Spoonjoy" }],
  ]) {
    try { const r = await fetch(url, { headers }); out.push(name + "=" + r.status + " " + (await r.text()).replace(/\\s+/g, " ").slice(0, 700)); }
    catch (e) { out.push(name + "=ERR " + e.message); }
  }
  return new Response(out.join("\\n"));
} }`;
for (const [label, extra] of [["direct", {}], ["outbound", { outboundService: (req) => { console.log("OUTBOUND", req.url, JSON.stringify([...req.headers])); return mfFetch(req); } }]]) {
  const mf = new Miniflare({ modules: true, port: 0, compatibilityDate: "2024-12-01", compatibilityFlags: ["nodejs_compat"], script, ...extra });
  const r = await mf.dispatchFetch("http://x/");
  console.log("DIAG", label, await r.text());
  await mf.dispose();
}
const n = await fetch("https://appleid.apple.com/auth/keys", { headers: { Accept: "application/json", "User-Agent": "Spoonjoy" } });
console.log("DIAG node-global", n.status);
const m = await mfFetch("https://appleid.apple.com/auth/keys", { headers: { Accept: "application/json", "User-Agent": "Spoonjoy" } });
console.log("DIAG miniflare-fetch", m.status);
