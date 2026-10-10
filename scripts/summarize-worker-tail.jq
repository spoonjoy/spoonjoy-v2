# Reduces a `wrangler tail --format json` stream (slurped with `jq -s`) to the small summary the
# Journeys workflow uploads inside its public report artifact.
#
# The output is an allowlist. Nothing from a request's headers (Cookie, Authorization), `cf`
# object, body or `logs`, and no query string, is ever copied. The only free text, exception
# messages, is redacted and capped at 200 characters. test/scripts/summarize-worker-tail.test.ts
# locks the allowlist and the redaction against hostile sample events.
#
# Usage: jq -s --argjson tailAliveAtStop <true|false> -f scripts/summarize-worker-tail.jq <events>
#   tailAliveAtStop: whether the tail process was still running when the suite finished. When it
#   was not, or no events arrived, the summary is marked `complete: false`: treat it as no
#   evidence, not as a run without Worker-side failures.

# The URL's path: scheme, authority (including any user:pass@), query and fragment removed.
def request_path:
  (.event.request.url // "")
  | tostring
  | sub("^[A-Za-z][A-Za-z0-9+.-]*://[^/]*"; "")
  | sub("[?#].*$"; "");

# Free text from an exception message, with anything that could carry a credential, request
# data or personal data replaced: quoted values (V8's JSON.parse errors quote the parsed text,
# which can be a request body; Prisma errors quote query arguments), query strings,
# cookie-shaped name=value pairs, bearer and Spoonjoy tokens, email addresses, and long base64-
# or hex-looking strings. Capped at 200 characters.
def redact_message:
  tostring
  | gsub("\"[^\"]+\""; "\"[redacted]\"")
  | gsub("'[^']{4,}'"; "'[redacted]'")
  | gsub("\\?[^\\s\"'<>)]*"; "?[query]")
  | gsub("(?i)\\bbearer\\s+[^\\s\"',;]+"; "Bearer [token]")
  | gsub("\\bsj_[A-Za-z0-9_-]+"; "[token]")
  | gsub("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}"; "[email]")
  | gsub("\\b[A-Za-z0-9_.-]+=[^;\\s,]*;"; "[cookie];")
  | gsub("\\b__(?:session|oauth)=[^;\\s,]*"; "[cookie]")
  | gsub("[A-Za-z0-9+/_-]{24,}={0,2}"; "[token]")
  | .[0:200];

def invocation: {
  outcome: (.outcome // null),
  path: request_path,
  method: (.event.request.method // null),
  status: (.event.response.status // null),
  cpuTime: (.cpuTime // null),
  wallTime: (.wallTime // null),
  eventTimestamp: (.eventTimestamp // null),
  exceptions: [(.exceptions // [])[] | { name: ((.name // null) | if . == null then null else tostring | .[0:100] end), message: ((.message // "") | redact_message) }]
};

# A path with per-run ids collapsed to :id (cuid, uuid, number, codex-e2e user), keeping a
# trailing .data, so invocations of the same route group together.
def collapse_segment:
  capture("^(?<base>.*?)(?<ext>\\.data)?$") as $m
  | ($m.base
      | if test("^c[a-z0-9]{20,}$")
          or test("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
          or test("^[0-9]+$")
          or test("^codex[-_]e2e[-_]")
        then ":id" else . end)
    + ($m.ext // "");

def path_pattern: request_path | split("/") | map(if . == "" then . else collapse_segment end) | join("/");

# Nearest-rank percentile over the numeric values present; null when there are none.
def percentile($p): if length == 0 then null else sort | .[((length - 1) * $p | floor)] end;

def timing($field): [.[] | .[$field] | select(type == "number")]
  | { p50: percentile(0.5), p95: percentile(0.95), max: (if length == 0 then null else max end) };

def timestamps: [.[] | .eventTimestamp | select(type == "number")];

# The CPU time budget per request: the Workers Free plan stops an invocation after 10 ms of
# CPU (outcome `exceededCpu`, Error 1102), so a route whose p95 CPU is over it fails requests.
def cpu_budget_ms: 10;

def by_path: group_by(path_pattern)
  | map({ path: (.[0] | path_pattern), count: length, wallTime: timing("wallTime"), cpuTime: timing("cpuTime") })
  | sort_by(-(.wallTime.p95 // 0));

{
  complete: ($tailAliveAtStop == true and length > 0),
  tailAliveAtStop: ($tailAliveAtStop == true),
  firstEventTimestamp: (timestamps | if length == 0 then null else min end),
  lastEventTimestamp: (timestamps | if length == 0 then null else max end),
  totalInvocations: length,
  outcomes: (map(.outcome // "unknown") | group_by(.) | map({ key: .[0], value: length }) | from_entries),
  nonOkInvocations: [.[] | select((.outcome // "unknown") != "ok") | invocation],
  # Every 5xx response, whatever the outcome: React Router answers a loader or action error with
  # a 500 while the invocation itself ends "ok", so nonOkInvocations alone misses it. First 50.
  serverErrorInvocations: ([.[] | select((.event.response.status // 0) >= 500) | invocation] | .[0:50]),
  # Requests the Workers runtime canceled because the Worker's code "had hung and would never
  # generate a response" (a 500 with Error 1101 to the browser), whatever the outcome.
  hungInvocations: ([.[] | select(any((.exceptions // [])[]; (.message // "") | tostring | test("code had hung|would never generate a response")))] | length),
  # Requests that waited over 2 s on under 5 ms of CPU: stuck on a promise or on I/O, not working.
  stalledInvocations: ([.[] | select((.cpuTime | type) == "number" and (.wallTime | type) == "number" and .cpuTime < 5 and .wallTime > 2000)] | length),
  firstExceptions: ([.[] | select(((.exceptions // []) | length) > 0) | invocation] | .[0:20]),
  slowest: ([.[] | select((.wallTime | type) == "number")] | sort_by(-.wallTime) | .[0:25] | map(invocation)),
  byPath: by_path,
  # Routes whose p95 CPU time is over the budget, worst first. The Journeys workflow prints
  # each as a warning; it does not fail the run.
  budget: {
    cpuTimeP95Ms: cpu_budget_ms,
    overBudget: (by_path
      | map(select((.cpuTime.p95 // 0) > cpu_budget_ms) | { path, count, cpuTime })
      | sort_by(-.cpuTime.p95, .path))
  }
}
