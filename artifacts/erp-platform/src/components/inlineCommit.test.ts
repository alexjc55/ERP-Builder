import assert from "node:assert/strict";
import test from "node:test";
import { attemptInlineCommit } from "./inlineCommit.ts";

test("a rejected inline commit can retry once and then latches", () => {
  const committedRef = { current: false };
  let calls = 0;
  const onCommit = () => {
    calls += 1;
    return calls === 1 ? false : true;
  };

  assert.equal(attemptInlineCommit(committedRef, onCommit, "draft"), "rejected");
  assert.equal(committedRef.current, false);
  assert.equal(attemptInlineCommit(committedRef, onCommit, "draft"), "accepted");
  assert.equal(committedRef.current, true);
  assert.equal(attemptInlineCommit(committedRef, onCommit, "draft"), "already-committed");
  assert.equal(calls, 2);
});