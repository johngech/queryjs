/** Semantic search match type — application-level, not tied to any DB syntax. */
export type SearchMatch = 'contains' | 'prefix' | 'phrase';

/** A parsed search term with semantic match type. */
export interface SearchTerm {
  /** The text value to match against. */
  value: string;
  /** Semantic match type: contains (substring), prefix (starts-with), or phrase (exact substring). */
  match: SearchMatch;
  /** If set, restrict this term to a specific field (field:value syntax). */
  field?: string;
  /** Resolved from the field spec at parse time — true = case-sensitive matching. */
  caseSensitive?: boolean;
}

/** Configurable limits for search queries. */
export interface SearchLimits {
  /** Maximum total character length of the raw search string. */
  maxLength: number;
  /** Maximum number of parsed terms. */
  maxTerms: number;
  /** Maximum character length of a single term value. */
  maxTermLength: number;
}

/** Default search limits appropriate for API usage. */
export const DEFAULT_SEARCH_LIMITS: SearchLimits = {
  maxLength: 200,
  maxTerms: 10,
  maxTermLength: 100,
};

/** A parsed search query targeting specific fields. */
export interface SearchQuery {
  /** Original raw search string. */
  raw: string;
  /** Parsed terms from the search string. */
  terms: SearchTerm[];
  /** All searchable fields (derived from the spec). */
  fields: string[];
  /** Searchable fields that are explicitly case-sensitive. */
  caseSensitiveFields?: string[];
}
