// Shopping-list lines: the rows of one food whose amounts add up, shown as one line.
import { combineAmounts } from "~/domains/food-knowledge";

/**
 * One line per food and amount that add up: 1 cup and 100 ml of rice are one line of about 1.42 cups, whose
 * rowIds are both rows, in the first row's place. Rows whose amounts can't be added (a cup and 200 g) stay apart.
 * The line is checked only when all its rows are.
 */
export function mergeShoppingRows<
  T extends { id: string; ingredientRefId: string; quantity: number | null; unit?: { name: string } | null; checked: boolean },
>(items: T[]): Array<T & { rowIds: string[] }> {
  const lines: Array<{ rows: T[]; quantity: number | null }> = [];
  for (const item of items) {
    const amount = { quantity: item.quantity, unit: item.unit?.name };
    const line = lines.find(({ rows }) => {
      if (rows[0].ingredientRefId !== item.ingredientRefId) return false;
      return combineAmounts([...rows.map((other) => ({ quantity: other.quantity, unit: other.unit?.name })), amount]) !== null;
    });
    if (line) {
      line.rows.push(item);
      line.quantity = combineAmounts(line.rows.map((other) => ({ quantity: other.quantity, unit: other.unit?.name })))!.quantity;
    } else {
      lines.push({ rows: [item], quantity: item.quantity });
    }
  }
  return lines.map(({ rows, quantity }) => ({
    ...rows[0],
    quantity,
    checked: rows.every((other) => other.checked),
    rowIds: rows.map((other) => other.id),
  }));
}
