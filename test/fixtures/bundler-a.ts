import { someFunction } from "./bundler-b";
someFunction(global as { process: { version: string } });
