import type { FilterExpression, ResourceQuery, SearchQuery, SortExpression } from '@queryjs/core';
import { buildLikePattern, type FilterOperator, nullClauseFor } from '@queryjs/core';
import type { MappableAdapter } from '@queryjs/core/compiler';
import { QueryMapper } from '@queryjs/core/compiler';
import {
  And,
  Equal,
  FindOperator,
  ILike,
  In,
  IsNull,
  LessThan,
  LessThanOrEqual,
  Like,
  MoreThan,
  MoreThanOrEqual,
  Not,
} from 'typeorm';

// ── TypeORM types ─────────────────────────────────────────────────────────────

/** TypeORM-compatible WhereOptions shape. */
type TypeORMWhere = Record<string, unknown>;

/** TypeORM-compatible OrderBy shape. */
type TypeORMOrderBy = Record<string, 'ASC' | 'DESC'>;

// ── TypeORM Adapter ───────────────────────────────────────────────────────────

/**
 * Adapter for TypeORM.
 * Translates QueryJS's application-level queries to TypeORM-compatible
 * `where`, `order`, and `skip/take` arguments using real `FindOperator`s
 * (`In`, `Not`, `MoreThan`, `ILike`, `IsNull`, ...).
 *
 * Multiple operators on the same field are combined with TypeORM's `And()`
 * (e.g. `age[greaterThanOrEqual]=18&age[lessThan]=65` → `{ age: And(MoreThanOrEqual(18), LessThan(65)) }`).
 * Search conditions are OR-joined using TypeORM's array-where form.
 */
export const typeormQueryAdapter = {
  /** Map a parsed query to `{ where, orderBy, skip, take }` for TypeORM. */
  map(query: ResourceQuery): {
    where: TypeORMWhere | TypeORMWhere[] | undefined;
    orderBy: TypeORMOrderBy | undefined;
    skip: number;
    take: number;
  } {
    return QueryMapper.map(query, typeormQueryAdapter);
  },

  buildWhere(query: ResourceQuery): TypeORMWhere | TypeORMWhere[] | undefined {
    return buildWhereFromQuery(query);
  },

  buildOrderBy(sort: SortExpression[]): TypeORMOrderBy | undefined {
    if (sort.length === 0) return undefined;
    const order: TypeORMOrderBy = {};
    for (const s of sort) {
      setOwnKey(order, s.field, directionToTypeORM(s.direction));
    }
    return order;
  },

  buildSkipTake(page: number, limit: number): { skip: number; take: number } {
    return QueryMapper.toSkipTake(page, limit);
  },
} satisfies MappableAdapter<TypeORMWhere | TypeORMWhere[], TypeORMOrderBy>;

// ── Internal helpers ──────────────────────────────────────────────────────────

function directionToTypeORM(direction: 'asc' | 'desc'): 'ASC' | 'DESC' {
  return direction === 'asc' ? 'ASC' : 'DESC';
}

function buildWhereFromQuery(query: ResourceQuery): TypeORMWhere | TypeORMWhere[] | undefined {
  // Spread (not Object.assign) so an own `__proto__` filter key survives:
  // Object.assign copies via [[Set]], which hits the prototype setter and drops
  // the key entirely. Spread uses CreateDataProperty and preserves it.
  const base: TypeORMWhere = query.filters.length > 0 ? { ...buildScalarWhere(query.filters) } : {};
  for (const rel of query.relations) {
    setNestedWhere(base, rel.relation, buildScalarWhere(rel.filters));
  }

  const searchAlternatives = query.search ? searchToWhere(query.search) : [];
  if (searchAlternatives.length === 0) {
    return Object.keys(base).length === 0 ? undefined : base;
  }

  // Search conditions are OR-joined over fields; each alternative must be
  // ANDed with the base filter set. When a search term targets a field that
  // already has a scalar filter, the two must be AND-combined per field
  // (naive `{ ...base, ...alt }` would silently drop the scalar filter).
  const combined = searchAlternatives.map((alt) => andWhere(base, alt));
  return combined.length === 1 ? combined[0] : combined;
}

/** AND-combine a search alternative into the base where, merging same-field keys. */
function andWhere(base: TypeORMWhere, alt: TypeORMWhere): TypeORMWhere {
  const merged: TypeORMWhere = { ...base };
  for (const [field, searchValue] of Object.entries(alt)) {
    const existing = merged[field];
    if (existing === undefined) {
      setOwnKey(merged, field, searchValue);
    } else {
      const baseValue = existing instanceof FindOperator ? existing : Equal(existing as never);
      setOwnKey(
        merged,
        field,
        And(
          baseValue,
          searchValue instanceof FindOperator ? searchValue : Equal(searchValue as never),
        ),
      );
    }
  }
  return merged;
}

/** Group filters per field, AND-combining multiple operators on the same field. */
function buildScalarWhere(filters: FilterExpression[]): TypeORMWhere {
  const grouped = new Map<string, unknown[]>();

  for (const f of filters) {
    const op = OPERATORS[f.operator](f.value, f.caseSensitive);
    const list = grouped.get(f.field) ?? [];
    list.push(op);
    grouped.set(f.field, list);
  }

  const where: TypeORMWhere = {};
  for (const [field, ops] of grouped) {
    // A single `eq` renders as a bare value (TypeORM treats it as equality and
    // tests lock that shape). When a field carries multiple operators, wrap any
    // non-operator values in `Equal(...)` so `And()` only sees FindOperators.
    if (ops.length === 1) {
      setOwnKey(where, field, ops[0]);
    } else {
      const combined = ops.map((value) =>
        value instanceof FindOperator ? value : Equal(value as never),
      );
      setOwnKey(where, field, And(...(combined as FindOperator<unknown>[])) as unknown);
    }
  }
  return where;
}

/** Assign `value` at a dotted path in `target`, creating intermediate objects. */
function setNestedWhere(target: TypeORMWhere, key: string, value: unknown): void {
  const segments = key.split('.');
  let node: TypeORMWhere = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    // Own-property check only — never resolve a path segment through the
    // prototype chain (a `__proto__` segment would otherwise walk the target's
    // prototype and pollute it).
    const existing = Object.hasOwn(node, segment) ? node[segment] : undefined;
    if (existing === undefined || typeof existing !== 'object' || existing === null) {
      setOwnKey(node, segment, {});
    }
    node = node[segment] as TypeORMWhere;
  }
  setOwnKey(node, segments[segments.length - 1], value);
}

/**
 * Define an own key without tripping the `__proto__` setter. Adapters treat
 * `ResourceQuery` as trusted input, but a hand-built query with a `__proto__`
 * field/sort key would otherwise be silently dropped (the prototype setter
 * swallows the assignment and no own property is created).
 */
function setOwnKey(target: TypeORMWhere, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

const OPERATORS: Record<FilterOperator, (value: unknown, caseSensitive?: boolean) => unknown> = {
  eq: (value) => (nullClauseFor('eq', value) ? IsNull() : value),
  neq: (value) => (nullClauseFor('neq', value) === 'notNull' ? Not(IsNull()) : Not(value)),
  in: (value) => In(value as unknown[]),
  notIn: (value) => Not(In(value as unknown[])),
  gt: (value) => MoreThan(value),
  gte: (value) => MoreThanOrEqual(value),
  lt: (value) => LessThan(value),
  lte: (value) => LessThanOrEqual(value),
  contains: (value, caseSensitive) => like(caseSensitive)(buildLikePattern(value, 'contains')),
  startsWith: (value, caseSensitive) => like(caseSensitive)(buildLikePattern(value, 'startsWith')),
  endsWith: (value, caseSensitive) => like(caseSensitive)(buildLikePattern(value, 'endsWith')),
  isNull: () => IsNull(),
  isNotNull: () => Not(IsNull()),
};

function like(caseSensitive?: boolean): (pattern: string) => FindOperator<string> {
  return caseSensitive === true ? Like : ILike;
}

/** Build one where-alternative per (term, field) — TypeORM's array-where OR. */
function searchToWhere(search: SearchQuery): TypeORMWhere[] {
  const alternatives: TypeORMWhere[] = [];

  for (const term of search.terms) {
    const targetFields = term.field ? [term.field] : search.fields;
    // Phrase and contains both compile to a contiguous-substring (LIKE) match;
    // prefix uses a starts-with match. Escaping goes through the shared builder.
    const match = term.match === 'prefix' ? 'startsWith' : 'contains';
    for (const f of targetFields) {
      const isCaseSensitive = term.caseSensitive ?? search.caseSensitiveFields?.includes(f);
      const op = like(isCaseSensitive);
      alternatives.push({ [f]: op(buildLikePattern(term.value, match)) });
    }
  }

  return alternatives;
}

export type { TypeORMOrderBy, TypeORMWhere };
