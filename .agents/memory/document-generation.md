---
name: Document generation
description: Non-obvious lifecycle, authority, and conversion boundaries for the DOCX/PDF module.
---

Published template revisions are immutable and contain only the DOCX design plus variable/collection mappings. Output format, destination, managed folder, target file field, filename, and overwrite policy belong to each automation action.

**Why:** One published design must be reusable by different automations without duplicating revisions or coupling document content to a storage destination.

**How to apply:** Template publication validates every detected tag and mapping. Any new output option must extend the automation action and manual-generation input, not revision persistence.

Automation rendering is intentionally AS SYSTEM, while interactive test/generate requests must re-apply the caller's complete source and linked-record boundaries. Both paths must use the same authoritative formula, page-local, relation, lookup, status, and system-value materialization.

**Why:** Automations are privileged technical operations, but the admin capability alone must not let an interactive caller extract fields or linked rows they cannot otherwise read.

**How to apply:** Keep authority explicit at the render-data boundary. Never fall back to reading raw record JSON for convenience.

PDF conversion is allowed only through a network-isolated, filesystem-restricted LibreOffice sandbox and must fail closed when the host cannot provide that isolation.

**Why:** DOCX is attacker-controlled input processed by a large native parser; tag validation and archive limits do not replace process isolation.

**How to apply:** Never add a direct LibreOffice fallback. Production hosts must support the configured Bubblewrap isolation; verify conversion there after infrastructure changes.

Test generation is an authenticated direct download and must never persist an output to Local or Drive storage or write the record file field.

**Why:** Stored file serving is intentionally authorized through a readable record-field reference; an unattached test upload is both inaccessible and orphaned.

**How to apply:** Return test bytes in the response, download them from the generated Blob client, and clean conversion temporaries before completing the request.

Collection blocks repeat one complete Word table row: the opening marker is in the first cell and the closing marker is in the last cell. Empty collections preserve one blank formatted row.

**Why:** This constraint makes pagination and formatting deterministic without implementing a browser Word editor or accepting ambiguous nested templates.

**How to apply:** Reject unsupported, nested, unmatched, duplicated, or cross-row collection markers before publication.