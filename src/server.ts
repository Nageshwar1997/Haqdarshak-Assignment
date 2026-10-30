// Small HTTP API over the knowledge base, using Node's built-in http module (no framework).
// Start: npm start   (loads the synthetic data from seed.ts)
import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import { KbError } from './store.ts';
import type { ErrorCode, FieldInput, RuleInput } from './store.ts';
import { seed } from './seed.ts';

const kb = seed();
const PORT = Number(process.env.PORT ?? 3000);

type Body = Record<string, any>;
type Handler = (params: string[], body: Body, userId: string) => unknown;

// [method, path, handler]. Write routes read the user from an X-User-Id header (stand-in for login).
const routes: [string, RegExp, Handler][] = [
  // Read API for the agent app, chatbot and partners: published versions only
  ['GET', /^\/schemes$/, () => kb.listPublished()],
  ['GET', /^\/schemes\/([^/]+)$/, ([ref]) => kb.getPublished(ref)],

  // Reviewer views
  ['GET', /^\/schemes\/([^/]+)\/versions\/(\d+)$/, ([ref, no]) => kb.getVersion(ref, Number(no))],
  ['GET', /^\/schemes\/([^/]+)\/history$/, ([ref]) => kb.history(ref)],
  ['GET', /^\/schemes\/([^/]+)\/diff$/, ([ref]) => kb.diff(ref)],
  ['GET', /^\/review-queue$/, () => kb.reviewQueue()],

  // State reviewers
  ['POST', /^\/schemes$/, (_, b, u) => kb.createScheme(u, b.scheme_ref)],
  ['POST', /^\/schemes\/([^/]+)\/draft$/, ([ref], _, u) => kb.startDraft(u, ref)],
  ['PUT', /^\/schemes\/([^/]+)\/draft\/fields$/, ([ref], b, u) => kb.setField(u, ref, b as FieldInput)],
  ['PUT', /^\/schemes\/([^/]+)\/draft\/rules\/([^/]+)$/, ([ref, code], _, u) => kb.useRule(u, ref, code)],
  ['POST', /^\/schemes\/([^/]+)\/draft\/submit$/, ([ref], _, u) => kb.submit(u, ref)],
  ['DELETE', /^\/schemes\/([^/]+)\/draft$/, ([ref], _, u) => kb.discardDraft(u, ref)],

  // Central reviewers
  ['POST', /^\/schemes\/([^/]+)\/draft\/send-back$/, ([ref], b, u) => kb.sendBack(u, ref, b.comment)],
  ['POST', /^\/schemes\/([^/]+)\/draft\/publish$/, ([ref], b, u) => kb.publish(u, ref, b.revision)],
  ['POST', /^\/rules\/([^/]+)\/versions$/, ([code], b, u) => kb.changeRule(u, code, b as RuleInput)],
  ['POST', /^\/flags\/(\d+)\/dismiss$/, ([id], b, u) => kb.dismissFlag(u, Number(id), b.note)],
];

const HTTP_STATUS: Record<ErrorCode, number> = { FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, INVALID: 422 };

function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data, null, 2));
}

createServer(async (req, res) => {
  try {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body: Body = raw ? JSON.parse(raw) : {};
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const userId = String(req.headers['x-user-id'] ?? '');
    for (const [method, pattern, handler] of routes) {
      const match = req.method === method ? path.match(pattern) : null;
      if (match) return send(res, 200, handler(match.slice(1).map(decodeURIComponent), body, userId));
    }
    send(res, 404, { error: 'NOT_FOUND', message: 'No such route' });
  } catch (err) {
    if (err instanceof KbError) send(res, HTTP_STATUS[err.code], { error: err.code, message: err.message });
    else if (err instanceof SyntaxError) send(res, 400, { error: 'BAD_JSON', message: 'Body must be valid JSON' });
    else {
      console.error(err);
      send(res, 500, { error: 'INTERNAL' });
    }
  }
}).listen(PORT, () => console.log(`Scheme Knowledge Base API on http://localhost:${PORT}`));
