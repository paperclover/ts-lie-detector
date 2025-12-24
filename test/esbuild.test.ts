import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import esbuildPlugin from "../src/plugin/esbuild.js";

const testDir = join(process.cwd(), "test-fixtures");

describe("esbuild plugin", () => {
  beforeAll(async () => {
    await rm(testDir, { recursive: true, force: true });
    await mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("transforms basic type assertions", async () => {
    const input = `
const value: string = "test" as string;
const num: number = 42 as number;
const bool: boolean = true as boolean;
`;
    await writeFile(join(testDir, "basic.ts"), input);

    const result = await build({
      entryPoints: [join(testDir, "basic.ts")],
      bundle: false,
      write: false,
      plugins: [esbuildPlugin()],
      format: "esm",
    });

    expect(result.outputFiles[0].text).toMatchInlineSnapshot(`
      "import { t_string, t_number, t_boolean, t_assert } from "@clo/typescript-lie-detector/runtime";

      const value = t_assert("test", t_string());
      const num = t_assert(42, t_number());
      const bool = t_assert(true, t_boolean());
      "
    `);
  });

  it("transforms non-null assertions", async () => {
    const input = `
const nullable: string | null = null;
const value = nullable!;
`;
    await writeFile(join(testDir, "nonnull.ts"), input);

    const result = await build({
      entryPoints: [join(testDir, "nonnull.ts")],
      bundle: false,
      write: false,
      plugins: [esbuildPlugin()],
      format: "esm",
    });

    expect(result.outputFiles[0].text).toMatchInlineSnapshot(`
      "import { t_assert_nonnull } from "@clo/typescript-lie-detector/runtime";

      const nullable = null;
      const value = t_assert_nonnull(nullable);
      "
    `);
  });

  it("transforms complex type assertions", async () => {
    const input = `
interface User {
  name: string;
  age: number;
  optional?: string;
}

const user: User = {
  name: "John",
  age: 30,
} as User;

const users: User[] = [user] as User[];
const tuple: [string, number] = ["test", 42] as [string, number];
const union: string | number = "test" as string | number;
`;
    await writeFile(join(testDir, "complex.ts"), input);

    const result = await build({
      entryPoints: [join(testDir, "complex.ts")],
      bundle: false,
      write: false,
      plugins: [esbuildPlugin()],
      format: "esm",
    });

    expect(result.outputFiles[0].text).toMatchInlineSnapshot(`
      "import { t_object, t_string, t_number, t_array, t_tuple, t_or, t_assert } from "@clo/typescript-lie-detector/runtime";

      const user = t_assert({
        name: "John",
        age: 30
      }, t_object({
        name: t_string(),
        age: t_number()
      }, ["optional"]));

      const users = t_assert([user], t_array(t_object({
        name: t_string(),
        age: t_number()
      }, ["optional"])));

      const tuple = t_assert(["test", 42], t_tuple([t_string(), t_number()]));

      const union = t_assert("test", t_or(t_string(), t_number()));
      "
    `);
  });

  it("handles literal type assertions", async () => {
    const input = `
const literal: "test" = "test" as "test";
const numLiteral: 42 = 42 as 42;
const boolTrue: true = true as true;
const boolFalse: false = false as false;
`;
    await writeFile(join(testDir, "literals.ts"), input);

    const result = await build({
      entryPoints: [join(testDir, "literals.ts")],
      bundle: false,
      write: false,
      plugins: [esbuildPlugin()],
      format: "esm",
    });

    expect(result.outputFiles[0].text).toMatchInlineSnapshot(`
      "import { t_literal, t_assert } from "@clo/typescript-lie-detector/runtime";

      const literal = t_assert("test", t_literal("test"));
      const numLiteral = t_assert(42, t_literal(42));
      const boolTrue = t_assert(true, t_literal(true));
      const boolFalse = t_assert(false, t_literal(false));
      "
    `);
  });

  it("ignores unknown/any type assertions", async () => {
    const input = `
const unknownValue: unknown = "test" as unknown;
const anyValue: any = "test" as any;
const normalValue: string = "test" as string;
`;
    await writeFile(join(testDir, "ignore.ts"), input);

    const result = await build({
      entryPoints: [join(testDir, "ignore.ts")],
      bundle: false,
      write: false,
      plugins: [esbuildPlugin()],
      format: "esm",
    });

    expect(result.outputFiles[0].text).toMatchInlineSnapshot(`
      "import { t_string, t_assert } from "@clo/typescript-lie-detector/runtime";

      const unknownValue = "test";
      const anyValue = "test";
      const normalValue = t_assert("test", t_string());
      "
    `);
  });

  it("transforms tuple with spread", async () => {
    const input = `
const tuple: [string, ...number[], boolean] = ["test", 1, 2, 3, true] as [string, ...number[], boolean];
`;
    await writeFile(join(testDir, "tuple-spread.ts"), input);

    const result = await build({
      entryPoints: [join(testDir, "tuple-spread.ts")],
      bundle: false,
      write: false,
      plugins: [esbuildPlugin()],
      format: "esm",
    });

    expect(result.outputFiles[0].text).toMatchInlineSnapshot(`
      "import { t_string, t_number, t_boolean, t_tuple_spread, t_assert } from "@clo/typescript-lie-detector/runtime";

      const tuple = t_assert(["test", 1, 2, 3, true], t_tuple_spread([t_string()], t_number(), [t_boolean()]));
      "
    `);
  });

  it("generates warnings for diagnostics", async () => {
    const input = `
const value: string = "test" as string;
`;
    await writeFile(join(testDir, "warnings.ts"), input);

    const result = await build({
      entryPoints: [join(testDir, "warnings.ts")],
      bundle: false,
      write: false,
      plugins: [esbuildPlugin()],
      format: "esm",
    });

    expect(result.warnings).toHaveLength(0);
    expect(result.outputFiles[0].text).toContain("t_assert");
  });

  it("does not transform files with type or suffix", async () => {
    const input = `
export const value = "test";
`;
    await writeFile(join(testDir, "no-transform.ts"), input);

    const result = await build({
      entryPoints: [join(testDir, "no-transform.ts")],
      bundle: false,
      write: false,
      plugins: [esbuildPlugin()],
      format: "esm",
    });

    expect(result.outputFiles[0].text).toMatchInlineSnapshot(`
      "export const value = "test";
      "
    `);
  });
});