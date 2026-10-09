import { isOpValue, type OpValue } from './operators';

export type SearchModifier = 'exact' | 'prefix';

export class QueryBuilder<T = Record<string, unknown>> {
  private readonly params = new URLSearchParams();

  filter<K extends string extends keyof T ? string : keyof T & string>(
    field: K,
    value:
      | (string extends keyof T ? unknown : K extends keyof T ? T[K] : never)
      | OpValue
      | undefined,
  ): this {
    if (value === undefined) return this;
    if (isOpValue(value)) {
      if (value._op === 'isNull' || value._op === 'isNotNull') {
        this.params.append(`filter[${field}][${value._op}]`, 'true');
      } else if (value._op === 'in' || value._op === 'notIn') {
        const arr = Array.isArray(value.value) ? value.value : [value.value];
        for (const v of arr) {
          this.params.append(`filter[${field}][${value._op}][]`, String(v));
        }
      } else {
        this.params.append(`filter[${field}][${value._op}]`, String(value.value));
      }
    } else {
      this.params.append(`filter[${field}]`, String(value));
    }
    return this;
  }

  search(term: string | undefined, modifier?: SearchModifier): this {
    if (!term) return this;
    let formattedTerm = term;
    if (modifier === 'exact') {
      formattedTerm = `"${term}"`;
    } else if (modifier === 'prefix') {
      formattedTerm = `${term}*`;
    }
    this.params.append('search', formattedTerm);
    return this;
  }

  sort<K extends string extends keyof T ? string : keyof T & string>(
    field: K | undefined,
    direction: 'asc' | 'desc' = 'asc',
  ): this {
    if (!field) return this;
    const value = direction === 'desc' ? `-${field}` : field;
    this.params.append('sort', value);
    return this;
  }

  paginate(options: { page?: number; limit?: number }): this {
    if (options.page !== undefined) {
      this.params.set('page', String(options.page));
    }
    if (options.limit !== undefined) {
      this.params.set('limit', String(options.limit));
    }
    return this;
  }

  toString(): string {
    return this.params
      .toString()
      .replaceAll('%5B', '[')
      .replaceAll('%5D', ']')
      .replaceAll('%22', '"');
  }
}

export function createQuery<T = Record<string, unknown>>(): QueryBuilder<T> {
  return new QueryBuilder<T>();
}
