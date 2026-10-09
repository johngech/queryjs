import type { ResourceQueryDefinition } from '../definition/types';
import type { SearchLimits, SearchMatch, SearchQuery, SearchTerm } from '../query/index';
import { DEFAULT_SEARCH_LIMITS } from '../query/index';
import { ErrorCode, QueryJSError } from '../query/queryjs-error';

interface TokenizedPiece {
  value: string;
  phrase: boolean;
}

/**
 * Parses and validates a search query against a {@link ResourceQueryDefinition}.
 * Produces an application-level {@link SearchQuery} — no ORM types.
 *
 * Supported syntax:
 *   ?search=abebe                   → contains match (substring, any searchable field)
 *   ?search="abebe beke"            → phrase match (exact substring, any field)
 *   ?search=abe*                    → prefix match (words starting with "abe")
 *   ?search=firstName:abebe         → field-specific match (restrict to firstName)
 *   ?search=firstName:abe*          → field-specific prefix match
 *   ?search="abebe beke" firstName:abe* → mixed terms (phrase + prefix + field-specific)
 *
 * Terms are combined with OR across searchable fields.
 * Quoted strings are treated as a single phrase term.
 */
export class QuerySearchEngine {
  static buildSearch(
    raw: string | undefined,
    spec: ResourceQueryDefinition,
    limits: SearchLimits = DEFAULT_SEARCH_LIMITS,
  ): SearchQuery | undefined {
    if (raw === undefined || raw === null) return undefined;

    const trimmed = String(raw).trim();
    if (trimmed.length === 0) return undefined;

    if (trimmed.length > limits.maxLength) {
      throw new QueryJSError(
        `Search query exceeds maximum length of ${limits.maxLength} characters`,
        ErrorCode.SEARCH_TOO_LONG,
      );
    }

    const fields = QuerySearchEngine.collectSearchableFields(spec);
    const caseSensitiveFields = QuerySearchEngine.collectCaseSensitiveFields(spec);
    if (fields.length === 0) {
      throw new QueryJSError(
        'Search is not supported for this resource',
        ErrorCode.NO_SEARCHABLE_FIELDS,
      );
    }

    const terms = QuerySearchEngine.parseTerms(trimmed, spec, limits);

    const result: SearchQuery = { raw: trimmed, terms, fields };
    if (caseSensitiveFields.length > 0) {
      result.caseSensitiveFields = caseSensitiveFields;
    }
    return result;
  }

  /** Collect all field names where searchable === true. */
  private static collectSearchableFields(spec: ResourceQueryDefinition): string[] {
    const fields: string[] = [];
    for (const [name, def] of Object.entries(spec.fields)) {
      if (def.searchable) {
        fields.push(name);
      }
    }
    return fields;
  }

  /** Collect all searchable field names where caseSensitive === true. */
  private static collectCaseSensitiveFields(spec: ResourceQueryDefinition): string[] {
    const fields: string[] = [];
    for (const [name, def] of Object.entries(spec.fields)) {
      if (def.searchable && def.caseSensitive) {
        fields.push(name);
      }
    }
    return fields;
  }

  /**
   * Parse the raw search string into SearchTerms.
   */
  private static parseTerms(
    raw: string,
    spec: ResourceQueryDefinition,
    limits: SearchLimits,
  ): SearchTerm[] {
    const pieces = QuerySearchEngine.tokenize(raw);
    const terms: SearchTerm[] = [];

    for (const piece of pieces) {
      const term = QuerySearchEngine.parseOneTerm(piece, spec);
      terms.push(term);
    }

    if (terms.length === 0) {
      throw new QueryJSError('Search query is empty after parsing', ErrorCode.EMPTY_SEARCH_QUERY);
    }

    if (terms.length > limits.maxTerms) {
      throw new QueryJSError(
        `Search query exceeds maximum of ${limits.maxTerms} terms`,
        ErrorCode.TOO_MANY_SEARCH_TERMS,
      );
    }

    for (const term of terms) {
      if (term.value.length > limits.maxTermLength) {
        throw new QueryJSError(
          `Search term exceeds maximum length of ${limits.maxTermLength} characters`,
          ErrorCode.SEARCH_TERM_TOO_LONG,
        );
      }
    }

    return terms;
  }

  /**
   * Tokenize a search string, respecting quoted phrases.
   */
  private static tokenize(raw: string): TokenizedPiece[] {
    const pieces: TokenizedPiece[] = [];
    let i = 0;

    while (i < raw.length) {
      // Skip whitespace
      while (i < raw.length && (raw[i] === ' ' || raw[i] === '\t')) i++;
      if (i >= raw.length) break;

      if (raw[i] === '"') {
        // Quoted phrase: find matching close quote
        i++; // skip opening quote
        const start = i;
        while (i < raw.length && raw[i] !== '"') i++;
        if (i >= raw.length) {
          throw new QueryJSError(
            'Unterminated search phrase (missing closing quote)',
            ErrorCode.UNTERMINATED_PHRASE,
          );
        }
        const phrase = raw.slice(start, i);
        i++; // skip closing quote
        if (phrase.length > 0) {
          pieces.push({ value: phrase, phrase: true });
        }
      } else {
        // Unquoted token: read until whitespace
        const start = i;
        while (i < raw.length && raw[i] !== ' ' && raw[i] !== '\t') i++;
        pieces.push({ value: raw.slice(start, i), phrase: false });
      }
    }

    return pieces;
  }

  /**
   * Parse a single token into a SearchTerm.
   * Handles field:value prefix and trailing * for prefix matching.
   */
  private static parseOneTerm(piece: TokenizedPiece, spec: ResourceQueryDefinition): SearchTerm {
    let field: string | undefined;
    let value = piece.value;
    const isPhrase = piece.phrase;

    // Field:value syntax only applies to non-phrase tokens
    if (!isPhrase) {
      const colonIdx = value.indexOf(':');
      if (colonIdx > 0) {
        const maybeField = value.slice(0, colonIdx);
        if (Object.hasOwn(spec.fields, maybeField)) {
          if (!spec.fields[maybeField].searchable) {
            throw new QueryJSError(
              `Cannot search on field '${maybeField}' (not a searchable field)`,
              ErrorCode.NON_SEARCHABLE_FIELD,
              { field: maybeField },
            );
          }
          field = maybeField;
          value = value.slice(colonIdx + 1);
        } else {
          // Unknown field — reject deterministically
          throw new QueryJSError(
            `Unknown search field '${maybeField}'`,
            ErrorCode.UNKNOWN_SEARCH_FIELD,
            { field: maybeField },
          );
        }
      }
    }

    // Reject standalone * (empty prefix) — covers both `*` and `field:*`
    if (!isPhrase && value === '*') {
      throw new QueryJSError(
        `Empty search value in term '${piece.value}'`,
        ErrorCode.EMPTY_SEARCH_VALUE,
      );
    }

    // Trailing * (prefix match) — only for non-phrase tokens with a real prefix value
    let match: SearchMatch = isPhrase ? 'phrase' : 'contains';
    if (!isPhrase && value.length > 1 && value.endsWith('*')) {
      match = 'prefix';
      value = value.slice(0, -1);
    }

    // Validate the value is not empty
    if (value.trim().length === 0) {
      throw new QueryJSError(
        `Empty search value in term '${piece.value}'`,
        ErrorCode.EMPTY_SEARCH_VALUE,
      );
    }

    // Resolve caseSensitive from the field spec (falls back to undefined = insensitive)
    const caseSensitive = field ? spec.fields[field]?.caseSensitive : undefined;

    const term: SearchTerm = { value: value.trim(), match };
    if (field) term.field = field;
    if (caseSensitive !== undefined) term.caseSensitive = caseSensitive;
    return term;
  }
}
