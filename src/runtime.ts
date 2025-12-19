const fail = Symbol();
type Type<T> = (value: unknown) => T | typeof fail;

export function t_assert<T>(value: unknown, check: Type<T>): T {
  const result = check(value);
  if (result === fail) throw new Error("Runtime type failure");
  return result;
}

export const t_literal = <T>(literal: T): Type<T> => (value: unknown) => {
  if (value === literal) return literal;
  return fail;
};

export const t_string: Type<string> = (value: unknown) => {
  if (typeof value === "string") return value;
  return fail;
};

export const t_undefined: Type<undefined> = (value: unknown) => {
  if (value === undefined) return value;
  return fail;
};

export const t_null: Type<null> = (value: unknown) => {
  if (value === null) return value;
  return fail;
};

export const t_boolean: Type<boolean> = (value: unknown) => {
  if (typeof value === "boolean") return value;
  return fail;
};

export const t_number: Type<number> = (value: unknown) => {
  if (typeof value === "number") return value;
  return fail;
};

export const t_or = <T>(...types: Type<T>[]): Type<T> => (value: unknown) => {
  for (const type of types) {
    const result = type(value);
    if (result !== fail) return value as T;
  }
  return fail;
};

export const t_object = <T extends object>(
  shape: Record<string, Type<unknown>>,
  optionalKeys: string[] = [],
): Type<T> => {
  const optional = new Set(optionalKeys);
  return (value: unknown) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return fail;
    }
    for (const [key, check] of Object.entries(shape)) {
      const hasKey = Object.prototype.hasOwnProperty.call(value, key);
      if (!hasKey && !optional.has(key)) return fail;
      if (hasKey && check((value as Record<string, unknown>)[key]) === fail) {
        return fail;
      }
    }
    return value as T;
  };
};

export const t_ignore = (value: unknown) => {
  return value;
};
