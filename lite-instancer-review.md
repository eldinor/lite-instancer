# Review of `@litools/instancer`

## Overall Assessment

The package is already in good shape and feels production-ready for a
public npm release. The API is clear, the README is well organized, and
the package structure follows modern ESM practices.

The recommendations below are improvements rather than blockers.

------------------------------------------------------------------------

# High Priority

## 1. Add `repository` and `bugs`

Add:

``` json
"repository": {
  "type": "git",
  "url": "git+https://github.com/eldinor/lite-instancer.git"
},
"bugs": {
  "url": "https://github.com/eldinor/lite-instancer/issues"
}
```

This improves the npm page and links it correctly to GitHub.

------------------------------------------------------------------------

## 2. Add npm keywords

Suggested keywords:

``` json
"keywords": [
  "babylonjs",
  "babylon-lite",
  "babylonjs-lite",
  "thin-instances",
  "instancing",
  "instance-pool",
  "picking",
  "vat",
  "vertex-animation-texture",
  "webgl",
  "webgpu",
  "3d"
]
```

These will significantly improve discoverability.

------------------------------------------------------------------------

## 3. Add LICENSE to published files

``` json
"files": [
  "dist",
  "CHANGELOG.md",
  "LICENSE",
  "docs/README.md",
  "README.md",
  "User_Guide.md"
]
```

------------------------------------------------------------------------

## 4. Protect publishing

Add:

``` json
"scripts": {
  "prepublishOnly": "npm run typecheck && npm test && npm run build"
}
```

This prevents accidental publication of broken packages.

------------------------------------------------------------------------

# Medium Priority

## 5. Avoid floating beta TypeScript

Current:

``` json
"typescript": "^6.0.0-beta"
```

Prefer either:

``` json
"typescript": "^5.9.0"
```

or

``` json
"typescript": "6.0.0-beta"
```

Using `^` with beta releases may unexpectedly upgrade to newer
prerelease versions.

------------------------------------------------------------------------

## 6. Add Node engine

``` json
"engines": {
  "node": ">=20"
}
```

------------------------------------------------------------------------

## 7. Improve the first README example

Show the complete workflow:

``` ts
import { createInstanceSet } from "@litools/instancer";

const boxes = createInstanceSet(boxMesh, {
    capacity: 500,
    colors: true,
    visibleStrategy: "active-count"
});

const id = boxes.create({
    position: [0,0,0],
    scale: 1
});

boxes.setPosition(id, [2,0,0]);
```

New users immediately understand the complete lifecycle.

------------------------------------------------------------------------

## 8. Add a Cleanup section

Example:

```` md
## Cleanup

Dispose instance sets and unregister picking bindings when they are no longer needed.

```ts
registry.unregister(boxMesh);
boxes.dispose();
```
````

(Adjust the example to match the actual API.)

------------------------------------------------------------------------

## 9. Explicitly mention ESM-only

Add a short section:

``` md
## Runtime

This package is ESM-only.
```

This helps users trying to use CommonJS.

------------------------------------------------------------------------

# Optional

You may also expose:

``` json
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js",
    "default": "./dist/index.js"
  }
}
```

This is optional but improves compatibility with some tooling.

------------------------------------------------------------------------

# Final Verdict

The package is already considerably better than the average npm package
at version **0.2.0**.

## Recommended implementation order

1.  repository + bugs
2.  keywords
3.  prepublishOnly
4.  LICENSE
5.  stable TypeScript version
6.  cleanup section
7.  ESM-only note

None of these are blockers. They mainly improve discoverability, package
quality, and long-term maintenance.
