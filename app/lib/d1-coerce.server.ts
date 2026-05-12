export function toNumber(value: bigint | number): number {
  return typeof value === "bigint" ? Number(value) : value;
}

export function toDate(value: bigint | number | string | Date): Date {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "bigint") {
    return new Date(Number(value));
  }

  return new Date(value);
}
