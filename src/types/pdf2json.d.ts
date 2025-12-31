declare module 'pdf2json' {
  class PDFParser {
    constructor(options?: any, textOnly?: boolean)
    on(event: 'pdfParser_dataError', callback: (error: unknown) => void): void
    on(event: 'pdfParser_dataReady', callback: () => void): void
    parseBuffer(buffer: any, verbosity?: number): void
    getRawTextContent(): string
  }

  export default PDFParser
}
