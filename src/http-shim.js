export function nodeRequestFrom(request, body) {
  const url = new URL(request.url);
  const headers = Object.fromEntries(request.headers);
  return {
    method: request.method,
    url: `${url.pathname}${url.search}`,
    headers,
    socket: {
      remoteAddress: request.headers.get("cf-connecting-ip") || "0.0.0.0",
      setTimeout() {},
    },
    async *[Symbol.asyncIterator]() {
      if (body?.byteLength) yield body;
    },
  };
}

export function nodeResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    chunks: [],
    ended: false,
    __previewCookies: null,
    writeHead(status, headers = {}) {
      res.statusCode = status;
      res.headers = { ...res.headers, ...headers };
    },
    setHeader(name, value) {
      res.headers[name] = value;
    },
    write(chunk) {
      res.chunks.push(chunk);
    },
    end(chunk) {
      if (chunk != null) res.chunks.push(chunk);
      res.ended = true;
    },
    on() {},
  };
  return res;
}

export function fetchResponseFrom(res) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(res.headers)) {
    if (key.toLowerCase() === "set-cookie") {
      for (const cookie of [].concat(value)) headers.append("set-cookie", cookie);
    } else {
      headers.set(key, String(value));
    }
  }
  const extra = res.__previewCookies || [];
  for (const cookie of extra) headers.append("set-cookie", cookie);
  return new Response(joinBody(res.chunks), {
    status: res.statusCode,
    headers,
  });
}

function joinBody(chunks) {
  if (!chunks.length) return "";
  if (chunks.length === 1 && typeof chunks[0] === "string") return chunks[0];
  if (typeof Buffer !== "undefined") return Buffer.concat(chunks.map(asBuffer));
  return chunks.map(String).join("");
}

function asBuffer(chunk) {
  if (typeof chunk === "string") return Buffer.from(chunk);
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  return Buffer.from(String(chunk));
}
