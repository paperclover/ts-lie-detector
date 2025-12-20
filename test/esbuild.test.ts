import esbuildPlugin from "@clo/ts-lie-detector/esbuild.ts";
import { build } from "esbuild";
import { join } from "node:path";
import { expect, it } from "vitest";

it("works", async () => {
  const result = await build({
    entryPoints: [join(import.meta.dirname, "fixtures/bundler-a.ts")],
    bundle: true,
    write: false,
    plugins: [esbuildPlugin()],
    format: "esm",
  });

  expect(result.outputFiles[0]!.text).toMatchInlineSnapshot(`
    "// src/runtime.ts
    var fail = /* @__PURE__ */ Symbol();
    function t_assert(value, check) {
      const result = check(value);
      if (result === fail) throw new Error("Runtime type failure");
      return result;
    }
    var t_string = (value) => {
      if (typeof value === "string") return value;
      return fail;
    };
    var t_object = (shape, optionalKeys = []) => {
      const optional = new Set(optionalKeys);
      return (value) => {
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
          return fail;
        }
        for (const [key, check] of Object.entries(shape)) {
          const hasKey = Object.prototype.hasOwnProperty.call(value, key);
          if (!hasKey && !optional.has(key)) return fail;
          if (hasKey && check(value[key]) === fail) {
            return fail;
          }
        }
        return value;
      };
    };

    // test/fixtures/bundler-b.ts
    function someFunction(param) {
      console.log(param.process.version);
    }

    // test/fixtures/bundler-a.ts
    someFunction(t_assert(window.global, t_object({
      process: t_object({
        version: t_string
      }, [])
    }, [])));
    "
  `);

  // TODO: report diagnostics in `Service`
  expect(result.warnings).toEqual([]);
});
