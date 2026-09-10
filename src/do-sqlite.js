const TX_CONTROL = /^(BEGIN|COMMIT|ROLLBACK|END|SAVEPOINT|RELEASE)\b/i;

export class DoSqlite {
  constructor(sql, storage = null) {
    this.sql = sql;
    this.storage = storage;
    this.noExplicitTx = true;
  }

  exec(text) {
    for (const statement of splitSql(text)) {
      if (TX_CONTROL.test(statement)) continue;
      this.sql.exec(statement);
    }
    return this;
  }

  prepare(query) {
    const sql = this.sql;
    return {
      run(...params) {
        const cursor = sql.exec(query, ...bind(params));
        drain(cursor);
        return { changes: cursor.rowsWritten ?? 0, lastInsertRowid: 0 };
      },
      get(...params) {
        const rows = sql.exec(query, ...bind(params)).toArray();
        return rows[0];
      },
      all(...params) {
        return sql.exec(query, ...bind(params)).toArray();
      },
    };
  }

  close() {}
}

function bind(params) {
  return params.map((value) => (value === undefined ? null : value));
}

function drain(cursor) {
  try {
    cursor.toArray();
  } catch {
    /* some statements have no result rows */
  }
}

function splitSql(text) {
  const out = [];
  let current = "";
  let quote = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ";") {
      const piece = current.trim();
      if (piece) out.push(piece);
      current = "";
      continue;
    }
    current += ch;
  }
  const tail = current.trim();
  if (tail) out.push(tail);
  return out;
}
