export interface OpValue {
  _op: string;
  value: unknown;
}

export const op = {
  equals: (value: unknown): OpValue => ({ _op: 'eq', value }),
  notEquals: (value: unknown): OpValue => ({ _op: 'neq', value }),
  greaterThan: (value: unknown): OpValue => ({ _op: 'gt', value }),
  greaterThanOrEqual: (value: unknown): OpValue => ({ _op: 'gte', value }),
  lessThan: (value: unknown): OpValue => ({ _op: 'lt', value }),
  lessThanOrEqual: (value: unknown): OpValue => ({ _op: 'lte', value }),
  contains: (value: string): OpValue => ({ _op: 'contains', value }),
  startsWith: (value: string): OpValue => ({ _op: 'startsWith', value }),
  endsWith: (value: string): OpValue => ({ _op: 'endsWith', value }),
  isNull: (): OpValue => ({ _op: 'isNull', value: 'true' }),
  isNotNull: (): OpValue => ({ _op: 'isNotNull', value: 'true' }),
  in: (value: unknown[]): OpValue => ({ _op: 'in', value }),
  notIn: (value: unknown[]): OpValue => ({ _op: 'notIn', value }),
};

export function isOpValue(val: unknown): val is OpValue {
  return typeof val === 'object' && val !== null && '_op' in val;
}
