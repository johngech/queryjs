# @queryjs/client

A lightweight, zero-dependency, type-safe URL query builder for full-stack TypeScript applications. Seamlessly construct beautiful, secure URLs on the frontend that map instantly to your `@queryjs/core` (Prisma, Drizzle, TypeORM) backend backend parser.

[![npm version](https://shields.io)](https://npmjs.com)
[![License](https://shields.io)](https://github.com)
[![Bundle Size](https://shields.io)](https://bundlephobia.com)

---

## Why @queryjs/client?

* **Type-Safe Autocomplete:** Pass any vanilla TypeScript interface to get instant IDE autocompletion for fields, strict type-checking on values, and valid operators.
* **No More Loose Strings:** Replaces error-prone string literals (`'gt'`, `'_contains'`) with a powerful functional operator helper (`op.greaterThanOrEqual()`).
* **Zero Boilerplate:** Built specifically to match the wire-format required by `@queryjs/core` adapters.
* **Dual ESM/CJS Support:** Works out of the box in Next.js, Vite, Remix, Nuxt, Node.js, and mobile applications.

---

## Installation

```bash
npm install @queryjs/client
# or
yarn add @queryjs/client
# or
pnpm add @queryjs/client
```

---

## Quick Start

### 1. The Zero-Config / Implicit Mode
Get moving in under 10 seconds. Use it as a clean, fluent string builder without any complex types.

```typescript
import { createQuery, op } from '@queryjs/client';

const urlParams = createQuery()
  .filter('category', 'electronics') // Defaults to implicit equals
  .filter('price', op.greaterThanOrEqual(50))
  .filter('tags', op.in(['premium', 'sale']))
  .sort('createdAt', 'desc')
  .paginate({ page: 1, limit: 12 })
  .toString();

// Emits clean wire format:
// "filter[category]=electronics&filter[price][gte]=50&filter[tags][in][]=premium&filter[tags][in][]=sale&sort=-createdAt&page=1&limit=12"

const response = await fetch(`/api/products?${urlParams}`);
```

### 2. The High-Fidelity Type-Safe Mode (Recommended)
Pass your frontend data contract/interface directly to the builder. This prevents spelling mistakes on field keys, type mismatches on values, and invalid operator chains.

```typescript
import { createQuery, op } from '@queryjs/client';

// Simple model contract (No backend dependencies leaked to the client)
interface Product {
  id: string;
  title: string;
  price: number;
  category: 'electronics' | 'clothing';
  isActive: boolean;
  createdAt: string;
}

const urlParams = createQuery<Product>()
  .filter('category', 'electronics')            // Autocompletes keys & values
  .filter('price', op.greaterThanOrEqual(50))    // TypeScript errors if you pass a string like 'fifty'
  .filter('title', op.contains('laptop'))        // String specific helper
  .search('MacBook', 'prefix')                   // Strict search modifier completion
  .sort('createdAt', 'desc')                     // Validates 'createdAt', blocks arbitrary columns
  .paginate({ page: 2, limit: 25 })
  .toString();
```

---

## API Reference

### `.filter(fieldName, value | op.helper)`
Adds a filter payload constraint to the URL string. If an `op` helper is omitted, it implicitly generates an equivalence (`eq`) condition.

### The `op` (Operator) Helpers
Say goodbye to magic strings. Import `op` to access predictable, typesafe methods:

| Method | Generated Wire Format Key | Description |
| :--- | :--- | :--- |
| `op.equals(value)` | `[eq]` (or implicit) | Exact match |
| `op.notEquals(value)` | `[neq]` | Not equal to |
| `op.greaterThan(value)` | `[gt]` | Greater than |
| `op.greaterThanOrEqual(value)` | `[gte]` | Greater than or equal to |
| `op.lessThan(value)` | `[lt]` | Less than |
| `op.lessThanOrEqual(value)` | `[lte]` | Less than or equal to |
| `op.contains(string)` | `[contains]` | Substring wildcard match |
| `op.startsWith(string)` | `[startsWith]` | Match beginning of text |
| `op.endsWith(string)` | `[endsWith]` | Match end of text |
| `op.isNull()` | `[isNull]=true` | Is null checking |
| `op.isNotNull()` | `[isNotNull]=true` | Is not null checking |
| `op.in([...values])` | `[in][]=value` | Array collection inclusion |
| `op.notIn([...values])` | `[notIn][]=value` | Array collection exclusion |

### `.search(term, modifier?)`
Applies a global query string search payload. Optional modifiers include `'exact'`, `'prefix'`, and `'case-sensitive'`.

### `.sort(fieldName, direction?)`
Applies ordering logic. The directional parameter expects strictly either `'asc'` or `'desc'` (defaults to `'asc'`). Descending parameters are automatically prepended with a `-` token to match standard backend configurations.

### `.paginate({ page?, limit? })`
Appends pagination offset variables. Expects pure numbers.

---

## Ecosystem Integration

`@queryjs/client` pairs natively with any application running backend configurations backed by:
* `@queryjs/core`
* `@queryjs/prisma`
* `@queryjs/drizzle`
* `@queryjs/typeorm`

## License

MIT © [johngech](https://github.com)
