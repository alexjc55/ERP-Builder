import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { parseDocxManifest, renderDocx } from "./document-docx";

const TYPES = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>`;

async function docx(xml: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", TYPES);
  zip.file("word/document.xml", xml);
  return zip.generateAsync({ type: "nodebuffer" });
}

async function documentXml(buffer: Buffer): Promise<string> {
  return (await JSZip.loadAsync(buffer)).file("word/document.xml")!.async("string");
}

test("manifest reconstructs split-run scalar and collection tags", async () => {
  const input = await docx(`<w:document xmlns:w="w"><w:body>
    <w:p><w:r><w:t>{{cus</w:t></w:r><w:r><w:t>tomer}}</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>{{#items}}{{items.na</w:t></w:r><w:r><w:t>me}}{{/items}}</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
  </w:body></w:document>`);
  assert.deepEqual(await parseDocxManifest(input), {
    scalars: ["customer"],
    collections: { items: ["name"] },
    errors: [],
  });
});

test("renderer repeats a formatted row deterministically", async () => {
  const input = await docx(`<w:document xmlns:w="w"><w:body><w:tbl>
    <w:tr><w:tc w:style="kept"><w:p><w:r><w:t>{{#items}}{{items.name}}{{/items}}</w:t></w:r></w:p></w:tc></w:tr>
  </w:tbl><w:p><w:r><w:t>Hello {{customer}}</w:t></w:r></w:p></w:body></w:document>`);
  const xml = await documentXml(await renderDocx(input, { customer: "ACME & Co" }, {
    items: [{ name: "A" }, { name: "B" }],
  }));
  assert.equal((xml.match(/<w:tr>/g) ?? []).length, 2);
  assert.match(xml, /w:style="kept"/);
  assert.match(xml, />A</);
  assert.match(xml, />B</);
  assert.match(xml, /ACME &amp; Co/);
  assert.doesNotMatch(xml, /\{\{/);
});

test("empty collection retains one blank formatted row", async () => {
  const input = await docx(`<w:document xmlns:w="w"><w:body><w:tbl>
    <w:tr><w:tc><w:p><w:r><w:t>{{#items}}{{items.name}}{{/items}}</w:t></w:r></w:p></w:tc></w:tr>
  </w:tbl></w:body></w:document>`);
  const xml = await documentXml(await renderDocx(input, {}, { items: [] }));
  assert.equal((xml.match(/<w:tr>/g) ?? []).length, 1);
  assert.doesNotMatch(xml, /\{\{/);
});

test("rejects DTD and external package relationships", async () => {
  const dtd = await docx(`<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><w:document xmlns:w="w"><w:body/></w:document>`);
  await assert.rejects(() => parseDocxManifest(dtd), /DTD/);
  const zip = new JSZip();
  zip.file("[Content_Types].xml", TYPES);
  zip.file("word/document.xml", `<w:document xmlns:w="w"><w:body/></w:document>`);
  zip.file("word/_rels/document.xml.rels", `<Relationships><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" TargetMode="External" Target="https://evil.invalid/x"/></Relationships>`);
  const external = await zip.generateAsync({ type: "nodebuffer" });
  await assert.rejects(() => parseDocxManifest(external), /external relationships/);
});

test("allows mailto hyperlinks but rejects mailto external resources", async () => {
  const safe = new JSZip();
  safe.file("[Content_Types].xml", TYPES);
  safe.file("word/document.xml", `<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>{{customer.email}}</w:t></w:r></w:p></w:body></w:document>`);
  safe.file("word/_rels/document.xml.rels", `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="mailto:sales@example.com" TargetMode="External"/></Relationships>`);
  assert.deepEqual(
    (await parseDocxManifest(await safe.generateAsync({ type: "nodebuffer" }))).scalars,
    ["customer.email"],
  );

  const unsafe = new JSZip();
  unsafe.file("[Content_Types].xml", TYPES);
  unsafe.file("word/document.xml", `<w:document xmlns:w="w"><w:body/></w:document>`);
  unsafe.file("word/_rels/document.xml.rels", `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="mailto:sales@example.com" TargetMode="External"/></Relationships>`);
  await assert.rejects(
    async () => parseDocxManifest(await unsafe.generateAsync({ type: "nodebuffer" })),
    /external relationships/,
  );

  const fakeType = new JSZip();
  fakeType.file("[Content_Types].xml", TYPES);
  fakeType.file("word/document.xml", `<w:document xmlns:w="w"><w:body/></w:document>`);
  fakeType.file("word/_rels/document.xml.rels", `<Relationships><Relationship Id="rId1" Type="https://evil.invalid/relationships/hyperlink" Target="mailto:sales@example.com" TargetMode="External"/></Relationships>`);
  await assert.rejects(
    async () => parseDocxManifest(await fakeType.generateAsync({ type: "nodebuffer" })),
    /external relationships/,
  );
});

test("rejects namespaced and duplicate relationship attribute spoofing", async () => {
  const prefixed = new JSZip();
  prefixed.file("[Content_Types].xml", TYPES);
  prefixed.file("word/document.xml", `<w:document xmlns:w="w"><w:body/></w:document>`);
  prefixed.file("word/_rels/document.xml.rels", `<r:Relationships xmlns:r="http://schemas.openxmlformats.org/package/2006/relationships" xmlns:a="urn:spoof"><r:Relationship Id="rId1" a:Target="mailto:safe@example.com" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://evil.invalid/x" TargetMode="External"/></r:Relationships>`);
  await assert.rejects(
    async () => parseDocxManifest(await prefixed.generateAsync({ type: "nodebuffer" })),
    /external relationships/,
  );

  const duplicate = new JSZip();
  duplicate.file("[Content_Types].xml", TYPES);
  duplicate.file("word/document.xml", `<w:document xmlns:w="w"><w:body/></w:document>`);
  duplicate.file("word/_rels/document.xml.rels", `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="mailto:safe@example.com" Target="https://evil.invalid/x" TargetMode="External"/></Relationships>`);
  await assert.rejects(
    async () => parseDocxManifest(await duplicate.generateAsync({ type: "nodebuffer" })),
    /Duplicate DOCX relationship attribute/,
  );

  const unknownEntity = new JSZip();
  unknownEntity.file("[Content_Types].xml", TYPES);
  unknownEntity.file("word/document.xml", `<w:document xmlns:w="w"><w:body/></w:document>`);
  unknownEntity.file("word/_rels/document.xml.rels", `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="mailto:sales@example.com&bogus;" TargetMode="External"/></Relationships>`);
  await assert.rejects(
    async () => parseDocxManifest(await unknownEntity.generateAsync({ type: "nodebuffer" })),
    /Malformed XML entity/,
  );
});

test("rejects oversized aggregate expanded content before extraction", async () => {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", TYPES);
  zip.file("word/document.xml", `<w:document xmlns:w="w"><w:body/></w:document>`);
  const chunk = "x".repeat(8 * 1024 * 1024);
  for (let i = 0; i < 9; i += 1) zip.file(`word/media/pad-${i}.bin`, chunk);
  const bomb = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await assert.rejects(() => parseDocxManifest(bomb), /expanded content/);
});

test("reports markers outside rows and wrong collection cells", async () => {
  const outside = await docx(`<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>{{#items}}</w:t></w:r></w:p></w:body></w:document>`);
  assert.ok((await parseDocxManifest(outside)).errors.some((e) => e.includes("outside")));
  const wrongCells = await docx(`<w:document xmlns:w="w"><w:body><w:tbl><w:tr>
    <w:tc><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc>
    <w:tc><w:p><w:r><w:t>{{#items}}{{items.name}}{{/items}}</w:t></w:r></w:p></w:tc>
  </w:tr></w:tbl></w:body></w:document>`);
  assert.ok((await parseDocxManifest(wrongCells)).errors.some((e) => e.includes("first and last")));
  const duplicate = await docx(`<w:document xmlns:w="w"><w:body><w:tbl>
    <w:tr><w:tc><w:p><w:r><w:t>{{#items}}{{items.name}}{{/items}}</w:t></w:r></w:p></w:tc></w:tr>
    <w:tr><w:tc><w:p><w:r><w:t>{{#items}}{{items.name}}{{/items}}</w:t></w:r></w:p></w:tc></w:tr>
  </w:tbl></w:body></w:document>`);
  assert.ok((await parseDocxManifest(duplicate)).errors.some((e) => e.includes("Duplicate")));
});

test("split-run replacement preserves surrounding run text", async () => {
  const input = await docx(`<w:document xmlns:w="w"><w:body><w:p>
    <w:r w:style="a"><w:t>Before {{cus</w:t></w:r><w:r w:style="b"><w:t>tomer}} after</w:t></w:r>
  </w:p></w:body></w:document>`);
  const xml = await documentXml(await renderDocx(input, { customer: "ACME" }, {}));
  assert.match(xml, /w:style="a"><w:t>Before ACME/);
  assert.match(xml, /w:style="b"><w:t> after/);
});
