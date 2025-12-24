import { describe, expect, test } from "vitest";
import { Service } from "../src/Service.ts";

const service = new Service({
  lieDetectorOptions: { runtimePath: "" },
});

function shouldTransform(label: string, source: string, result: string) {
  test(label, () => {
    expect(
      service.transformVirtual("virtual.ts", source)
        .text
        .replace('"use strict";', "")
        .trim()
        .replace(/\s+/g, " "),
    ).toBe(
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
    't_assert(unknown, t_object({ x: t_number, y: t_or(t_undefined, t_string) }, ["y"]));',
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
  shouldTransform(
    "unknown and any emits no assertion",
    `[global as unknown, global as any];`,
    "[global, global];",
  );
  shouldTransform(
    "array type",
    `unknown as unknown[];`,
    "t_assert(unknown, t_array(t_ignore));",
  );
  shouldTransform(
    "array of item type",
    `unknown as string[];`,
    "t_assert(unknown, t_array(t_string));",
  );
  shouldTransform(
    "tuple",
    `unknown as [string, number, boolean];`,
    "t_assert(unknown, t_tuple([ t_string, t_number, t_boolean ]));",
  );
  shouldTransform(
    "tuple with spread at start",
    `unknown as [...number[], string];`,
    "t_assert(unknown, t_tuple_spread([], t_number, [ t_string ]));",
  );
  shouldTransform(
    "tuple with spread at end",
    `unknown as [string, ...number[]];`,
    "t_assert(unknown, t_tuple_spread([ t_string ], t_number, []));",
  );
  shouldTransform(
    "tuple with spread in middle",
    `unknown as [string, ...number[], boolean];`,
    "t_assert(unknown, t_tuple_spread([ t_string ], t_number, [ t_boolean ]));",
  );
  shouldTransform(
    "non-null assertion",
    `unknown!;`,
    "t_assert_nonnull(unknown);",
  );
  shouldTransform(
    "null | undefined",
    `unknown as null | undefined;`,
    "t_assert(unknown, t_or(t_undefined, t_null));",
  );
});
