/**
 * Packages every workspace package with `bun pack`, installs the tarballs into
 * a throwaway project together with the required peer ORMs, then verifies both
 * `import` and `require` work for all four packages and the `@queryjs/core`
 * subpath — under Bun AND Node.
 *
 * Run with: bun run scripts/smoke-pack.ts
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';

const packages = ['core', 'prisma', 'drizzle', 'typeorm', 'client'];
const root = `${import.meta.dirname}/..`;
const tarballsDir = mkdtempSync(join(tmpdir(), 'queryjs-pack-'));

try {
  // 1. Pack every package
  for (const pkg of packages) {
    const dir = join(root, 'packages', pkg);
    await $`bun pm pack`.cwd(dir);
    const tgz = (await $`ls ${pkg === 'core' ? 'queryjs-core' : `queryjs-${pkg}`}-*.tgz`
      .cwd(dir)
      .text()
      .then((t) => t.trim().split('\n').at(-1)))!;
    writeFileSync(
      join(tarballsDir, `queryjs-${pkg}.tgz`),
      await Bun.file(join(dir, tgz)).arrayBuffer(),
    );
  }

  // 2. Fresh project + install tarballs and peer ORMs
  const project = mkdtempSync(join(tmpdir(), 'queryjs-smoke-'));
  writeFileSync(
    join(project, 'package.json'),
    JSON.stringify({ name: 'queryjs-smoke-pack', private: true, type: 'module' }, null, 2),
  );
  const tarballs = packages.map((p) => join(tarballsDir, `queryjs-${p}.tgz`));
  await $`bun add ${tarballs} drizzle-orm typeorm`.cwd(project);

  // 3. Verification scripts (run under both Bun and Node)
  const asserts = `
const q = core.q;
const { defineQuery, mapQuery, QueryJSError } = core;
const { QueryMapper } = compiler;
const { prismaQueryAdapter } = prisma;
const { drizzleQueryAdapter, toDrizzleSQL } = drizzle;
const { typeormQueryAdapter } = typeorm;
const { createQuery } = client;

if (!defineQuery || !mapQuery || typeof q !== 'object') throw new Error('core exports missing');
if (typeof QueryMapper !== 'function') throw new Error('core/compiler does not export QueryMapper');
if (typeof prismaQueryAdapter !== 'object' || prismaQueryAdapter === null) throw new Error('prismaQueryAdapter missing');
if (typeof drizzleQueryAdapter !== 'object' || drizzleQueryAdapter === null) throw new Error('drizzleQueryAdapter missing');
if (typeof toDrizzleSQL !== 'function') throw new Error('toDrizzleSQL missing');
if (typeof typeormQueryAdapter !== 'object' || typeormQueryAdapter === null) throw new Error('typeormQueryAdapter missing');
if (typeof createQuery !== 'function') throw new Error('createQuery missing from client');

// Exercise core -> compiler -> prisma wiring with a real query
const usersQuery = defineQuery({
  fields: {
    name: q.string().sortable().searchable(),
    status: q.enum(['ACTIVE', 'INACTIVE']).sortable().searchable(),
  },
});
const resourceQuery = usersQuery.parse({
  filter: { status: { eq: 'ACTIVE' } },
  sort: '-name',
  page: '2',
  limit: '25',
});
const mapped = mapQuery(resourceQuery, prismaQueryAdapter);
if (!mapped || mapped.where.status.equals !== 'ACTIVE' || mapped.orderBy[0].name !== 'desc' || mapped.skip !== 25 || mapped.take !== 25) {
  throw new Error('mapQuery(prisma) produced unexpected output: ' + JSON.stringify(mapped));
}
if (!QueryJSError) throw new Error('QueryJSError missing');
console.log('OK');
`;

  const esm = `import * as core from '@queryjs/core';
import * as compiler from '@queryjs/core/compiler';
import * as prisma from '@queryjs/prisma';
import * as drizzle from '@queryjs/drizzle';
import * as typeorm from '@queryjs/typeorm';
import * as client from '@queryjs/client';
${asserts}`;
  const cjs = `const core = require('@queryjs/core');
const compiler = require('@queryjs/core/compiler');
const prisma = require('@queryjs/prisma');
const drizzle = require('@queryjs/drizzle');
const typeorm = require('@queryjs/typeorm');
const client = require('@queryjs/client');
${asserts}`;
  const nodeMjs = join(project, 'smoke.mjs');
  const nodeCjs = join(project, 'smoke.cjs');
  writeFileSync(nodeMjs, esm);
  writeFileSync(nodeCjs, cjs);

  // 4. Run every combination
  const combos = [
    ['bun', nodeMjs],
    ['bun', nodeCjs],
    ['node', nodeMjs],
    ['node', nodeCjs],
  ] as const;
  let ran = 0;
  for (const [runtime, file] of combos) {
    try {
      await $`${runtime} ${file}`.cwd(project);
    } catch (error) {
      throw new Error(
        `${runtime} ${file.endsWith('.mjs') ? 'esm' : 'cjs'} failed:\n${String(error)}`,
      );
    }
    ran += 1;
  }

  console.log(`Smoke pack passed: all ${ran} import/require combinations load (Bun + Node).`);
} finally {
  rmSync(tarballsDir, { recursive: true, force: true });
}
