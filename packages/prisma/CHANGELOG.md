# @queryjs/prisma

## 0.2.1

### Patch Changes

- Updated dependencies
  - @queryjs/core@0.2.1

## 0.2.0

### Minor Changes

- aa174c1: rename QuerioError API, ship dual ESM/CJS for adapters, and overhaul docs + packaging
  
  - **Breaking rename:** `QuerioError` is renamed to `QueryJSError`. The old name remains available as a deprecated alias that throws identically (`instanceof QueryJSError` is true for both), so existing error handlers keep working.
  - **`@queryjs/prisma`, `@queryjs/drizzle`, `@queryjs/typeorm`** now ship dual ESM + CJS (previously ESM-only via `tsc`). Runtime files are Bun-bundled with `@queryjs/core`, `@queryjs/core/compiler`, and the host ORM kept external, so `import` works under Node ESM and `require()` works without a transpiler.
  - Adapter peer ranges widened to include the latest ORMs: `drizzle-orm ^0.38.3 || ^0.45.3` and `typeorm ^0.3.20 || ^1.0.0`.
  - New packaging smoke test (`bun run smoke-pack`) packs all four tarballs and verifies `import` and `require` under Bun and Node; every URL example in the READMEs is now asserted against real parser output (`tests/docs/readme-examples.spec.ts`).

### Patch Changes

- Updated dependencies [aa174c1]
  - @queryjs/core@0.2.0
