// Which browser messages report a React hydration mismatch, or another error React recovered from
// by rendering on the client instead. Kept free of Playwright so the unit tests can check it.
//
// A development build names the problem ("Hydration failed because ...", "A tree hydrated but some
// attributes ... didn't match", "There was an error while hydrating", "recoverable error"); a
// production build, as QA runs, reports React's minified error codes instead: 418 (the server HTML
// didn't match), 419/421/422/423 (a boundary or root fell back to client rendering) and 425 (text
// content didn't match), as "Minified React error #418" with a react.dev/errors/418 link.
const HYDRATION_ERROR_PATTERNS = [
  /hydrat/i,
  /recoverable error/i,
  /server rendered (?:HTML|text) didn't match/i,
  /Minified React error #(?:418|419|421|422|423|425)\b/,
  /react\.dev\/errors\/(?:418|419|421|422|423|425)\b/,
];

/** The messages that report a React hydration or recoverable error. */
export function hydrationErrorMessages(messages: readonly string[]): string[] {
  return messages.filter((message) => HYDRATION_ERROR_PATTERNS.some((pattern) => pattern.test(message)));
}
