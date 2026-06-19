declare module 'pdf-parse' {
  export interface PDFParseTextResult {
    text: string
    total?: number
  }

  export interface PDFParseLoadParams {
    data?: Buffer | Uint8Array
    url?: string
  }

  export class PDFParse {
    constructor(params: PDFParseLoadParams)
    getText(params?: Record<string, unknown>): Promise<PDFParseTextResult>
    destroy?(): Promise<void>
  }
}
