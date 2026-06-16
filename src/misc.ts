export function toArray<T>(args: T | T[]): T[] {
  return Array.isArray(args) ? args : [args];
}

type Reflected<T> = { value: T } | { error: unknown };

const reflect = <T>(p: Promise<T>): Promise<Reflected<T>> =>
  p.then(
    (value): Reflected<T> => ({ value }),
    (error): Reflected<T> => ({ error })
  );

export function promiseAll<T>(promises: Promise<T>[]): Promise<T[]> {
  return Promise.all(promises.map(reflect)).then(results => {
    const error = results.find((result): result is { error: unknown } => 'error' in result);
    if (error) {
      throw error.error;
    } else {
      return results.map(result => (result as { value: T }).value);
    }
  });
}
