import { PrismaLibSql } from '@prisma/adapter-libsql';
import { defineQuery, defineRelation, QueryJSError, q } from '@queryjs/core';
import { prismaQueryAdapter } from '@queryjs/prisma';
import cors from 'cors';
import express from 'express';

import { PrismaClient } from './generated/prisma/client';

// Prisma 7 runs without a Rust engine: a driver adapter talks to the database.
// @prisma/adapter-libsql (WebAssembly) keeps this example Bun-native — the
// better-sqlite3 adapter's native addon is not loadable from Bun.
const prisma = new PrismaClient({
  adapter: new PrismaLibSql({ url: 'file:./prisma/dev.db' }),
});
const app = express();
app.use(cors());

// Express 5 defaults to the flat 'simple' query parser; QueryJS filter syntax
// relies on qs's nested-object parsing, so opt into the 'extended' parser.
app.set('query parser', 'extended');

const usersQuery = defineQuery({
  fields: {
    // SQLite rejects Prisma's `mode: 'insensitive'`, so string fields opt in
    // to case-sensitive substring/search matching (see adapter README caveat).
    name: q.string().sortable().searchable().max(100).caseSensitive(),
    email: q.string().sortable().searchable().email().caseSensitive(),
    age: q.number().sortable().min(0).max(150).integer(),
    status: q.enum(['ACTIVE', 'INACTIVE']).sortable().searchable().caseSensitive(),
    role: q.enum(['admin', 'editor', 'viewer']).sortable().searchable().caseSensitive(),
    createdAt: q.date().sortable(),
  },
  relations: {
    org: defineRelation({
      fields: { name: q.string().sortable().searchable() },
    }),
  },
  limits: {
    maxLimit: 50,
  },
});

app.get('/users', async (req, res, next) => {
  try {
    const query = usersQuery.parse(req.query);
    const { where, orderBy, skip, take } = prismaQueryAdapter.map(query);
    const [data, total] = await Promise.all([
      prisma.user.findMany({ where, orderBy, skip, take, include: { org: true } }),
      prisma.user.count({ where }),
    ]);
    res.json({ data, meta: { total, page: query.pagination.page, limit: query.pagination.limit } });
  } catch (error) {
    next(error);
  }
});

// Express doesn't catch async throws; route them through next() and let errors
// surface as JSON here instead of crashing the process.
app.use(
  (error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (error instanceof QueryJSError) {
      const { message, code, field, operator, path, details } = error;
      res
        .status(error.statusCode)
        .json({ error: { message, code, field, operator, path, details } });
      return;
    }
    console.error(error);
    res.status(500).json({ error: { message: 'Internal Server Error' } });
    next(error);
  },
);

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`express-prisma listening on http://localhost:${port}`));
