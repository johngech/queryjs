import { describe, expect, it } from 'bun:test';
import { createQuery } from '../src/builder';
import { op } from '../src/operators';

interface Product {
  id: string;
  title: string;
  price: number;
  category: 'electronics' | 'clothing';
  isActive: boolean;
  createdAt: string;
}

describe('@queryjs/client', () => {
  it('generates zero-config implicit mode queries', () => {
    const urlParams = createQuery()
      .filter('category', 'electronics')
      .filter('price', op.greaterThanOrEqual(50))
      .filter('tags', op.in(['premium', 'sale']))
      .sort('createdAt', 'desc')
      .paginate({ page: 1, limit: 12 })
      .toString();

    expect(urlParams).toBe(
      'filter[category]=electronics&filter[price][gte]=50&filter[tags][in][]=premium&filter[tags][in][]=sale&sort=-createdAt&page=1&limit=12',
    );
  });

  it('generates high-fidelity type-safe mode queries', () => {
    const urlParams = createQuery<Product>()
      .filter('category', 'electronics')
      .filter('price', op.greaterThanOrEqual(50))
      .filter('title', op.contains('laptop'))
      .search('MacBook', 'prefix')
      .sort('createdAt', 'desc')
      .paginate({ page: 2, limit: 25 })
      .toString();

    expect(urlParams).toBe(
      'filter[category]=electronics&filter[price][gte]=50&filter[title][contains]=laptop&search=MacBook*&sort=-createdAt&page=2&limit=25',
    );
  });

  describe('operators', () => {
    it('supports equals and notEquals', () => {
      const builder = createQuery().filter('a', op.equals(1)).filter('b', op.notEquals(2));
      expect(builder.toString()).toBe('filter[a][eq]=1&filter[b][neq]=2');
    });

    it('supports greater/less than', () => {
      const builder = createQuery()
        .filter('a', op.greaterThan(1))
        .filter('b', op.lessThanOrEqual(2));
      expect(builder.toString()).toBe('filter[a][gt]=1&filter[b][lte]=2');
    });

    it('supports string operators', () => {
      const builder = createQuery()
        .filter('a', op.startsWith('hello'))
        .filter('b', op.endsWith('world'));
      expect(builder.toString()).toBe('filter[a][startsWith]=hello&filter[b][endsWith]=world');
    });

    it('supports null checking', () => {
      const builder = createQuery().filter('a', op.isNull()).filter('b', op.isNotNull());
      expect(builder.toString()).toBe('filter[a][isNull]=true&filter[b][isNotNull]=true');
    });

    it('supports in and notIn', () => {
      const builder = createQuery()
        .filter('a', op.in([1, 2]))
        .filter('b', op.notIn([3]));
      expect(builder.toString()).toBe('filter[a][in][]=1&filter[a][in][]=2&filter[b][notIn][]=3');
    });
  });

  describe('search', () => {
    it('appends multiple searches', () => {
      const builder = createQuery().search('hello', 'exact').search('world');
      expect(builder.toString()).toBe('search="hello"&search=world');
    });
  });
});
