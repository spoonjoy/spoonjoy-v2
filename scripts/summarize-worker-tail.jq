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
#   tailReconnects: how many times the tail had to reconnect after its connection dropped
#   (default 0). Events between connections are lost, so a reconnected tail is incomplete too.
#
# Whatever the switches, `d1TransientErrors` counts the log lines whose message is a
# d1_transient_error report (app/lib/d1-transient-retry.server.ts) or a d1_write_retry report
# (app/lib/d1-write-retry.server.ts): only their fixed fields are read, and only counts leave the
# program, and so does `d1ReadReissues` for the d1_read_reissue lines. Likewise `stalledRequests`,
# `slowCalls` and `isolates` read only the fixed fields of the slow_call, isolate_request and
# isolate_colo lines (app/lib/slow-call.server.ts) a per-run QA Worker writes, each checked
# against its expected shape.

def keep_error_logs: ($ARGS.named.keepErrorLogs == true);
def tail_reconnects: ($ARGS.named.tailReconnects // 0 | if type == "number" then . else 0 end);

# The d1_transient_error reports in an event's log lines, at any level, with only their fixed
# fields: operation ("read" or "write") and willRetry.
def d1_transient_reports:
  [(.logs // []) | if type == "array" then .[] else empty end | select(type == "object")
    | (.message // []) | if type == "array" then .[] else . end
    | (if type == "string" then (try fromjson catch null) else . end)
    | select(type == "object" and .event == "d1_transient_error")
    | { operation: (if .operation == "read" then "read" else "write" end), willRetry: (.willRetry == true) }];

# The d1_write_retry reports in an event's log lines: what a write operation did after one of its
# tries failed with a transient D1 error, with only the fixed outcome field.
def d1_write_retry_reports:
  [(.logs // []) | if type == "array" then .[] else empty end | select(type == "object")
    | (.message // []) | if type == "array" then .[] else . end
    | (if type == "string" then (try fromjson catch null) else . end)
    | select(type == "object" and .event == "d1_write_retry")
    | { outcome: (if .outcome == "retry" or .outcome == "applied" or .outcome == "gave_up" then .outcome else "other" end) }];

# The slow_call reports in an event's log lines (app/lib/slow-call.server.ts): a D1 call or a
# cook-session Durable Object call that waited past its threshold, with only their fixed fields, each
# checked against the shape the Worker writes.
def ident: if type == "string" and test("^[A-Za-z_][A-Za-z0-9_.]{0,63}$") then . else null end;
def count_or_null: if type == "number" and . >= 0 then floor else null end;
def slow_call_reports:
  [(.logs // []) | if type == "array" then .[] else empty end | select(type == "object")
    | (.message // []) | if type == "array" then .[] else . end
    | (if type == "string" then (try fromjson catch null) else . end)
    | select(type == "object" and .event == "slow_call")
    | { call: (.call | ident),
        operation: (if .operation == "read" or .operation == "write" then .operation else null end),
        table: (.table | ident),
        attempt: (.attempt | count_or_null),
        waitedMs: (.waitedMs | count_or_null),
        settled: (.settled == true),
        outcome: (if .outcome == "ok" or .outcome == "error" then .outcome else null end) }];

# The d1_read_reissue reports (app/lib/d1-transient-retry.server.ts): a read-only D1 try that had
# not settled by its deadline and was sent once more, with only which try answered first, or
# "neither" when both failed.
def d1_read_reissue_reports:
  [(.logs // []) | if type == "array" then .[] else empty end | select(type == "object")
    | (.message // []) | if type == "array" then .[] else . end
    | (if type == "string" then (try fromjson catch null) else . end)
    | select(type == "object" and .event == "d1_read_reissue")
    | { answeredBy: (if .answeredBy == "original" or .answeredBy == "reissue" or .answeredBy == "neither" then .answeredBy else "other" end) }];

# The isolate_request and isolate_colo lines a per-run QA Worker writes (app/lib/slow-call.server.ts):
# which isolate served the request, its count of requests, the location the request arrived at,
# and, once per isolate, the location the isolate runs in. Each field is checked against its shape.
def isolate_id: if type == "string" and test("^[0-9a-f]{8}$") then . else null end;
def colo_or_null: if type == "string" and test("^[A-Z]{3,4}$") then . else null end;
def log_objects($event):
  [(.logs // []) | if type == "array" then .[] else empty end | select(type == "object")
    | (.message // []) | if type == "array" then .[] else . end
    | (if type == "string" then (try fromjson catch null) else . end)
    | select(type == "object" and .event == $event)];
def isolate_request_of:
  (log_objects("isolate_request") | first)
  | if . == null then null
    else { isolate: (.isolate | isolate_id), request: (.request | count_or_null), arrivedAt: (.arrivedAt | colo_or_null) } end;
def isolate_colos:
  [.[] | log_objects("isolate_colo")[] | { isolate: (.isolate | isolate_id), runsIn: (.runsIn | colo_or_null) } | select(.isolate != null)]
  | map({ key: .isolate, value: .runsIn }) | from_entries;

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
# app/lib/qa-error-logs.server.ts repeats these rules in TypeScript for the QA Worker's own error
# log line; test/lib/qa-error-logs.server.test.ts keeps the two identical.
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
  # Whether a Worker request or a Durable Object ran ("stateless", "durableObject"), and which
  # class: fixed identifiers from Cloudflare, null when absent or not an identifier.
  executionModel: (.executionModel | ident),
  entrypoint: (.entrypoint | ident),
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
def percentile($p): if length == 0 then null else sort | .[((length * $p | ceil) - 1)] end;

def timing($field): [.[] | .[$field] | select(type == "number")]
  | { p50: percentile(0.5), p95: percentile(0.95), max: (if length == 0 then null else max end) };

def timestamps: [.[] | .eventTimestamp | select(type == "number")];

# The CPU time budget per request: the Workers Free plan stops an invocation after 10 ms of
# CPU (outcome `exceededCpu`, Error 1102), so a route whose p95 CPU is over it fails requests.
def cpu_budget_ms: 10;

def by_path: group_by(path_pattern)
  | map({ path: (.[0] | path_pattern), count: length, wallTime: timing("wallTime"), cpuTime: timing("cpuTime") })
  | sort_by(-(.wallTime.p95 // 0));

def stalled: (.cpuTime | type) == "number" and (.wallTime | type) == "number" and .cpuTime < 5 and .wallTime > 2000;

. as $events
| ($events | isolate_colos) as $runsIn
| def where_it_ran: isolate_request_of | if . == null then null else . + { runsIn: $runsIn[.isolate // ""] } end;
  def with_wait_evidence: invocation + { ranOn: where_it_ran, slowCalls: (slow_call_reports | .[0:10]) };
  ([range(0; $events | length) | select(($events[.].event.response.status // 0) >= 500)] | .[0:50]) as $serverErrorIndexes
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
  complete: ($tailAliveAtStop == true and length > 0 and tail_reconnects == 0),
  tailAliveAtStop: ($tailAliveAtStop == true),
  tailReconnects: tail_reconnects,
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
  stalledInvocations: ([.[] | select(stalled)] | length),
  # The first 20 of them, each with where it ran and the calls it reported waiting on, so a stall
  # names the D1 call (and table) or the Durable Object call that held it. A stall with no slow
  # call waited somewhere else.
  stalledRequests: ([.[] | select(stalled) | with_wait_evidence] | .[0:20]),
  # Every call that waited past its threshold, stalled request or not: how many, by call, and the first
  # 40 requests that made one.
  slowCalls: ([.[] | select(slow_call_reports | length > 0)] as $slow
    | [$slow[] | slow_call_reports[] | select(.settled | not)] as $waits
    | { total: ($waits | length),
        byCall: ($waits | map(.call // "unknown") | group_by(.) | map({ key: .[0], value: length }) | from_entries),
        requests: ([$slow[] | with_wait_evidence] | .[0:40]) }),
  # The isolates that served requests, in order of first request (at most 50): where requests
  # reached them, where they ran, and when, so cold isolates and Smart Placement moves can be lined
  # up with the stalls. An isolate whose runsIn differs from arrivedAt served requests that Smart
  # Placement moved.
  isolates: ([.[] | { eventTimestamp: (.eventTimestamp // null), where: isolate_request_of } | select(.where.isolate != null)]
    | group_by(.where.isolate)
    | map({ isolate: .[0].where.isolate, runsIn: $runsIn[.[0].where.isolate],
            arrivedAt: ([.[] | .where.arrivedAt | select(. != null)] | unique),
            requests: length,
            firstEventTimestamp: ([.[] | .eventTimestamp | select(type == "number")] | min),
            lastEventTimestamp: ([.[] | .eventTimestamp | select(type == "number")] | max) })
    | sort_by(.firstEventTimestamp // 0) | .[0:50]),
  firstExceptions: [$exceptionIndexes[] | with_error_logs(.)],
  # Transient D1 failures the Worker reported: retried ones a later attempt may have absorbed,
  # and ones that reached the caller (a write whose outcome is unknown, or a read out of retries).
  # A write the binding did not retry may still be handled by its operation (`retryD1Write`),
  # which runs it again only when that is safe, or finds that the failed try had committed;
  # `writeOperations` counts those decisions. `notRetriedWrites` is the writes nothing handled:
  # the binding's unretried writes less the failures an operation handled (each such failure is
  # one of them, unless it was a read out of retries inside the operation), never below zero.
  # docs/d1-write-retry.md lists how each write is made safe and the cases left on purpose.
  d1TransientErrors: ([.[] | d1_transient_reports[]] as $reports
    | ([.[] | d1_write_retry_reports[]] as $operations
    | ([$reports[] | select((.willRetry | not) and .operation == "write")] | length) as $unretriedWrites
    | { total: ($reports | length),
        retried: ([$reports[] | select(.willRetry)] | length),
        notRetried: ([$reports[] | select(.willRetry | not)] | length),
        notRetriedWrites: ([$unretriedWrites - ($operations | length), 0] | max),
        writeOperations: {
          retried: ([$operations[] | select(.outcome == "retry")] | length),
          applied: ([$operations[] | select(.outcome == "applied")] | length),
          gaveUp: ([$operations[] | select(.outcome == "gave_up")] | length) } })),
  # Read-only D1 tries that stalled past their deadline and were sent again, and how many of them
  # the re-issued try answered, and how many failed both times.
  d1ReadReissues: ([.[] | d1_read_reissue_reports[]]
    | { total: length,
        answeredByReissue: ([.[] | select(.answeredBy == "reissue")] | length),
        failedBoth: ([.[] | select(.answeredBy == "neither")] | length) }),
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
