import {
  buildLikePattern,
  ErrorCode,
  type FilterOperator,
  isStringOperator,
  type LikeMatch,
  nullClauseFor,
  QueryJSError,
  type RelationFilterExpression,
  type ResourceQuery,
  type SearchQuery,
  type SortExpression,
} from '@queryjs/core';
import type { MappableAdapter } from '@queryjs/core/compiler';
import { QueryMapper } from '@queryjs/core/compiler';
import { and, or, type SQL, sql } from 'drizzle-orm';

// ── Drizzle Adapter ──────────────────────────────────────────────────────

/**
 * Adapter for Drizzle ORM.
 * Translates QueryJS's application-level queries into Drizzle-compatible
 * `where` and `orderBy` arguments (both are `SQL` fragments), plus `skip`/`take`.
 *
 * Usage:
 * ```ts
 * const { where, orderBy, skip, take } = drizzleQueryAdapter.map(query);
 * const rows = await db.select().from(users).where(where).orderBy(...(orderBy ?? [])).limit(take).offset(skip);
 * ```
 *
 * Relation filters assume the caller joined each relation under a table alias
 * matching the relation path (e.g. `db.select().from(users).leftJoin(member, ...)`).
 */
export const drizzleQueryAdapter = {
  /** Map a parsed query to `{ where, orderBy, skip, take }` for Drizzle. */
  map(query: ResourceQuery): {
    where: SQL | undefined;
    orderBy: SQL[] | undefined;
    skip: number;
    take: number;
  } {
    return QueryMapper.map(query, drizzleQueryAdapter);
  },

  buildWhere(query: ResourceQuery): SQL | undefined {
    return buildWhereFromQuery(query);
  },

  buildOrderBy(sort: SortExpression[]): SQL[] | undefined {
    if (sort.length === 0) return undefined;
    return sort.map((s) => sql.raw(`${quoteIdentifier(s.field)} ${s.direction.toUpperCase()}`));
  },

  buildSkipTake(page: number, limit: number): { skip: number; take: number } {
    return QueryMapper.toSkipTake(page, limit);
  },
} satisfies MappableAdapter<SQL, SQL[]>;

// ── Internal helpers ─────────────────────────────────────────────────────

function buildWhereFromQuery(query: ResourceQuery): SQL | undefined {
  const conditions: SQL[] = [];

  // Scalar filters
  for (const f of query.filters) {
    conditions.push(conditionFor(f.field, f.operator, f.value, f.caseSensitive));
  }

  // Relation filters
  for (const rel of query.relations) {
    conditions.push(...relationConditions(rel));
  }

  // Search → OR conditions
  const searchCondition = buildSearchCondition(query.search);
  if (searchCondition) {
    conditions.push(searchCondition);
  }

  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return and(...conditions);
}

function relationConditions(rel: RelationFilterExpression): SQL[] {
  const conditions: SQL[] = [];
  for (const f of rel.filters) {
    conditions.push(conditionFor(f.field, f.operator, f.value, f.caseSensitive, rel.relation));
  }
  return conditions;
}

function buildSearchCondition(search: SearchQuery | undefined): SQL | undefined {
  if (!search) return undefined;
  const parts: SQL[] = [];
  for (const term of search.terms) {
    const targetFields = term.field ? [term.field] : search.fields;
    // Phrase and contains both compile to a contiguous-substring (LIKE) match;
    // prefix uses a starts-with match.
    const op = term.match === 'prefix' ? 'startsWith' : 'contains';
    for (const f of targetFields) {
      const isCaseSensitive = term.caseSensitive ?? search.caseSensitiveFields?.includes(f);
      parts.push(conditionFor(f, op, term.value, isCaseSensitive));
    }
  }
  if (parts.length === 0) return undefined;
  return or(...parts);
}

function conditionFor(
  field: string,
  operator: FilterOperator,
  value?: unknown,
  caseSensitive?: boolean,
  relation?: string,
): SQL {
  const qualifiers = relation ? relation.split('.') : [];
  const colName = [...qualifiers, field].map(quoteIdentifier).join('.');
  const col = sql.raw(colName);
  // Case-insensitive string matching uses LOWER() on both sides — portable
  // across SQLite, PostgreSQL, and MySQL without database-specific collations.
  // Only applied to the string (LIKE) family; `caseSensitive` is emitted on
  // every filter, so equal/notEqual must stay plain to avoid LOWER() on
  // numeric/date columns.
  // LIKE always emits ESCAPE '\' so user-supplied % / _ are treated literally —
  // required because SQLite has no implicit backslash escaping (unlike PG/MySQL).
  const likeInsensitive = !caseSensitive && isStringOperator(operator);
  const likeTarget = likeInsensitive ? sql`LOWER(${col})` : sql`${col}`;
  const pattern: string | undefined = isStringOperator(operator)
    ? buildLikePattern(value, matchFor(operator), likeInsensitive)
    : undefined;

  const build = OPERATOR_SQL[operator];
  if (!build) {
    throw new QueryJSError(`Unsupported operator '${operator}'`, ErrorCode.UNSUPPORTED_OPERATOR, {
      operator,
    });
  }
  return build({ col, likeTarget, pattern, value });
}

function matchFor(operator: FilterOperator): LikeMatch {
  switch (operator) {
    case 'startsWith':
      return 'startsWith';
    case 'endsWith':
      return 'endsWith';
    default:
      return 'contains';
  }
}

interface OperatorContext {
  col: SQL;
  likeTarget: SQL;
  pattern?: string;
  value?: unknown;
}

const OPERATOR_SQL: Record<FilterOperator, (ctx: OperatorContext) => SQL> = {
  eq: ({ col, value }) =>
    nullClauseFor('eq', value) ? sql`${col} IS NULL` : sql`${col} = ${value}`,
  neq: ({ col, value }) =>
    nullClauseFor('neq', value) ? sql`${col} IS NOT NULL` : sql`${col} != ${value}`,
  gt: ({ col, value }) => sql`${col} > ${value}`,
  gte: ({ col, value }) => sql`${col} >= ${value}`,
  lt: ({ col, value }) => sql`${col} < ${value}`,
  lte: ({ col, value }) => sql`${col} <= ${value}`,
  contains: ({ likeTarget, pattern }) => sql`${likeTarget} LIKE ${pattern} ESCAPE '\\'`,
  startsWith: ({ likeTarget, pattern }) => sql`${likeTarget} LIKE ${pattern} ESCAPE '\\'`,
  endsWith: ({ likeTarget, pattern }) => sql`${likeTarget} LIKE ${pattern} ESCAPE '\\'`,
  in: ({ col, value }) => {
    const arr = value as unknown[];
    if (arr.length === 0) return sql`1=0`;
    const chunks = arr.map((v) => sql`${v}`);
    return sql`${col} IN (${sql.join(chunks, sql`, `)})`;
  },
  notIn: ({ col, value }) => {
    const arr = value as unknown[];
    if (arr.length === 0) return sql`1=1`;
    const chunks = arr.map((v) => sql`${v}`);
    return sql`${col} NOT IN (${sql.join(chunks, sql`, `)})`;
  },
  isNull: ({ col }) => sql`${col} IS NULL`,
  isNotNull: ({ col }) => sql`${col} IS NOT NULL`,
};

const SAFE_IDENTIFIER = /^[a-zA-Z_]\w*$/;

/** Quote an identifier only when it is unsafe (reserved words, unusual names). */
function quoteIdentifier(name: string): string {
  if (SAFE_IDENTIFIER.test(name)) return name;
  return `"${name.replaceAll('"', '""')}"`;
}

/**
 * DEBUG ONLY — serialize a Drizzle `SQL` chunk into a plain SQL string.
 *
 * The adapter's `where`/`orderBy` are Drizzle `SQL` fragments — you can pass
 * them straight to `.where()` / `.orderBy()`. When you need a human-readable
 * dump (e.g. for tests, logging, or eyeballing a query) this helper flattens
 * the chunk into its textual form.
 *
 * WARNING: the returned string is NOT runnable/injectable-safe SQL. Parameter
 * values are inlined literally without quoting or escaping (matching the
 * fragment's own rendering), so the text is only meaningful as a debug
 * representation. NEVER execute it, and never feed it back into `sql.raw()`.
 * Build parameterized queries with drizzle's `sql` tag for untrusted values.
 *
 * ```ts
 * import { toDrizzleSQL } from '@queryjs/drizzle';
 * const sqlText = toDrizzleSQL(where); // debug print only
 * ```
 */
export function toDrizzleSQL(where: SQL | undefined): string | undefined {
  if (!where) return undefined;
  const chunks: string[] = [];
  flattenChunks(where.queryChunks, chunks);
  return chunks.join('');
}

function flattenChunks(chunks: readonly unknown[], out: string[]): void {
  for (const chunk of chunks) {
    if (typeof chunk === 'string') {
      out.push(chunk);
    } else if (isSqlChunk(chunk)) {
      flattenChunks(chunk.queryChunks, out);
    } else if (
      chunk !== null &&
      typeof chunk === 'object' &&
      'value' in chunk &&
      Array.isArray((chunk as { value: unknown }).value)
    ) {
      out.push(String((chunk as { value: unknown[] }).value[0] ?? ''));
    } else if (chunk != null && typeof chunk !== 'object') {
      // Drizzle inlines numeric/boolean params as raw primitives.
      out.push(String(chunk));
    }
  }
}

function isSqlChunk(value: unknown): value is { queryChunks: readonly unknown[] } {
  return (
    value !== null &&
    typeof value === 'object' &&
    Array.isArray((value as { queryChunks?: unknown }).queryChunks)
  );
}
