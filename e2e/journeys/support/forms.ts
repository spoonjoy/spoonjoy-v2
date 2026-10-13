// A required field's label carries Ouro UI's marker, "*", in its text, so Playwright's
// getByLabel(label, { exact: true }) needs it: the marker is hidden from screen readers but
// getByLabel matches on the label's text. Without `exact`, getByLabel("Password") also finds the
// field's own "Show password" button.
export function requiredLabel(label: string): string {
  return `${label}*`;
}
