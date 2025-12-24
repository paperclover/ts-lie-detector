export default function esbuildPlugin(): esbuild.Plugin {
  return {
    name: "typescript-lie-detector",
    setup(b) {
      const service = new Service();
      b.onLoad({ filter: /\.ts[x]?$/ }, ({ path, suffix, with: { type } }) => {
        if (type || suffix) return null;
        const result = service.transform(path);
        return {
          contents: result.text,
          loader: "js",
          watchFiles: [path],
          warnings: result.diagnostics.map((x) => ({
            text: x.messageText.toString(),
          })),
        };
      });
      b.onDispose(() => {
        service.close();
      });
    },
  };
}

import type * as esbuild from "esbuild";
import { Service } from "../Service";
