// Builds small, valid Word, Excel and PowerPoint files in memory (Office files are zip archives of
// XML parts), so the readers are tested on real files without binary fixtures in the repo.
import JSZip from 'jszip';

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rel = (id: string, type: string, target: string) =>
  `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
const rels = (...r: string[]) => `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${r.join('')}</Relationships>`;

export type DocxPart = { heading?: 1 | 2 | 3; text?: string; table?: string[][] };

export async function makeDocx(parts: DocxPart[]): Promise<Uint8Array> {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const para = (text: string, style?: string) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
  const body = parts
    .map((p) =>
      p.table
        ? `<w:tbl>${p.table.map((row) => `<w:tr>${row.map((c) => `<w:tc>${para(c)}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`
        : para(p.text ?? '', p.heading ? `Heading${p.heading}` : undefined),
    )
    .join('');
  const style = (n: number) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/></w:style>`;
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
  );
  zip.file('_rels/.rels', rels(rel('rId1', 'officeDocument', 'word/document.xml')));
  zip.file('word/_rels/document.xml.rels', rels(rel('rId1', 'styles', 'styles.xml')));
  zip.file('word/styles.xml', `${XML}<w:styles ${W}>${style(1)}${style(2)}${style(3)}</w:styles>`);
  zip.file('word/document.xml', `${XML}<w:document ${W}><w:body>${body}</w:body></w:document>`);
  return zip.generateAsync({ type: 'uint8array' });
}

export async function makeXlsx(sheets: { name: string; rows: (string | number)[][] }[]): Promise<Uint8Array> {
  const colName = (i: number) => String.fromCharCode(65 + i);
  const sheetXml = (rows: (string | number)[][]) =>
    `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows
      .map(
        (r, ri) =>
          `<row r="${ri + 1}">${r
            .map((v, ci) =>
              typeof v === 'number' ? `<c r="${colName(ci)}${ri + 1}"><v>${v}</v></c>` : `<c r="${colName(ci)}${ri + 1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`,
            )
            .join('')}</row>`,
      )
      .join('')}</sheetData></worksheet>`;
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
      .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
      .join('')}</Types>`,
  );
  zip.file('_rels/.rels', rels(rel('rId1', 'officeDocument', 'xl/workbook.xml')));
  zip.file('xl/_rels/workbook.xml.rels', rels(...sheets.map((_, i) => rel(`rId${i + 1}`, 'worksheet', `worksheets/sheet${i + 1}.xml`))));
  zip.file(
    'xl/workbook.xml',
    `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
      .map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join('')}</sheets></workbook>`,
  );
  sheets.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows)));
  return zip.generateAsync({ type: 'uint8array' });
}

export async function makePptx(slides: { lines: string[]; notes?: string }[], order?: number[]): Promise<Uint8Array> {
  const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const paras = (lines: string[]) => lines.map((l) => `<a:p><a:r><a:t>${esc(l)}</a:t></a:r></a:p>`).join('');
  const zip = new JSZip();
  const ids = order ?? slides.map((_, i) => i);
  zip.file('ppt/presentation.xml', `${XML}<p:presentation ${A}><p:sldIdLst>${ids.map((i) => `<p:sldId id="${256 + i}" r:id="rId${i + 10}"/>`).join('')}</p:sldIdLst></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', rels(...slides.map((_, i) => rel(`rId${i + 10}`, 'slide', `slides/slide${i + 1}.xml`))));
  slides.forEach((s, i) => {
    zip.file(`ppt/slides/slide${i + 1}.xml`, `${XML}<p:sld ${A}><p:cSld><p:spTree><p:sp><p:txBody>${paras(s.lines)}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
    if (s.notes) {
      zip.file(`ppt/slides/_rels/slide${i + 1}.xml.rels`, rels(rel('rId1', 'notesSlide', `../notesSlides/notesSlide${i + 1}.xml`)));
      // A slide-number placeholder ("3") in notes is dropped by the reader.
      zip.file(`ppt/notesSlides/notesSlide${i + 1}.xml`, `${XML}<p:notes ${A}><p:cSld><p:spTree><p:sp><p:txBody>${paras([s.notes, String(i + 1)])}</p:txBody></p:sp></p:spTree></p:cSld></p:notes>`);
    }
  });
  return zip.generateAsync({ type: 'uint8array' });
}
