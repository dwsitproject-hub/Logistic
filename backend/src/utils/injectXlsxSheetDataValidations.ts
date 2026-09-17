import * as CFB from 'cfb';

function entryToUtf8(content: unknown): string {
  if (content == null) return '';
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(content)) {
    return content.toString('utf8');
  }
  if (content instanceof Uint8Array) {
    return Buffer.from(content).toString('utf8');
  }
  if (Array.isArray(content)) {
    return Buffer.from(content as number[]).toString('utf8');
  }
  return String(content);
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type XlsxListDataValidation = {
  sqref: string;
  formula: string;
  error?: string;
};

function findEntryPath(cfb: ReturnType<typeof CFB.read>, suffix: string): string | null {
  const needle = suffix.replace(/^\/+/, '').replace(/\\/g, '/');
  const hit = cfb.FullPaths.find((p) => p.replace(/\\/g, '/').replace(/^\/+/, '').endsWith(needle));
  return hit ?? null;
}

/** OOXML worksheet child order: dataValidations comes before hyperlinks/print/ignoredErrors/drawing/extLst. */
function insertDataValidationsBlock(xml: string, block: string): string {
  const markers = [
    '<hyperlinks',
    '<printOptions',
    '<pageMargins',
    '<pageSetup',
    '<headerFooter',
    '<rowBreaks',
    '<colBreaks',
    '<customProperties',
    '<cellWatches',
    '<ignoredErrors',
    '<smartTags',
    '<drawing',
    '<picture',
    '<oleObjects',
    '<tableParts',
    '<extLst',
    '</worksheet>',
  ];
  for (const marker of markers) {
    const idx = xml.indexOf(marker);
    if (idx >= 0) {
      return xml.slice(0, idx) + block + xml.slice(idx);
    }
  }
  throw new Error('xlsx sheet XML missing insertion point for dataValidations');
}

/**
 * Community SheetJS does not write worksheet dataValidations. Patch the xlsx zip
 * so Excel shows native dropdowns.
 */
export function injectXlsxSheetDataValidations(
  xlsxBuffer: Buffer,
  sheetFile: string,
  validations: XlsxListDataValidation[],
): Buffer {
  if (validations.length === 0) return xlsxBuffer;
  const cfb = CFB.read(xlsxBuffer, { type: 'buffer' });
  const path = findEntryPath(cfb, sheetFile);
  if (!path) {
    throw new Error(`xlsx sheet not found: ${sheetFile}`);
  }
  const entry = CFB.find(cfb, path);
  if (!entry) {
    throw new Error(`xlsx sheet entry missing: ${path}`);
  }
  let xml = entryToUtf8(entry.content);
  xml = xml.replace(/<dataValidations\b[\s\S]*?<\/dataValidations>/g, '');
  const inner = validations
    .map((v) => {
      const error = v.error
        ? ` showErrorMessage="1" errorStyle="stop" errorTitle="Invalid" error="${xmlEscape(v.error)}"`
        : '';
      return (
        `<dataValidation type="list" allowBlank="1" showInputMessage="1"${error} sqref="${xmlEscape(v.sqref)}">` +
        `<formula1>${xmlEscape(v.formula)}</formula1>` +
        `</dataValidation>`
      );
    })
    .join('');
  const block = `<dataValidations count="${validations.length}">${inner}</dataValidations>`;
  xml = insertDataValidationsBlock(xml, block);
  const patched = Buffer.from(xml, 'utf8');
  const writable = entry as CFB.CFB$Entry & { content: Buffer };
  writable.content = patched;
  writable.size = patched.length;
  const out = CFB.write(cfb, { type: 'buffer', fileType: 'zip', compression: true });
  return Buffer.isBuffer(out) ? out : Buffer.from(out as Uint8Array);
}
