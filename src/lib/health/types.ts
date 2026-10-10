/** A stored Google Health record as the selectors see it: the indexed fields plus the raw DataPoint. */
export interface StoredPoint {
  date: string
  start: string | null
  end: string | null
  data: unknown
}
