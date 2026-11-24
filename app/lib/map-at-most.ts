// Runs async work over a list with a cap on how much runs at once, keeping the answers in order.

/**
 * `work` on each item, at most `limit` at once, the answers in the items' order. Once one item's work throws, no more
 * items are started, and the error is passed on when the work already started has settled.
 */
export async function mapAtMost<T, R>(limit: number, items: readonly T[], work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const answers = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (next < items.length && !failed) {
      const index = next++;
      try {
        answers[index] = await work(items[index], index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return answers;
}
