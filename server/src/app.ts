// Express app: the HTTP routes of the API contract, error handling, and the built React client.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import * as kb from './service.ts';
import { KbError } from './service.ts';
import type { ErrorCode } from './service.ts';
import { reset } from './seed.ts';
import type { FieldInput, RuleInput } from './types.ts';

const HTTP_STATUS: Record<ErrorCode, number> = { FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, INVALID: 422 };

// The built React app. Resolved from this file (server/src/app.ts), not from the folder the server was started in.
const CLIENT_DIST = fileURLToPath(new URL('../../client/dist/', import.meta.url));

type Handler = (req: Request) => unknown;

// Sends what the handler returns as JSON. Express 5 passes errors from async handlers to the error handler.
const json = (handler: Handler) => async (req: Request, res: Response) => {
  res.json(await handler(req));
};

// Login is out of scope: the user comes from the X-User-Id header.
const userOf = (req: Request) => req.get('x-user-id') ?? '';
const bodyOf = (req: Request): Record<string, unknown> => (req.body && typeof req.body === 'object' ? req.body : {});
const param = (req: Request, name: string) => String(req.params[name]);

function apiRoutes() {
  const api = express.Router();

  // Read API for the agent app: published versions only
  api.get('/schemes', json(() => kb.listPublished()));
  api.get('/schemes/:ref', json((req) => kb.getPublished(param(req, 'ref'))));

  // Reviewer views
  api.get('/users', json(() => kb.listUsers()));
  api.get('/meta', json(() => kb.meta()));
  api.get('/staff/schemes', json(() => kb.staffSchemes()));
  api.get('/schemes/:ref/versions', json((req) => kb.listVersions(param(req, 'ref'))));
  api.get('/schemes/:ref/versions/:no', json((req) => kb.getVersion(param(req, 'ref'), param(req, 'no'))));
  api.get('/schemes/:ref/history', json((req) => kb.history(param(req, 'ref'))));
  api.get('/schemes/:ref/diff', json((req) => kb.diff(param(req, 'ref'))));
  api.get('/schemes/:ref/flags', json((req) => kb.flagsFor(param(req, 'ref'))));
  api.get('/review-queue', json(() => kb.reviewQueue()));
  api.get('/rules', json(() => kb.listRules()));

  // State reviewers
  api.post('/schemes', json((req) => kb.createScheme(userOf(req), bodyOf(req).scheme_ref)));
  api.post('/schemes/:ref/draft', json((req) => kb.startDraft(userOf(req), param(req, 'ref'))));
  api.put('/schemes/:ref/draft/fields', json((req) => kb.setField(userOf(req), param(req, 'ref'), bodyOf(req) as FieldInput)));
  api.put('/schemes/:ref/draft/rules/:code', json((req) => kb.useRule(userOf(req), param(req, 'ref'), param(req, 'code'))));
  api.delete('/schemes/:ref/draft/rules/:code', json((req) => kb.removeRule(userOf(req), param(req, 'ref'), param(req, 'code'))));
  api.post('/schemes/:ref/draft/submit', json((req) => kb.submit(userOf(req), param(req, 'ref'))));
  api.delete('/schemes/:ref/draft', json((req) => kb.discardDraft(userOf(req), param(req, 'ref'))));

  // Central reviewers
  api.post('/schemes/:ref/draft/send-back', json((req) => kb.sendBack(userOf(req), param(req, 'ref'), bodyOf(req).comment)));
  api.post('/schemes/:ref/draft/publish', json((req) => kb.publish(userOf(req), param(req, 'ref'), bodyOf(req).revision)));
  api.post('/rules', json((req) => kb.createRule(userOf(req), bodyOf(req).code, bodyOf(req) as RuleInput)));
  api.post('/rules/:code/versions', json((req) => kb.changeRule(userOf(req), param(req, 'code'), bodyOf(req) as RuleInput)));
  api.post('/flags/:id/dismiss', json((req) => kb.dismissFlag(userOf(req), param(req, 'id'), bodyOf(req).note)));

  // Dev helper: wipe and reload the synthetic data (refused when NODE_ENV=production)
  api.post('/reset', json(() => reset()));

  // Any other /api path
  api.use((_req, res) => {
    res.status(404).json({ error: 'NOT_FOUND', message: 'No such route' });
  });
  return api;
}

// Errors from express.json() (invalid JSON, body too large, ...) carry a "type" and a 4xx status.
type BodyError = { type: string; status: number; message: string };
const isBodyError = (err: unknown): err is BodyError => {
  const e = err as Partial<BodyError> | null;
  return typeof e?.type === 'string' && typeof e.status === 'number' && e.status < 500;
};

function handleError(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof KbError) {
    res.status(HTTP_STATUS[err.code]).json({ error: err.code, message: err.message });
  } else if (isBodyError(err)) {
    const message = err.type === 'entity.parse.failed' ? 'Body must be valid JSON' : `Bad request body: ${err.message}`;
    res.status(400).json({ error: 'BAD_JSON', message });
  } else {
    console.error(err);
    res.status(500).json({ error: 'INTERNAL', message: 'Something went wrong on the server. Please try again.' });
  }
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('json spaces', 2); // readable with curl
  app.use(express.json());
  app.use('/api', apiRoutes());

  // Serve the built React client if it exists (npm start builds it first).
  if (existsSync(join(CLIENT_DIST, 'index.html'))) {
    app.use(express.static(CLIENT_DIST));
    // Any other GET is a page of the single-page app: send index.html and let React show the right screen.
    app.get('/{*page}', (_req, res) => res.sendFile('index.html', { root: CLIENT_DIST }));
  }

  app.use(handleError);
  return app;
}
