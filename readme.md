# TypeScript Lie Detector

> STATUS: Not ready for usage at all. Please monitor TSLD's
> [Issue Tracker](https://git.paperclover.net/clo/ts-lie-detector/issues)

A problem with current TypeScript is all types are given as-is, with no way to
truly tell if those types are correct. Lie Detector instruments your codebase
with many runtime checks to verify the soundness of your codebase.

Obvious sources of "lies" in TypeScript include the `as` clause and non-null
assertions (postfix `!` operator):

```ts
export function sample(param: string | number | boolean, flag?: number) {
  if (typeof param === "string") {
    // unexpected behavior if `flag` is `undefined`
    return flag!.toFixed(2);
  }

  // unexpected behavior if `param` is `boolean`
  return (param as number).toFixed();
}
```

In addition to the two commented lies, TypeScript Lie Detector also sees that
`sample` could be called by external code without type-checking, so it validates
the parameters are sound.

In many cases, proper type narrowing is better than runtime assertions, but the
narrowing system in TypeScript can only get so far.

## Usage

## Contributions

This repository accepts pull requests to either its
[main repository on Forgejo](https://git.paperclover.net/clo/ts-lie-detector) as
well as the [GitHub Mirror](https://github.com/paperclover/ts-lie-detector).
Until Forgejo has a federated issue tracker, bugs can be reported on
[GitHub Discussions](https://github.com/paperclover/ts-lie-detector/discussions)
or sent over email to `git@paperclover.net`
