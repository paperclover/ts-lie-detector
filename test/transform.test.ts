import { describe, expect, test } from "vitest";
import { Service } from "../src/Service.ts";

const service = new Service({
  lieDetectorOptions: { runtimePath: "" },
});

function shouldTransform(
  label: string,
  source: string,
  result: string,
  { files }: { files?: Record<string, string> } = {},
) {
  test(label, () => {
    service.writeVirtual(
      "global.d.ts",
      `declare var global: unknown;`,
    );

    if (files) {
      for (const [k, v] of Object.entries(files)) {
        service.writeVirtual(k, v);
      }
    }

    expect(
      service.transformVirtual("virtual.ts", source, {
        additionalFiles: [
          ...Object.keys(files ?? {}),
          "global.d.ts",
        ],
      })
        .text
        .replace("\"use strict\";", "")
        .trim()
        .replace(/\s+/g, " "),
    ).toBe(result.trim().replace(/\s+/g, " "));
  });
}

describe("transform tests", () => {
  shouldTransform(
    "string",
    `global as string;`,
    "t_assert(global, t_string);",
  );
  shouldTransform(
    "number",
    `global as number;`,
    "t_assert(global, t_number);",
  );
  shouldTransform(
    "boolean",
    `global as boolean;`,
    "t_assert(global, t_boolean);",
  );
  shouldTransform(
    "string or boolean",
    `global as string | boolean;`,
    "t_assert(global, t_or(t_string, t_boolean));",
  );
  shouldTransform(
    "boolean literal",
    `[global as false, global as true]`,
    "[t_assert(global, t_literal(false)), t_assert(global, t_literal(true))];",
  );
  shouldTransform(
    "number literal",
    `global as 2312`,
    "t_assert(global, t_literal(2312));",
  );
  shouldTransform(
    "object type",
    `global as { x: number, y: string }`,
    "t_assert(global, t_object({ x: t_number, y: t_string }, []));",
  );
  shouldTransform(
    "object type with optional",
    `global as { x: number, y?: string }`,
    "t_assert(global, t_object({ x: t_number, y: t_or(t_undefined, t_string) }, [\"y\"]));",
  );
  shouldTransform(
    "interface",
    `
      interface Type { x: number, y: string }
      global as Type
    `,
    "t_assert(global, t_object({ x: t_number, y: t_string }, []));",
  );
  shouldTransform(
    "type definition",
    `
      type Type = { x: number, y: string }
      global as Type
    `,
    "t_assert(global, t_object({ x: t_number, y: t_string }, []));",
  );
  shouldTransform(
    "unknown and any emits no assertion",
    `[global as unknown, global as any];`,
    "[global, global];",
  );
  shouldTransform(
    "array type",
    `global as unknown[];`,
    "t_assert(global, t_array(t_ignore));",
  );
  shouldTransform(
    "array of item type",
    `global as string[];`,
    "t_assert(global, t_array(t_string));",
  );
  shouldTransform(
    "tuple",
    `global as [string, number, boolean];`,
    "t_assert(global, t_tuple([ t_string, t_number, t_boolean ]));",
  );
  shouldTransform(
    "tuple with spread at start",
    `global as [...number[], string];`,
    "t_assert(global, t_tuple_spread([], t_number, [ t_string ]));",
  );
  shouldTransform(
    "tuple with spread at end",
    `global as [string, ...number[]];`,
    "t_assert(global, t_tuple_spread([ t_string ], t_number, []));",
  );
  shouldTransform(
    "tuple with spread in middle",
    `global as [string, ...number[], boolean];`,
    "t_assert(global, t_tuple_spread([ t_string ], t_number, [ t_boolean ]));",
  );
  shouldTransform(
    "non-null assertion",
    `global!;`,
    "t_assert_nonnull(global);",
  );
  shouldTransform(
    "null | undefined",
    `global as null | undefined;`,
    "t_assert(global, t_or(t_undefined, t_null));",
  );
  shouldTransform(
    "predicate 'asserts param'",
    `function assert(condition: boolean): asserts condition {
      if (!condition) throw new Error();
    }`,
    `function assert(condition) {
      if (!condition) throw new Error();
      t_assert_truthy(condition);
    }`,
  );
  shouldTransform(
    "predicate 'asserts param' arrow function",
    `export const assert = (condition: boolean): asserts condition =>
      (global as any)(condition);
    `,
    `export const assert = (condition) => {
      const l_return_1 = global(condition);
      t_assert_truthy(condition);
      return l_return_1;
    };`,
  );
  shouldTransform(
    "predicate 'asserts param' method",
    `class Test {
      method(): this is number {
        return Math.random() > 0.5;
      }
    }`,
    `class Test {
      method() {
        const l_return_1 = Math.random() > 0.5;
        if (l_return_1) t_assert(this, t_number);
        return l_return_1;
      }
    }`,
  );
  shouldTransform(
    "predicate 'param is T'",
    `function isString(value: unknown): value is string {
      console.log(1);
      return typeof value === "string";
    }`,
    `function isString(value) {
      console.log(1);
      const l_return_1 = typeof value === "string";
      if (l_return_1) t_assert(value, t_string);
      return l_return_1;
    }`,
  );
  shouldTransform(
    "predicate 'asserts param is T'",
    `function assertString(value: unknown): asserts value is string {
      if (typeof value === 'number') throw new Error("not a string");
    }`,
    `function assertString(value) {
      if (typeof value === 'number') throw new Error("not a string");
      t_assert(value, t_string);
    }`,
  );
  shouldTransform(
    "predicate anonymous function",
    `export const assertString = function(value: unknown): asserts value is string {
      if (typeof value === 'number') throw new Error("not a string");
    }`,
    `export const assertString = function (value) {
      if (typeof value === 'number') throw new Error("not a string");
      t_assert(value, t_string);
    };`,
  );
  shouldTransform(
    "predicate 'asserts param' multi-branch",
    `function assert(condition: boolean): asserts condition {
      if (Math.random() > 0.5) {
        while(false) return
        if (!condition) throw new Error();
        console.log(2);
        return;
      }
      const fn = function () {
        return true;
      };
      console.log(fn());
    }`,
    `function assert(condition) {
      if (Math.random() > 0.5) {
        while (false) { t_assert_truthy(condition); return; }
        if (!condition) throw new Error();
        console.log(2);
        t_assert_truthy(condition);
        return;
      }
      const fn = function () {
        return true;
      };
      console.log(fn());
      t_assert_truthy(condition);
    }`,
  );
});
