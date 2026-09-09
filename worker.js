import { DurableObject } from "cloudflare:workers";

const PORT = 8080;

export class PreviewApp extends DurableObject {
  async fetch(request) {
    const container = this.ctx.container;
    if (!container) {
      return new Response("Preview container is unavailable", { status: 503 });
    }
    if (!container.running) {
      container.start({
        enableInternet: false,
        env: {
          NODE_ENV: "production",
          HOST: "0.0.0.0",
          PORT: String(PORT),
        },
      });
    }
    return this.forward(container.getTcpPort(PORT), request, 0);
  }

  async forward(port, request, attempt) {
    const url = new URL(request.url);
    url.protocol = "http:";
    url.host = `127.0.0.1:${PORT}`;
    try {
      return await port.fetch(url, request);
    } catch (error) {
      if (attempt >= 40) {
        return new Response("Preview is starting, try again in a moment", { status: 503 });
      }
      await scheduler.wait(250);
      return this.forward(port, request, attempt + 1);
    }
  }
}

export default {
  async fetch(request, env) {
    return env.PREVIEW_APP.getByName("preview").fetch(request);
  },
};
