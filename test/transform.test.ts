import { describe, expect, test } from "vitest";
import { transformString } from "../src/transform";

function shouldTransform(label: string, source: string, result: string) {
  test(label, () => {
    expect(transformString(source).trim().replace(/\s+/g, " ")).toBe(
      result.trim(),
    );
  });
}

describe("transform tests", () => {
  shouldTransform(
    "string",
    `unknown as string;`,
    "t_assert(unknown, t_string);",
  );
  shouldTransform(
    "number",
    `unknown as number;`,
    "t_assert(unknown, t_number);",
  );
  shouldTransform(
    "boolean",
    `unknown as boolean;`,
    "t_assert(unknown, t_boolean);",
  );
  shouldTransform(
    "string or boolean",
    `unknown as string | boolean;`,
    "t_assert(unknown, t_or(t_string, t_boolean));",
  );
  shouldTransform(
    "boolean literal",
    `[unknown as false, unknown as true]`,
    "[t_assert(unknown, t_literal(false)), t_assert(unknown, t_literal(true))];",
  );
  shouldTransform(
    "number literal",
    `unknown as 2312`,
    "t_assert(unknown, t_literal(2312));",
  );
  shouldTransform(
    "object type",
    `unknown as { x: number, y: string }`,
    "t_assert(unknown, t_object({ x: t_number, y: t_string }, []));",
  );
  shouldTransform(
    "object type with optional",
    `unknown as { x: number, y?: string }`,
    't_assert(unknown, t_object({ x: t_number, y: t_string }, ["y"]));',
  );
  shouldTransform(
    "interface",
    `
      interface Type { x: number, y: string }
      unknown as Type
    `,
    "t_assert(unknown, t_object({ x: t_number, y: t_string }, []));",
  );
  shouldTransform(
    "type definition",
    `
      type Type = { x: number, y: string }
      unknown as Type
    `,
    "t_assert(unknown, t_object({ x: t_number, y: t_string }, []));",
  );
});
