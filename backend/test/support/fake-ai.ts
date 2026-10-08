/**
 * TEST DOUBLE — a fake Python ai-service for the `api` suite. It records every request and
 * answers with programmable responses. It is NOT the real WBS-2/WBS-3 service; the
 * `integration` suite runs against the real one.
 */
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: any;
}

export type Reply = { status: number; body?: unknown; delayMs?: number } | 'hang' | 'drop';
export type Handler = (req: RecordedRequest) => Reply;

export class FakeAiService {
  readonly requests: RecordedRequest[] = [];
  private readonly routes: [string, string, Handler][] = [];
  private server!: http.Server;
  url = '';
  readyIndex: { collection: string; embedding_fingerprint: string; index_version_id: string | null } | null = null;

  on(method: string, pathPrefix: string, handler: Handler): this {
    this.routes.unshift([method, pathPrefix, handler]); // latest registration wins
    return this;
  }

  reset(): void {
    this.requests.length = 0;
    this.routes.length = 0;
    this.readyIndex = null;
  }

  calls(method: string, pathPrefix: string): RecordedRequest[] {
    return this.requests.filter((r) => r.method === method && r.path.startsWith(pathPrefix));
  }

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const rec: RecordedRequest = { method: req.method!, path: req.url!, headers: req.headers, body: raw ? JSON.parse(raw) : null };
        this.requests.push(rec);
        const route = this.routes.find(([m, p]) => m === rec.method && rec.path.startsWith(p));
        let out: Reply;
        if (route) out = route[2](rec);
        else if (rec.method === 'GET' && rec.path === '/ready') out = { status: 200, body: { status: 'ready', checks: {}, index: this.readyIndex } };
        else out = { status: 404, body: { error: { code: 'NOT_FOUND' } } };
        if (out === 'hang') return; // never answers (client timeout)
        if (out === 'drop') { req.socket.destroy(); return; }
        const reply = out;
        const send = () => {
          res.writeHead(reply.status, { 'Content-Type': 'application/json' });
          res.end(reply.body === undefined ? '' : JSON.stringify(reply.body));
        };
        if (reply.delayMs) setTimeout(send, reply.delayMs); else send();
      });
    });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((r) => this.server.close(() => r()));
  }
}
