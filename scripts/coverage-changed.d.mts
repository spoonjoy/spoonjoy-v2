export function globToRegExp(glob: string): RegExp;
export function changedCoverageFiles(
  changed: readonly string[] | string | undefined,
  options: { include: readonly string[]; exclude: readonly string[]; exists?: (file: string) => boolean },
): string[];
