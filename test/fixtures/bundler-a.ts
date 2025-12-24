import { someFunction } from "./bundler-b.ts";
someFunction(window.global as { process: { version: string } });
