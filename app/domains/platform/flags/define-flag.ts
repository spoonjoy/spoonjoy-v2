// Every flag lives in its own file in ./flags, so two features never edit the same lines to declare their flags.
// A flag file adds its name to DeclaredFlags (which makes FlagName) and default-exports defineFlag(name, description).

/** One key per declared flag; each file in ./flags adds its own. */
export interface DeclaredFlags {}

/** The name of a flag some file in ./flags declares. */
export type FlagName = keyof DeclaredFlags & string;

export interface FlagDeclaration<Name extends string = FlagName> {
  name: Name;
  /** What the flag hides, in one line. */
  description: string;
}

/** Declares the flag a file in ./flags is named after. */
export function defineFlag<Name extends FlagName>(name: Name, description: string): FlagDeclaration<Name> {
  return { name, description };
}
