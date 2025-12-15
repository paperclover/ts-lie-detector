const hello = Math.random() > 0.5 ? 1 : "meow";

const world = hello as string | boolean;

console.log(world);
