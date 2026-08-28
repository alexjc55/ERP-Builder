import JSZip from "jszip";

const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_XML_BYTES = 8 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 500;
const TAG = /\{\{\s*([#/])?\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}/g;
const HYPERLINK_RELATIONSHIP_TYPES = new Set([
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
  "http://purl.oclc.org/ooxml/officeDocument/relationships/hyperlink",
]);

type XmlNode =
  | { kind: "text"; value: string }
  | { kind: "raw"; value: string }
  | { kind: "element"; name: string; open: string; close: string; children: XmlNode[] };

export interface DocumentManifest {
  scalars: string[];
  collections: Record<string, string[]>;
  errors: string[];
}

function decodeXml(value: string): string {
  return value.replace(/&(?:#x([0-9a-f]+)|#([0-9]+)|amp|lt|gt|quot|apos);/gi, (m, hex, dec) => {
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    if (dec) return String.fromCodePoint(Number.parseInt(dec, 10));
    return ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" } as Record<string, string>)[m] ?? m;
  });
}

function decodeXmlAttribute(value: string): string {
  if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(value)) {
    throw new Error("Malformed XML entity in DOCX relationship attribute");
  }
  return decodeXml(value);
}

function encodeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Small non-validating XML tree reader. It never searches or mutates raw XML. */
function parseXml(xml: string): XmlNode[] {
  const root: XmlNode[] = [];
  const stack: { node: Extract<XmlNode, { kind: "element" }>; parent: XmlNode[] }[] = [];
  let out = root;
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) {
      if (i < xml.length) out.push({ kind: "text", value: xml.slice(i) });
      break;
    }
    if (lt > i) out.push({ kind: "text", value: xml.slice(i, lt) });
    let j = lt + 1;
    let quote = "";
    for (; j < xml.length; j += 1) {
      const c = xml[j]!;
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
    }
    if (j >= xml.length) throw new Error("Malformed XML in DOCX");
    const token = xml.slice(lt, j + 1);
    if (token.startsWith("<?") || token.startsWith("<!") || token.startsWith("</")) {
      if (token.startsWith("</")) {
        const name = token.slice(2, -1).trim();
        const frame = stack.pop();
        if (!frame || frame.node.name !== name) throw new Error("Malformed XML element nesting in DOCX");
        frame.node.close = token;
        out = frame.parent;
      } else out.push({ kind: "raw", value: token });
    } else {
      const name = token.slice(1).match(/^([^\s/>]+)/)?.[1];
      if (!name) throw new Error("Malformed XML element in DOCX");
      const node: Extract<XmlNode, { kind: "element" }> = { kind: "element", name, open: token, close: "", children: [] };
      out.push(node);
      if (!token.endsWith("/>")) {
        stack.push({ node, parent: out });
        out = node.children;
      }
    }
    i = j + 1;
  }
  if (stack.length) throw new Error("Unclosed XML element in DOCX");
  return root;
}

function serialize(nodes: XmlNode[]): string {
  return nodes.map((n) => n.kind === "element" ? n.open + serialize(n.children) + n.close : n.value).join("");
}

function elements(nodes: XmlNode[], name: string, found: Extract<XmlNode, { kind: "element" }>[] = []) {
  for (const node of nodes) {
    if (node.kind !== "element") continue;
    if (node.name === name) found.push(node);
    elements(node.children, name, found);
  }
  return found;
}

function textNodes(node: Extract<XmlNode, { kind: "element" }>): Extract<XmlNode, { kind: "text" }>[] {
  return elements(node.children, "w:t").flatMap((t) =>
    t.children.filter((n): n is Extract<XmlNode, { kind: "text" }> => n.kind === "text"));
}

function logicalText(node: Extract<XmlNode, { kind: "element" }>): string {
  return textNodes(node).map((n) => decodeXml(n.value)).join("");
}

function setLogicalText(node: Extract<XmlNode, { kind: "element" }>, value: string): void {
  const nodes = textNodes(node);
  if (!nodes.length) return;
  nodes[0]!.value = encodeXml(value);
  for (let i = 1; i < nodes.length; i += 1) nodes[i]!.value = "";
}

/* Replace logical tags without moving all paragraph text into the first run.
 * The replacement belongs to the run where the tag starts; overlapping tag
 * characters are removed from subsequent runs, preserving their surrounding
 * formatting and text. */
function replaceTags(node: Extract<XmlNode, { kind: "element" }>, resolve: (raw: string, sigil: string | undefined, key: string) => string): void {
  const nodes = textNodes(node);
  const original = nodes.map((n) => decodeXml(n.value));
  const text = original.join("");
  const offsets: number[] = [];
  let cursor = 0;
  for (const part of original) { offsets.push(cursor); cursor += part.length; }
  const locate = (at: number) => {
    let i = nodes.length - 1;
    for (let n = 0; n < nodes.length; n += 1) if (at < offsets[n]! + original[n]!.length) { i = n; break; }
    return { i, offset: at - offsets[i]! };
  };
  const matches = [...text.matchAll(TAG)].reverse();
  for (const match of matches) {
    const start = locate(match.index!);
    const end = locate(match.index! + match[0]!.length);
    const replacement = resolve(match[0]!, match[1], match[2]!);
    const startText = decodeXml(nodes[start.i]!.value);
    nodes[start.i]!.value = encodeXml(startText.slice(0, start.offset) + replacement + startText.slice(start.offset + (start.i === end.i ? end.offset - start.offset : startText.length - start.offset)));
    for (let i = start.i + 1; i <= end.i; i += 1) {
      const part = decodeXml(nodes[i]!.value);
      nodes[i]!.value = encodeXml(i === end.i ? part.slice(end.offset) : "");
    }
  }
}

function tags(text: string): { sigil: string; name: string; raw: string }[] {
  TAG.lastIndex = 0;
  return [...text.matchAll(TAG)].map((m) => ({ sigil: m[1] ?? "", name: m[2]!, raw: m[0] }));
}

function xmlAttributes(openTag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  let cursor = 1;
  while (cursor < openTag.length && !/[\s/>]/.test(openTag[cursor]!)) cursor += 1;
  while (cursor < openTag.length) {
    while (/\s/.test(openTag[cursor] ?? "")) cursor += 1;
    if (openTag.startsWith("/>", cursor) || openTag[cursor] === ">") break;
    const start = cursor;
    while (cursor < openTag.length && /[A-Za-z0-9_.:-]/.test(openTag[cursor]!)) cursor += 1;
    const name = openTag.slice(start, cursor);
    if (!name) throw new Error("Malformed DOCX relationship attribute");
    while (/\s/.test(openTag[cursor] ?? "")) cursor += 1;
    if (openTag[cursor] !== "=") throw new Error("Malformed DOCX relationship attribute");
    cursor += 1;
    while (/\s/.test(openTag[cursor] ?? "")) cursor += 1;
    const quote = openTag[cursor];
    if (quote !== `"` && quote !== `'`) throw new Error("Malformed DOCX relationship attribute");
    cursor += 1;
    const valueStart = cursor;
    while (cursor < openTag.length && openTag[cursor] !== quote) cursor += 1;
    if (cursor >= openTag.length || openTag.slice(valueStart, cursor).includes("<")) {
      throw new Error("Malformed DOCX relationship attribute");
    }
    if (attributes.has(name)) throw new Error(`Duplicate DOCX relationship attribute: ${name}`);
    attributes.set(name, decodeXmlAttribute(openTag.slice(valueStart, cursor)));
    cursor += 1;
  }
  return attributes;
}

function elementsByLocalName(
  nodes: XmlNode[],
  localName: string,
  found: Extract<XmlNode, { kind: "element" }>[] = [],
): Extract<XmlNode, { kind: "element" }>[] {
  for (const node of nodes) {
    if (node.kind !== "element") continue;
    if (node.name.split(":").at(-1) === localName) found.push(node);
    elementsByLocalName(node.children, localName, found);
  }
  return found;
}

function isAllowedHyperlinkTarget(target: string): boolean {
  if (/[<>"\s\u0000-\u001f\u007f]/.test(target)) return false;
  try {
    const url = new URL(target);
    const protocol = url.protocol.toLowerCase();
    if (protocol === "http:" || protocol === "https:") return url.hostname.length > 0;
    if (protocol === "mailto:" || protocol === "tel:") return url.pathname.length > 0;
    if (protocol === "whatsapp:") return url.hostname.length > 0 || url.pathname.length > 0;
    return false;
  } catch {
    return false;
  }
}

function assertSafeRelationships(xml: string): void {
  const relationshipNodes = elementsByLocalName(parseXml(xml), "Relationship");
  for (const node of relationshipNodes) {
    const attributes = xmlAttributes(node.open);
    const target = attributes.get("Target");
    const targetMode = attributes.get("TargetMode");
    const type = attributes.get("Type");
    if (!target || !type) throw new Error("Malformed DOCX relationship");
    const isExternal = targetMode === "External" || /^[a-z][a-z0-9+.-]*:/i.test(target);
    if (!isExternal) continue;

    // Standard hyperlink relationships are inert package metadata: LibreOffice
    // preserves them as clickable links but does not fetch them while rendering.
    // External images/templates, local files, FTP, and custom schemes remain
    // prohibited even when their URI appears in a relationship part.
    const isSafeClickableHyperlink =
      targetMode === "External" &&
      HYPERLINK_RELATIONSHIP_TYPES.has(type) &&
      isAllowedHyperlinkTarget(target);
    if (!isSafeClickableHyperlink) throw new Error("DOCX external relationships are not allowed");
  }
}

async function openDocx(data: Buffer): Promise<JSZip> {
  if (data.length === 0 || data.length > MAX_ARCHIVE_BYTES) throw new Error("DOCX size is outside the allowed range");
  const zip = await JSZip.loadAsync(data, { checkCRC32: true });
  const files = Object.values(zip.files);
  if (files.length > MAX_ENTRIES) throw new Error("DOCX contains too many archive entries");
  let uncompressed = 0;
  for (const file of files) {
    if (file.dir) continue;
    if (file.name.includes("..") || file.name.startsWith("/") || file.name.includes("\\")) throw new Error("DOCX contains an unsafe archive path");
    const size = Number((file as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0);
    if (size > MAX_XML_BYTES * 8) throw new Error(`DOCX entry is too large: ${file.name}`);
    uncompressed += size;
    if (uncompressed > MAX_EXPANDED_BYTES) throw new Error("DOCX expanded content is too large");
  }
  if (!zip.file("[Content_Types].xml") || !zip.file("word/document.xml")) throw new Error("File is not a valid DOCX document");
  for (const name of Object.keys(zip.files).filter((n) => /\.(?:xml|rels)$/i.test(n) && !zip.files[n]!.dir)) {
    const rels = await zip.file(name)!.async("string");
    if (/<!DOCTYPE|<!ENTITY/i.test(rels)) throw new Error(`DOCX XML contains prohibited DTD/entity: ${name}`);
    if (/\.rels$/i.test(name)) assertSafeRelationships(rels);
  }
  return zip;
}

function documentXmlFiles(zip: JSZip): string[] {
  return Object.keys(zip.files).filter((name) =>
    /^word\/(?:document|header\d+|footer\d+)\.xml$/.test(name) && !zip.files[name]!.dir);
}

export async function parseDocxManifest(data: Buffer): Promise<DocumentManifest> {
  const zip = await openDocx(data);
  const scalar = new Set<string>();
  const collections: Record<string, Set<string>> = {};
  const errors: string[] = [];
  for (const name of documentXmlFiles(zip)) {
    const xml = await zip.file(name)!.async("string");
    if (Buffer.byteLength(xml) > MAX_XML_BYTES) throw new Error(`DOCX XML part is too large: ${name}`);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error(`DOCX XML contains prohibited DTD/entity: ${name}`);
    const tree = parseXml(xml);
    const allText = elements(tree, "w:t").flatMap((t) =>
      t.children.filter((n): n is Extract<XmlNode, { kind: "text" }> => n.kind === "text").map((n) => decodeXml(n.value))
    ).join("");
    const recognized = tags(allText);
    if ((allText.match(/\{\{/g)?.length ?? 0) !== recognized.length) errors.push(`Unsupported or malformed marker in ${name}`);
    const rowMarkerCounts = new Map<string, number>();
    const seenCollections = new Set<string>();
    for (const paragraph of elements(tree, "w:p")) {
      for (const tag of tags(logicalText(paragraph))) {
        if (!tag.sigil) scalar.add(tag.name);
      }
    }
    for (const row of elements(tree, "w:tr")) {
      const rowTags = tags(logicalText(row));
      const starts = rowTags.filter((t) => t.sigil === "#");
      const ends = rowTags.filter((t) => t.sigil === "/");
      if (!starts.length && !ends.length) continue;
      const markerTags = rowTags.filter((t) => t.sigil);
      if (starts.length !== 1 || ends.length !== 1 || markerTags.length !== 2 ||
          starts[0]!.name !== ends[0]!.name || rowTags.indexOf(starts[0]!) >= rowTags.indexOf(ends[0]!)) {
        errors.push(`Invalid table-row collection markers in ${name}`);
        continue;
      }
      const cells = row.children.filter((child): child is Extract<XmlNode, { kind: "element" }> =>
        child.kind === "element" && child.name === "w:tc");
      if (cells.length < 1 || !tags(logicalText(cells[0]!)).some((t) => t.raw === starts[0]!.raw) ||
          !tags(logicalText(cells[cells.length - 1]!)).some((t) => t.raw === ends[0]!.raw)) {
        errors.push(`Collection markers must be in the first and last cells in ${name}`);
        continue;
      }
      rowMarkerCounts.set(starts[0]!.raw, (rowMarkerCounts.get(starts[0]!.raw) ?? 0) + 1);
      rowMarkerCounts.set(ends[0]!.raw, (rowMarkerCounts.get(ends[0]!.raw) ?? 0) + 1);
      const collection = starts[0]!.name;
      if (seenCollections.has(collection)) {
        errors.push(`Duplicate collection row "${collection}" in ${name}`);
        continue;
      }
      seenCollections.add(collection);
      const set = collections[collection] ??= new Set<string>();
      for (const tag of rowTags) {
        if (!tag.sigil && tag.name.startsWith(`${collection}.`)) set.add(tag.name.slice(collection.length + 1));
      }
    }
    const allMarkerCounts = new Map<string, number>();
    for (const marker of recognized.filter((t) => t.sigil)) allMarkerCounts.set(marker.raw, (allMarkerCounts.get(marker.raw) ?? 0) + 1);
    for (const [raw, count] of allMarkerCounts) {
      if ((rowMarkerCounts.get(raw) ?? 0) !== count) errors.push(`Collection marker outside one repeatable row in ${name}: ${raw}`);
    }
  }
  const resultCollections: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(collections)) {
    resultCollections[key] = [...value].sort();
    for (const scalarKey of scalar) if (scalarKey.startsWith(`${key}.`)) scalar.delete(scalarKey);
  }
  return { scalars: [...scalar].sort(), collections: resultCollections, errors };
}

function scalarString(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(scalarString).join(", ");
  if (typeof value === "object") return "";
  return String(value);
}

function renderTree(tree: XmlNode[], values: Record<string, unknown>, collections: Record<string, Record<string, unknown>[]>): void {
  const walk = (nodes: XmlNode[]) => {
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index]!;
      if (node.kind !== "element") continue;
      if (node.name === "w:tr") {
        const markers = tags(logicalText(node));
        const start = markers.find((t) => t.sigil === "#");
        const end = markers.find((t) => t.sigil === "/" && t.name === start?.name);
        if (start && end) {
          const items = collections[start.name] ?? [];
          const source = serialize([node]);
          const replacement: XmlNode[] = [];
          for (const item of items.length ? items : [{}]) {
            const [copy] = parseXml(source);
            if (copy?.kind !== "element") continue;
            for (const p of elements(copy.children, "w:p")) {
               replaceTags(p, (raw, sigil: string | undefined, key: string) => {
                 if (raw === start.raw || raw === end.raw) return "";
                 if (sigil) return raw;
                const prefix = `${start.name}.`;
                return key.startsWith(prefix) ? scalarString(item[key.slice(prefix.length)]) : scalarString(values[key]);
              });
            }
            replacement.push(copy);
          }
          nodes.splice(index, 1, ...replacement);
          index += replacement.length - 1;
          continue;
        }
      }
      if (node.name === "w:p") {
         replaceTags(node, (raw, sigil: string | undefined, key: string) =>
           sigil ? raw : scalarString(values[key]));
      } else walk(node.children);
    }
  };
  walk(tree);
}

export async function renderDocx(
  template: Buffer,
  values: Record<string, unknown>,
  collections: Record<string, Record<string, unknown>[]>,
): Promise<Buffer> {
  const manifest = await parseDocxManifest(template);
  if (manifest.errors.length) throw new Error(`DOCX has invalid markers: ${manifest.errors.join("; ")}`);
  const zip = await openDocx(template);
  for (const name of documentXmlFiles(zip)) {
    const xml = await zip.file(name)!.async("string");
    if (Buffer.byteLength(xml) > MAX_XML_BYTES) throw new Error(`DOCX XML part is too large: ${name}`);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error(`DOCX XML contains prohibited DTD/entity: ${name}`);
    const tree = parseXml(xml);
    renderTree(tree, values, collections);
    zip.file(name, serialize(tree));
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
