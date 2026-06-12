declare module 'word-extractor' {
  type WordExtractorDocument = {
    getBody(): string
    getHeaders?(options?: { includeFooters?: boolean }): string
    getFooters?(): string
    getFootnotes?(): string
    getEndnotes?(): string
    getAnnotations?(): string
    getTextboxes?(options?: { includeHeadersAndFooters?: boolean; includeBody?: boolean }): string
  }

  class WordExtractor {
    extract(input: string | Buffer): Promise<WordExtractorDocument>
  }

  export = WordExtractor
}
