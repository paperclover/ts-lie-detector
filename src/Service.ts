const virtualPrefix = "/:virtual/";

export namespace Service {
  export interface Options {
    tsconfig?: string;
    lieDetectorOptions?: Partial<LieDetectorOptions>;
    system?: Partial<ts.System>;
  }
}

export class Service {
  host:
    | ts.WatchCompilerHostOfFilesAndCompilerOptions<ts.BuilderProgram>
    | ts.WatchCompilerHostOfConfigFile<ts.BuilderProgram>;
  incremental:
    | ts.WatchOfFilesAndCompilerOptions<ts.BuilderProgram>
    | ts.WatchOfConfigFile<ts.BuilderProgram>;
  lieDetectorOptions: Partial<LieDetectorOptions>;
  rootFiles = new Set<string>();
  virtualFiles = new Map<string, string | undefined>();
  events = new EventEmitter<{
    "watch": [string];
  }>();

  constructor(options?: Service.Options) {
    const sys = {
      ...ts.sys,
      ...options?.system,
    };
    let addedWatch = false;
    const overriddenSystem: ts.System = {
      ...sys,
      watchFile: (_, cb) => {
        if (addedWatch) return { close: () => {} };
        addedWatch = true;

        function handler(change: string) {
          cb(change, ts.FileWatcherEventKind.Changed);
        }

        this.events.on("watch", handler);
        return { close: () => this.events.off("watch", handler) };
      },
      watchDirectory: () => {
        return { close: () => {} };
      },
      fileExists: (path) => {
        if (path.startsWith(virtualPrefix)) {
          return this.virtualFiles.has(path.slice(virtualPrefix.length));
        }
        return sys.fileExists(path);
      },
      readFile: (path, enc) => {
        if (path.startsWith(virtualPrefix)) {
          return this.virtualFiles.get(path.slice(virtualPrefix.length));
        }
        return sys.readFile(path, enc);
      },
      resolvePath: (path) => {
        if (path.startsWith("virtual:")) return path;
        return sys.resolvePath(path);
      },
      realpath: sys.realpath
        ? (path) => {
          if (path.startsWith("virtual:")) return path;
          return sys.realpath!(path);
        }
        : undefined,
      writeFile: () => {},
    };
    this.lieDetectorOptions = options?.lieDetectorOptions ?? {};
    if (options?.tsconfig) {
      const host = ts.createWatchCompilerHost(
        options.tsconfig,
        tsCompilerOptions,
        overriddenSystem,
        undefined,
        (diagnostic) => {},
        (diagnostic, newLine, options, errorCount) => {},
        {}, // watch options
        [],
      );
      this.host = host;
      this.incremental = ts.createWatchProgram(host);
    } else {
      const host = ts.createWatchCompilerHost(
        [],
        tsCompilerOptions,
        overriddenSystem,
        undefined,
        (diagnostic) => {},
        (diagnostic, newLine, options, errorCount) => {},
        [], // references
        {}, // watch options
      );
      this.host = host;
      this.incremental = ts.createWatchProgram(host);
    }
  }

  transform(file: string) {
    if ("updateRootFileNames" in this.incremental) {
      this.incremental.updateRootFileNames([file]);
    }
    const builder = this.incremental.getProgram();

    const sourceFile = builder.getSourceFile(file);
    assert(sourceFile, `Source file ${JSON.stringify(file)} does not exist`);

    const outputs = new Map<string, string>();
    const emit = builder.emit(
      sourceFile,
      // writeFile
      function(file, contents) {
        outputs.set(file, contents);
      },
      // cancelationToken
      undefined,
      // emitOnlyDts
      false,
      // customTransformers
      {
        before: [
          createTransformer(
            builder.getProgram().getTypeChecker(),
            this.lieDetectorOptions,
          ),
        ],
      },
    );
    return {
      ...emit,
      outputs,
      get text() {
        return outputs.values().next().value!;
      },
    };
  }

  markChanged(filename: string) {
    this.events.emit("watch", filename);
  }

  transformVirtual(filename: string, source: string) {
    const had = this.virtualFiles.has(filename);
    this.virtualFiles.set(filename, source);
    if (had) this.markChanged(virtualPrefix + filename);
    try {
      return this.transform(virtualPrefix + filename);
    } finally {
      this.virtualFiles.set(filename, undefined);
    }
  }

  close() {
    this.incremental.close();
  }
}

import assert from "assert";
import { EventEmitter } from "node:events";
import * as ts from "typescript";
import {
  createTransformer,
  type LieDetectorOptions,
  tsCompilerOptions,
} from "./transform.ts";
