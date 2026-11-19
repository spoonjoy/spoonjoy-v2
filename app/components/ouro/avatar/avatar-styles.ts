export { groupChatWith };

// Shared helpers for Avatar and the components that draw one. They live apart from the
// components so each component file exports only components, which React Fast Refresh needs.
// The export list comes first because the shadcn CLI drops comments before a file's first statement.

/**
 * What screen readers hear after a group chat's name: who is in it, the first two by name and the
 * rest as a count ("group chat with Captain Nemo, Professor Aronnax and 2 others"). Shared with
 * `ConversationList`.
 *
 * @internal
 * @claim "the first two by name and the rest as a count" registry/ouro/components/ouro/avatar/avatar.test.tsx verify:testExists(registry/ouro/components/ouro/avatar/avatar.test.tsx::Avatar group chats > says the group's name and who is in it)
 */
function groupChatWith(names: readonly string[]): string {
  const [a, b, c] = names;
  if (names.length === 1) return `group chat with ${a}`;
  if (names.length === 2) return `group chat with ${a} and ${b}`;
  if (names.length === 3) return `group chat with ${a}, ${b} and ${c}`;
  return `group chat with ${a}, ${b} and ${names.length - 2} others`;
}
