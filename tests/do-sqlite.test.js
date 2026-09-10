import { test } from "node:test";
import assert from "node:assert/strict";
import { DoSqlite } from "../src/do-sqlite.js";
import { runWithDb, withTx } from "../src/db.js";

function fakeSql() {
  const log = [];
  return {
    log,
    exec(query) {
      const text = String(query).trim();
      log.push(text);
      if (/^(BEGIN|COMMIT|ROLLBACK|END|SAVEPOINT|RELEASE)\b/i.test(text)) {
        throw new Error("transaction SQL not supported");
      }
      return { toArray() { return []; }, rowsWritten: 0 };
    },
  };
}

test("DoSqlite ignores BEGIN so withTx cannot hang on Workers sqlite", () => {
  const sql = fakeSql();
  const db = new DoSqlite(sql);
  const result = runWithDb(db, () => withTx(() => 42));
  assert.equal(result, 42);
  assert.equal(sql.log.some((q) => /^(BEGIN|COMMIT|ROLLBACK)\b/i.test(q)), false);
});

test("withTx uses Durable Object transactionSync when present", () => {
  const sql = fakeSql();
  let wrapped = false;
  const storage = {
    transactionSync(fn) {
      wrapped = true;
      return fn();
    },
  };
  const db = new DoSqlite(sql, storage);
  assert.equal(runWithDb(db, () => withTx(() => 7)), 7);
  assert.equal(wrapped, true);
});
