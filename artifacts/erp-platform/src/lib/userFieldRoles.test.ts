import { test } from "node:test";
import assert from "node:assert/strict";
import { filterUserOptionsByRoles } from "./userFieldRoles.ts";
import type { Field, UserOption } from "@workspace/api-client-react";

test("technical identities cannot become new field choices; saved labels and secondary roles survive", () => {
  const options = [
    { id: 1, name: "Human", roleId: 2, roleIds: [2, 3], isServiceAccount: false },
    { id: 2, name: "AI", roleId: 3, roleIds: [3], isServiceAccount: true },
    { id: 3, name: "Integration", roleId: 3, roleIds: [3], isServiceAccount: true },
  ] as UserOption[];
  const unrestricted = { userConfigJson: {} } as Field;
  const restricted = { userConfigJson: { allowedRoleIds: [3] } } as Field;
  assert.deepEqual(filterUserOptionsByRoles(unrestricted, options).map(u => u.id), [1]);
  assert.deepEqual(filterUserOptionsByRoles(restricted, options).map(u => u.id), [1]);
  assert.deepEqual(filterUserOptionsByRoles(restricted, options, 2).map(u => u.id), [1, 2]);
  assert.deepEqual(filterUserOptionsByRoles(restricted, options, 2).filter(u => !u.isServiceAccount).map(u => u.id), [1]);
});
