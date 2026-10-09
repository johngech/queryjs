import type {
  FilterExpression,
  RelationFilterExpression,
  ResourceQuery,
  SearchQuery,
  SortExpression,
} from '@queryjs/core';
import { type FilterOperator, nullClauseFor } from '@queryjs/core';
import type { MappableAdapter } from '@queryjs/core/compiler';
import { QueryMapper } from '@queryjs/core/compiler';

// ── Prisma types (inline to avoid peer dep) ──────────────────────────────

/** Prisma-compatible WhereInput shape. */
interface PrismaWhereInput {
  [key: string]: unknown;
  AND?: PrismaWhereInput[];
  OR?: PrismaWhereInput[];
  NOT?: PrismaWhereInput[];
}

/** Prisma-compatible OrderByInput shape. */
interface PrismaOrderByInput {
  [key: string]: 'asc' | 'desc';
}

// ── Internal Helpers ───────────────────────────────────────────────────────

const OPERATOR_MAP: Record<
  FilterOperator,
  (value: unknown, caseSensitive?: boolean) => Record<string, unknown>
> = {
  eq: (value) => (nullClauseFor('eq', value) ? { equals: null } : { equals: value }),
  neq: (value) => (nullClauseFor('neq', value) ? { not: null } : { not: value }),
  in: (value) => ({ in: value }),
  notIn: (value) => ({ notIn: value }),
  gt: (value) => ({ gt: value }),
  gte: (value) => ({ gte: value }),
  lt: (value) => ({ lt: value }),
  lte: (value) => ({ lte: value }),
  contains: (value, caseSensitive) => ({
    contains: value,
    ...modeClause(caseSensitive),
  }),
  startsWith: (value, caseSensitive) => ({
    startsWith: value,
    ...modeClause(caseSensitive),
  }),
  endsWith: (value, caseSensitive) => ({
    endsWith: value,
    ...modeClause(caseSensitive),
  }),
  isNull: () => ({ equals: null }),
  isNotNull: () => ({ not: null }),
};

/**
 * Prisma's `mode: 'insensitive'` is only supported on PostgreSQL, CockroachDB,
 * and MySQL — SQL Server and SQLite reject it at runtime. `caseSensitive`
 * defaults to `false`, so every substring filter and search term emits
 * `mode` and will throw on those providers. Call `.caseSensitive()` on string
 * fields when targeting unsupported providers, or gate the adapter by provider.
 */
function modeClause(caseSensitive?: boolean): Record<string, string> {
  return caseSensitive ? {} : { mode: 'insensitive' };
}

/**
 * Define an own key without tripping the `__proto__` setter. Adapters treat
 * `ResourceQuery` as trusted input, but a hand-built query with a `__proto__`
 * field name would otherwise silently corrupt the produced where object.
 */
function setOwnWhereField(
  target: Record<string, Record<string, unknown>>,
  key: string,
  value: Record<string, unknown>,
): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/**
 * Build a Prisma where object from filter expressions, grouping conditions per field.
 *
 * A single operator per field renders as the compact merged shape (the
 * property keys are Prisma's own WhereInput names, e.g. `{ equals: 'ACTIVE' }`
 * — not QueryJS operator ids). When a field carries two or more operators,
 * they are emitted as separate objects under `AND` — Prisma cannot always
 * combine arbitrary operators (e.g. `greaterThanOrEqual` + `equals`) in one
 * field filter, whereas an `AND` list merges them deterministically.
 */
function buildScalarWhere(filters: FilterExpression[]): Record<string, unknown> {
  const perField = new Map<string, Record<string, unknown>[]>();

  for (const f of filters) {
    const clause = OPERATOR_MAP[f.operator](f.value, f.caseSensitive);
    const list = perField.get(f.field) ?? [];
    list.push(clause);
    perField.set(f.field, list);
  }

  const hasMultiOpField = [...perField.values()].some((list) => list.length > 1);

  if (!hasMultiOpField) {
    const where: Record<string, Record<string, unknown>> = {};
    for (const [field, clauses] of perField) {
      setOwnWhereField(where, field, clauses[0]);
    }
    return where;
  }

  const andConditions: Record<string, unknown>[] = [];
  for (const [field, clauses] of perField) {
    for (const clause of clauses) {
      andConditions.push({ [field]: clause });
    }
  }
  return { AND: andConditions };
}

function searchToWhere(search: SearchQuery): Record<string, unknown> {
  const fieldClauses: Record<string, unknown>[] = [];

  for (const term of search.terms) {
    const targetFields = term.field ? [term.field] : search.fields;

    // Phrase and contains both compile to a contiguous-substring match; prefix
    // uses a starts-with match.
    const op = term.match === 'prefix' ? 'startsWith' : 'contains';
    for (const f of targetFields) {
      const isCaseSensitive = term.caseSensitive ?? search.caseSensitiveFields?.includes(f);
      fieldClauses.push({
        [f]: { [op]: term.value, ...modeClause(isCaseSensitive) },
      });
    }
  }

  if (fieldClauses.length === 1) return fieldClauses[0];
  return { OR: fieldClauses };
}

/** Build a nested relation where clause from a (possibly dotted) relation path. */
function relationToWhere(rel: RelationFilterExpression): Record<string, unknown> {
  const segments = rel.relation.split('.');
  let node: Record<string, unknown> = buildScalarWhere(rel.filters);
  for (let i = segments.length - 1; i >= 0; i--) {
    node = { [segments[i]]: node };
  }
  return node;
}

function toWhere(query: ResourceQuery): PrismaWhereInput | undefined {
  const parts: Record<string, unknown>[] = [];

  if (query.filters.length > 0) {
    parts.push(buildScalarWhere(query.filters));
  }

  for (const rel of query.relations) {
    parts.push(relationToWhere(rel));
  }

  if (query.search) {
    parts.push(searchToWhere(query.search));
  }

  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0] as PrismaWhereInput;
  return { AND: parts as PrismaWhereInput[] };
}

// ── Prisma Adapter ───────────────────────────────────────────────────────

/**
 * Adapter for Prisma ORM.
 * Translates QueryJS's application-level queries to Prisma-compatible
 * `where`, `orderBy`, and `skip/take` arguments.
 */
export const prismaQueryAdapter = {
  /** Map a parsed query to `{ where, orderBy, skip, take }` for Prisma. */
  map(query: ResourceQuery): {
    where: PrismaWhereInput | undefined;
    orderBy: PrismaOrderByInput[] | undefined;
    skip: number;
    take: number;
  } {
    return QueryMapper.map(query, prismaQueryAdapter);
  },

  buildWhere(query: ResourceQuery): PrismaWhereInput | undefined {
    return toWhere(query);
  },

  buildOrderBy(sort: SortExpression[]): PrismaOrderByInput[] | undefined {
    const orderBy = QueryMapper.toOrderBy(sort);
    return orderBy as PrismaOrderByInput[] | undefined;
  },

  buildSkipTake(page: number, limit: number): { skip: number; take: number } {
    return QueryMapper.toSkipTake(page, limit);
  },
} satisfies MappableAdapter<PrismaWhereInput, PrismaOrderByInput[]>;

export type { PrismaOrderByInput, PrismaWhereInput };
