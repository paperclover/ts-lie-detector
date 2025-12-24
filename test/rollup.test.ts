import { expect, it } from "vitest";
import { rollup } from "rollup";
import { join } from "node:path";
import rollupPlugin from "@clo/ts-lie-detector/rollup.ts";

it("works", async () => {
  const bundle = await rollup({
    input: join(import.meta.dirname, "fixtures/bundler-a.ts"),
    plugins: [rollupPlugin()],
  });

  const { output } = await bundle.generate({
    format: "esm",
  });

  expect(output[0].code).toMatchInlineSnapshot(`
    "const fail = Symbol();
    function t_assert(value, check) {
        const result = check(value);
        if (result === fail)
            throw new Error("Runtime type failure");
        return result;
    }
    const t_string = (value) => {
        if (typeof value === "string")
            return value;
        return fail;
    };
    const t_object = (shape, optionalKeys = []) => {
        const optional = new Set(optionalKeys);
        return (value) => {
            if (typeof value !== "object" || value === null || Array.isArray(value)) {
                return fail;
            }
            for (const [key, check] of Object.entries(shape)) {
                const hasKey = Object.prototype.hasOwnProperty.call(value, key);
                if (!hasKey && !optional.has(key))
                    return fail;
                if (hasKey && check(value[key]) === fail) {
                    return fail;
                }
            }
            return value;
        };
    };

    function someFunction(param) {
        console.log(param.process.version);
    }

    someFunction(t_assert(window.global, t_object({
        process: t_object({
            version: t_string
        }, [])
    }, [])));
    "
  `);

  await bundle.close();
});
