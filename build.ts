import { existsSync, readFileSync, rmSync } from 'node:fs';
import { $ } from 'bun';

const adapterDist = (name: string) => `packages/${name}/dist`;

// Clean dist directories (cross-platform rm -rf)
for (const pkg of ['core', 'prisma', 'drizzle', 'typeorm', 'client']) {
  rmSync(`packages/${pkg}/dist`, { recursive: true, force: true });
}

// Build core package
console.log('Building @queryjs/core...');
await $`tsc -p packages/core/tsconfig.build.json`;

// Bundle core ESM (single-file, self-contained)
await $`bun build packages/core/src/index.ts --outdir packages/core/dist --format esm --target node`;

// Bundle core CJS (outfile only — combining --outdir and --outfile makes Bun
// ignore --outfile and clobber the ESM index.js with CJS output)
await $`bun build packages/core/src/index.ts --outfile packages/core/dist/index.cjs --format cjs --target node`;

// Bundle the compiler subpath: CJS for require() consumers, ESM for import.
// (tsc emits declarations + an extension-less ESM that Node rejects, so the
// runtime files here come from bun build — see the adapter section below.)
await $`bun build packages/core/src/compiler/index.ts --outfile packages/core/dist/compiler/index.cjs --format cjs --target node`;
await $`bun build packages/core/src/compiler/index.ts --outdir packages/core/dist/compiler --format esm --target node`;

// Build adapter packages
const adapters = ['prisma', 'drizzle', 'typeorm', 'client'];
const adapterExternals: Record<string, string[]> = {
  prisma: ['@queryjs/core', '@queryjs/core/compiler'],
  drizzle: ['@queryjs/core', '@queryjs/core/compiler', 'drizzle-orm'],
  typeorm: ['@queryjs/core', '@queryjs/core/compiler', 'typeorm'],
  client: [],
};
await Promise.all(
  adapters.map(async (adapter) => {
    console.log(`Building @queryjs/${adapter}...`);
    // tsc emits declarations only; the runtime files are bundled below because
    // tsc's ESM output uses extension-less relative imports Node rejects.
    await $`tsc -p packages/${adapter}/tsconfig.build.json --emitDeclarationOnly`;
    const externalFlags = adapterExternals[adapter].flatMap((name) => ['--external', name]);
    await $`bun build packages/${adapter}/src/index.ts --outdir packages/${adapter}/dist --format esm --target node ${externalFlags}`;
    // require() consumers get a single loadable CJS file; the peer
    // `@queryjs/core` / `@queryjs/core/compiler` and the host ORM stay external.
    await $`bun build packages/${adapter}/src/index.ts --outfile packages/${adapter}/dist/index.cjs --format cjs --target node ${externalFlags}`;
  }),
);

// ── Packaging smoke checks ────────────────────────────────────────────────

const coreDist = 'packages/core/dist';
const requiredArtifacts: [string, (src: string) => boolean][] = [
  ['index.js', (src) => /\bexport\b/.test(src) && !src.includes('__toCommonJS')],
  ['index.cjs', (src) => src.includes('__toCommonJS') || src.includes('require(')],
  ['compiler/index.js', (src) => /\bexport\b/.test(src) && !src.includes('__toCommonJS')],
  ['compiler/index.cjs', (src) => src.includes('__toCommonJS') || src.includes('require(')],
];

for (const [rel, check] of requiredArtifacts) {
  const file = `${coreDist}/${rel}`;
  if (!existsSync(file)) {
    throw new Error(`Build smoke check failed: missing ${file}`);
  }
  if (!check(readFileSync(file, 'utf8'))) {
    throw new Error(
      `Build smoke check failed: ${file} has the wrong module format ` +
        '(expected ESM for index.js, CJS for *.cjs)',
    );
  }
}

for (const adapter of adapters) {
  // CJS: loadable via require(), keeps @queryjs/core + host ORM external
  const cjsFile = `${adapterDist(adapter)}/index.cjs`;
  if (!existsSync(cjsFile)) {
    throw new Error(`Build smoke check failed: missing ${cjsFile}`);
  }
  const cjs = readFileSync(cjsFile, 'utf8');
  if (!cjs.includes('__toCommonJS') && !cjs.includes('require(')) {
    throw new Error(`Build smoke check failed: ${cjsFile} is not CJS (expected require() output)`);
  }
  for (const external of adapterExternals[adapter]) {
    if (!cjs.includes(`require("${external}")`)) {
      throw new Error(`Build smoke check failed: ${cjsFile} did not keep "${external}" external`);
    }
  }

  // ESM: importable under Node (no extension-less relative imports), keeps the
  // same externals as import specifiers
  const esmFile = `${adapterDist(adapter)}/index.js`;
  if (!existsSync(esmFile)) {
    throw new Error(`Build smoke check failed: missing ${esmFile}`);
  }
  const esm = readFileSync(esmFile, 'utf8');
  if (!/\bexport\b/.test(esm) || esm.includes('__toCommonJS')) {
    throw new Error(`Build smoke check failed: ${esmFile} is not ESM`);
  }
  for (const external of adapterExternals[adapter]) {
    if (!esm.includes(`from "${external}"`)) {
      throw new Error(`Build smoke check failed: ${esmFile} did not keep "${external}" external`);
    }
  }
}

console.log('Build complete!');
