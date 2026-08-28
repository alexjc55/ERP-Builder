import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseRevisionMultipart } from "../routes/document-generation";
import { presentGenerationOutput } from "../routes/document-generation";

test("generated revision upload constructs multipart FormData", async () => {
  const generated = await readFile(new URL("../../../../lib/api-client-react/src/generated/api.ts", import.meta.url), "utf8");
  const start = generated.indexOf("createDocumentTemplateRevision");
  const section = generated.slice(start, start + 1200);
  assert.match(section, /new FormData\(\)/);
  assert.match(section, /formData\.append\(`file`/);
  assert.match(section, /body:\s*formData/);
  assert.doesNotMatch(section, /JSON\.stringify\(documentTemplateRevisionUpload\)/);
});

test("generated client exposes paginated generation-history query hook", async () => {
  const generated = await readFile(new URL("../../../../lib/api-client-react/src/generated/api.ts", import.meta.url), "utf8");
  assert.match(generated, /export function useListDocumentGenerationRuns/);
  assert.match(generated, /listDocumentGenerationRuns = async \(params\?: ListDocumentGenerationRunsParams/);
});

test("generated test-document client receives a binary download", async () => {
  const generated = await readFile(new URL("../../../../lib/api-client-react/src/generated/api.ts", import.meta.url), "utf8");
  const start = generated.indexOf("testDocumentTemplateRevision = async");
  const section = generated.slice(start, start + 800);
  assert.match(section, /Promise<Blob>/);
  assert.match(section, /method: 'POST'/);
});

test("test generation returns rendered bytes before either configured storage destination", async () => {
  const source = await readFile(new URL("./document-generation.ts", import.meta.url), "utf8");
  const testStart = source.indexOf("if (input.testOnly)");
  const storageStart = source.indexOf('if (output.destination === "gdrive")', testStart);
  const testSection = source.slice(testStart, storageStart);
  assert.ok(testStart >= 0 && storageStart > testStart);
  assert.match(testSection, /return \{ bytes, contentType, name:/);
  assert.doesNotMatch(testSection, /saveLocalFile|uploadToFolder|systemUpdateRecord/);
});

test("revision endpoint parser accepts bounded multipart DOCX payload", () => {
  const boundary = "----document-test";
  const body = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="mapping"\r\n\r\n{"scalars":{},"collections":{}}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="template.docx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\nPK\u0003\u0004\r\n--${boundary}--\r\n`,
  );
  const parsed = parseRevisionMultipart({
    body,
    header: (name: string) => name.toLowerCase() === "content-type" ? `multipart/form-data; boundary=${boundary}` : undefined,
  } as never);
  assert.equal(parsed?.name, "template.docx");
  assert.equal(parsed?.mapping, '{"scalars":{},"collections":{}}');
  assert.deepEqual(parsed?.file, Buffer.from("PK\u0003\u0004"));
});

test("generation history output is safely projected", () => {
  assert.deepEqual(
    presentGenerationOutput({ file: { kind: "gdrive", fileId: "id", name: "x", refreshToken: "secret" }, orphaned: true, cleanup: { attempted: true, deleted: false, token: "no" } }),
    { destination: "gdrive", fileId: "id", name: "x", orphaned: true, cleanup: { attempted: true, deleted: false } },
  );
});
