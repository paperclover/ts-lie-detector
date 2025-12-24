/**
 * esbuild or Bun bundling plugin. Because Bun markets itself as compatible with
 * plugins made for esbuild, this plugin is designed to work around differences
 * in Bun's implementation to allow it to work. Bugs reported for subtle behavior
 * mistakes that are not present when using `esbuild` will not be fixed.
 */
export default function esbuildPlugin(
  options?: LieDetectorOptions,
): esbuild.Plugin {
  return {
    name: "@clo/ts-lie-detector/esbuild.ts",
    async setup(b) {
      const runtimePath: string = url.fileURLToPath(import.meta.resolve(
        options?.runtimePath ?? defaultOptions.runtimePath,
      ));
      const service = new Service({ lieDetectorOptions: options });
      b.onLoad(
        { filter: /\.ts[x]?$/ },
        // NOTE: Bun doesn't pass `with`, so a default is needed
        async ({ path: file, suffix, with: { type } = {} }) => {
          if (file === runtimePath! || type || suffix) {
            // NOTE: Bun does not appear to support fallbacks with `null`
            // @ts-expect-error (third-party types not installed)
            if (typeof Bun !== "undefined" && !b.esbuild?.build) {
              return {
                contents: (await fs.readFile(file)),
                loader: path.extname(file).slice(1) as "tsx" | "ts",
              };
            }

            return null;
          }
          const result = service.transform(file);
          return {
            contents: result.text,
            loader: "js",
            watchFiles: [file],
            warnings: result.diagnostics.map((x) => ({
              text: x.messageText.toString(),
            })),
          };
        },
      );
      // NOTE: Bun does not have `onDispose`
      b.onDispose?.(() => {
        service.close();
      });
    },
  };
}

import type * as esbuild from "esbuild";
import { Service } from "./Service.ts";
import { defaultOptions, type LieDetectorOptions } from "./transform.ts";
import * as url from "url";
import * as fs from "fs/promises";
import * as path from "path";
