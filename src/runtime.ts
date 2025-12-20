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

export const t_array = <T>(item: Type<T>): Type<T[]> => (value: unknown) => {
  if (!Array.isArray(value)) return fail;
  for (const element of value) {
    if (item(element) === fail) return fail;
  }
  return value as T[];
};

export const t_tuple = <T extends unknown[]>(
  items: Type<unknown>[],
): Type<T> => {
  return (value: unknown) => {
    if (!Array.isArray(value)) return fail;
    if (value.length !== items.length) return fail;
    for (let i = 0; i < items.length; i++) {
      if (items[i]!(value[i]) === fail) return fail;
    }
    return value as T;
  };
};

export const t_tuple_spread = <T extends unknown[]>(
  before: Type<unknown>[],
  rest: Type<unknown>,
  after: Type<unknown>[],
): Type<T> => {
  const beforeLen = before.length;
  const afterLen = after.length;
  return (value: unknown) => {
    if (!Array.isArray(value)) return fail;
    if (value.length < beforeLen + afterLen) return fail;

    for (let i = 0; i < beforeLen; i++) {
      if (before[i]!(value[i]) === fail) return fail;
    }

    const restEnd = value.length - afterLen;
    for (let i = beforeLen; i < restEnd; i++) {
      if (rest(value[i]) === fail) return fail;
    }

    for (let i = 0; i < afterLen; i++) {
      if (after[i]!(value[restEnd + i]) === fail) return fail;
    }

    return value as T;
  };
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

export function t_assert_nonnull<T>(value: T): NonNullable<T> {
  if (value == null) {
    throw new Error("Non-null assertion failed, value is " + value);
  }
  return value as NonNullable<T>;
}

export const t_ignore = (value: unknown) => {
  return value;
};

export function t_assert_truthy(value: unknown): asserts value {
  if (!value) throw new Error("Runtime type failure");
}
