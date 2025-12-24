export default function rollupPlugin(
  options?: LieDetectorOptions,
): rollup.Plugin {
  // TODO: let other plugins mess with this import
  const runtimePath = url.fileURLToPath(import.meta.resolve(
    options?.runtimePath ?? defaultOptions.runtimePath,
  ));

  const service = new Service({
    lieDetectorOptions: {
      ...options,
      runtimePath,
    },
  });

  return {
    name: "@clo/ts-lie-detector/esbuild.ts",
    closeWatcher() {
      service.close();
    },
    load: {
      filter: { id: /\.tsx?$/ },
      order: "pre",
      async handler(id) {
        if (id === runtimePath!) {
          return ts.transpileModule(
            await this.fs.readFile(id, { encoding: "utf8" }),
            { compilerOptions: tsCompilerOptions },
          ).outputText;
        }
        const result = service.transform(id);
        for (const warning of result.diagnostics) {
          this.warn(warning.messageText.toString());
        }
        return { code: result.text };
      },
    },
  };
}

import * as rollup from "rollup";
import * as url from "node:url";
import { Service } from "./Service.ts";
import {
  defaultOptions,
  type LieDetectorOptions,
  tsCompilerOptions,
} from "./transform.ts";
import ts from "typescript";
