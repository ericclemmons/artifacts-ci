export function requiredBinding<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`Missing required binding: ${name}`);
  }

  return value;
}
