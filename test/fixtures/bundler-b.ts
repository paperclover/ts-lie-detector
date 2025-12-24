export function someFunction(param: { process: { version: string } }) {
  console.log(param.process.version);
}

export function unreferenced(thing: unknown) {
  thing.bar();
}
