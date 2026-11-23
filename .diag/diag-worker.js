export default {
  async fetch() {
    const url = "https://appleid.apple.com/auth/keys";
    const variants = {
      bare: {},
      accept: { Accept: "application/json" },
      uaSpoonjoy: { Accept: "application/json", "User-Agent": "Spoonjoy" },
      uaNode: { Accept: "*/*", "User-Agent": "node", "Accept-Language": "*", "Accept-Encoding": "gzip, deflate" },
      uaCurl: { Accept: "*/*", "User-Agent": "curl/8.5.0" },
      uaBrowser: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36" },
    };
    const out = [];
    for (const [name, headers] of Object.entries(variants)) {
      try {
        const r = await fetch(url, { headers });
        out.push(`${name}=${r.status}`);
      } catch (e) { out.push(`${name}=ERR ${e.message}`); }
    }
    const echo = await fetch("https://httpbin.org/headers").then((r) => r.text()).catch((e) => "echo ERR " + e.message);
    return new Response(out.join(" ") + "\n" + echo.replace(/\s+/g, " "));
  },
};
