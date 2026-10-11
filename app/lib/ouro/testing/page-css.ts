export function pageCss(): string {
  return [...document.querySelectorAll("style")].map((style) => style.textContent).join("\n");
}
