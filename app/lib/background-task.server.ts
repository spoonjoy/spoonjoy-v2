export function deferBackgroundTask<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0)).then(task);
}
