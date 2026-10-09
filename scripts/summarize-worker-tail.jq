# Reduces a `wrangler tail --format json` stream (slurped with `jq -s`) to the small summary the
# Journeys workflow uploads inside its public report artifact.
#
# The output is an allowlist. Nothing from a request's headers (Cookie, Authorization), `cf`
# object or body, and no query string, is ever copied. By default no log line is copied either.
# The only free text, exception messages, is scrubbed and capped at 200 characters.
# test/scripts/summarize-worker-tail.test.ts locks the allowlist and the scrubbing against hostile
# sample events.
#
# Usage: jq -s --argjson tailAliveAtStop <true|false> [--argjson keepErrorLogs true] \
#          -f scripts/summarize-worker-tail.jq <events>
#   tailAliveAtStop: whether the tail process was still running when the suite finished. When it
#   was not, or no events arrived, the summary is marked `complete: false`: treat it as no
#   evidence, not as a run without Worker-side failures.
#   keepErrorLogs: for a per-run QA Worker only (the Journeys workflow passes it). Attaches the
#   invocation's error-level log lines (`logs[].level == "error"`), each reduced to the exception
#   class, a scrubbed message and at most 5 scrubbed stack frames, to the entries in
#   serverErrorInvocations and firstExceptions, at most 3 per invocation and 40 in all, and adds
#   an `errorLogs` count. React Router turns a loader or action error into a 500 that ends "ok",
#   and logs the error with console.error, so that line is the only record of the exception.
#   Without the switch (a production tail, or any other caller) no log line is kept.

def keep_error_logs: ($ARGS.named.keepErrorLogs == true);

# The URL's path: scheme, authority (including any user:pass@), query and fragment removed.
def request_path:
  (.event.request.url // "")
  | tostring
  | sub("^[A-Za-z][A-Za-z0-9+.-]*://[^/]*"; "")
  | sub("[?#].*$"; "");

# Free text, with anything that could carry a credential, request data or personal data replaced:
# quoted values (V8's JSON.parse errors quote the parsed text, which can be a request body; Prisma
# errors quote query arguments), Cookie and Set-Cookie headers, Authorization headers, bearer
# tokens, Spoonjoy tokens (API tokens sj_, agent device codes sjdc_, OAuth codes oac_, connection
# keys ocn_, refresh tokens ort_, client tokens oct_, connection ids conn_), JWTs, URL user info,
# query strings and fragments (a URL keeps its host and path), email addresses, cookie-shaped
# name=value pairs and long base64- or hex-looking strings. Line breaks become spaces. Capped at
# $cap characters, after scrubbing, so a cut can never expose part of a secret.
def scrub($cap):
  tostring
  | gsub("\"[^\"]+\""; "\"[redacted]\"")
  | gsub("'[^']{4,}'"; "'[redacted]'")
  | gsub("(?i)\\b(?<h>(?:set-)?cookie):[^\\n]*"; "\(.h): [cookie]")
  | gsub("(?i)\\bauthorization:\\s*(?!bearer\\b)(?:[A-Za-z]+\\s+)?[^\\s\"',;]+"; "Authorization: [token]")
  | gsub("(?<s>[A-Za-z][A-Za-z0-9+.-]*://)[^/\\s@\"'<>]*@"; "\(.s)[userinfo]@")
  | gsub("\\?[^\\s\"'<>)]*"; "?[query]")
  | gsub("(?<=[A-Za-z0-9/._~-])#[^\\s\"'<>)]+"; "#[fragment]")
  | gsub("(?i)\\bbearer\\s+[^\\s\"',;]+"; "Bearer [token]")
  | gsub("\\b(?:sj|sjdc|oac|ocn|ort|oct|conn)_[A-Za-z0-9_-]+"; "[token]")
  | gsub("\\beyJ[A-Za-z0-9_-]*\\.[A-Za-z0-9_.-]*"; "[token]")
  | gsub("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}"; "[email]")
  | gsub("\\b[A-Za-z0-9_.-]+=[^;\\s,]*;"; "[cookie];")
  | gsub("\\b__[A-Za-z][A-Za-z0-9_]*=[^;\\s,]*"; "[cookie]")
  | gsub("[A-Za-z0-9+/_-]{24,}={0,2}"; "[token]")
  | gsub("\\s*\\n\\s*"; " ")
  | .[0:$cap];

# An exception message: scrubbed and capped at 200 characters.
def redact_message: scrub(200);

# --- Error-level log lines (only with keepErrorLogs) ---

def frame_line: test("^\\s*at\\s");

# A logged error's text ("Name: message" then "    at ..." frames), split into class, message
# and frames. Text with no "Name:" prefix keeps a null class and the whole text as the message.
def error_from_text:
  tostring
  | (split("\n") | map(select(test("\\S")))) as $lines
  | ([$lines[] | select(frame_line | not)] | join("\n")) as $head
  | (($head | capture("^\\s*(?<name>(?:[A-Za-z_$][A-Za-z0-9_$.]*)?(?:Error|Exception)):\\s?(?<message>[\\s\\S]*)$")) // null) as $m
  | { name: ($m.name // null),
      message: (if $m == null then $head else $m.message end),
      stack: [$lines[] | select(frame_line) | sub("^\\s+"; "")] };

# A structured value (a parsed JSON log line, or an object the tail passes through): the first
# nested object with a string stack, else with a string message. Null when there is none.
def error_from_object:
  (([.. | objects | select((.stack | type) == "string")] | first)
    // ([.. | objects | select((.message | type) == "string")] | first)) as $e
  | if $e == null then null
    else (if ($e.stack | type) == "string" then $e.stack | error_from_text else { name: null, message: null, stack: [] } end) as $t
      | { name: (if ($e.name | type) == "string" then $e.name else $t.name end),
          message: (if ($e.message | type) == "string" then $e.message else $t.message end),
          stack: $t.stack }
    end;

# One argument of a console.error call. A string that holds JSON (an object, or a string that
# itself holds JSON) is parsed first, so an error nested in a structured log line is found.
def error_from_value:
  if type == "string" then
    ((try fromjson catch null) as $json
      | if ($json | type) == "object" or ($json | type) == "array" then ($json | error_from_object) // error_from_text
        elif ($json | type) == "string" then $json | error_from_value
        else error_from_text end)
  elif type == "object" or type == "array" then error_from_object // { name: null, message: tojson, stack: [] }
  else { name: null, message: tostring, stack: [] } end;

# An exception class: kept as is when it is an identifier ending in Error or Exception (the long-
# token rule would otherwise eat a name like PrismaClientKnownRequestError), scrubbed otherwise.
def error_class:
  if test("^[A-Za-z_$][A-Za-z0-9_$.]{0,80}(?:Error|Exception)$") and (test("^(?:sj|sjdc|oac|ocn|ort|oct|conn)_|^eyJ") | not)
  then . else scrub(100) end;

# A log entry reduced to the exception class (first one found), the scrubbed message of its
# arguments (500 characters at most) and at most 5 scrubbed stack frames.
def log_line:
  [(.message // []) | if type == "array" then .[] else . end | error_from_value] as $parts
  | { name: ([$parts[] | .name | select(. != null)] | first | if . == null then null else error_class end),
      message: ([$parts[] | .message | select(. != null and . != "") | tostring] | join(" ") | scrub(500)),
      stack: ([$parts[] | .stack[]] | .[0:5] | map(scrub(200))) };

def error_log_lines: [(.logs // []) | if type == "array" then .[] else empty end | select(type == "object" and .level == "error") | log_line];

def per_invocation_log_cap: 3;
def total_log_cap: 40;

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

. as $events
| ([range(0; $events | length) | select(($events[.].event.response.status // 0) >= 500)] | .[0:50]) as $serverErrorIndexes
| ([range(0; $events | length) | select((($events[.].exceptions // []) | length) > 0)] | .[0:20]) as $exceptionIndexes
# With keepErrorLogs: the error-level lines of each invocation in either list, in stream order, at
# most per_invocation_log_cap per invocation and total_log_cap in all. An invocation in both lists
# counts once.
| (if keep_error_logs then
     reduce ([$serverErrorIndexes[], $exceptionIndexes[]] | unique)[] as $index
       ({ lines: {}, kept: 0, droppedOverCap: 0, invocations: 0 };
        . as $acc
        | ($events[$index] | error_log_lines) as $all
        | ($all | .[0:per_invocation_log_cap] | .[0:([total_log_cap - $acc.kept, 0] | max)]) as $keep
        | .lines[$index | tostring] = $keep
        | .kept += ($keep | length)
        | .droppedOverCap += (($all | length) - ($keep | length))
        | .invocations += (if ($keep | length) > 0 then 1 else 0 end))
   else null end) as $errorLogs
| def with_error_logs($index):
    $events[$index] | invocation + (if $errorLogs == null then {} else { errorLogs: ($errorLogs.lines[$index | tostring] // []) } end);
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
  # With keepErrorLogs, each entry here and in firstExceptions also has `errorLogs`.
  serverErrorInvocations: [$serverErrorIndexes[] | with_error_logs(.)],
  # Requests the Workers runtime canceled because the Worker's code "had hung and would never
  # generate a response" (a 500 with Error 1101 to the browser), whatever the outcome.
  hungInvocations: ([.[] | select(any((.exceptions // [])[]; (.message // "") | tostring | test("code had hung|would never generate a response")))] | length),
  # Requests that waited over 2 s on under 5 ms of CPU: stuck on a promise or on I/O, not working.
  stalledInvocations: ([.[] | select((.cpuTime | type) == "number" and (.wallTime | type) == "number" and .cpuTime < 5 and .wallTime > 2000)] | length),
  firstExceptions: [$exceptionIndexes[] | with_error_logs(.)],
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
+ (if $errorLogs == null then {} else { errorLogs: ($errorLogs | { kept, droppedOverCap, invocations, perInvocationCap: per_invocation_log_cap, totalCap: total_log_cap }) } end)
