export function someFunction(param: { process: { version: string } }) {
  console.log(param.process.version);
}
