/**
 * Async route errors reach an error handler instead of killing the server.
 *
 * Express 4 does not await route handlers: a rejected promise from an `async (req, res) => …`
 * becomes an unhandled rejection, and in the desktop app that took the embedded server (and with
 * it every open document) down. `catchAsyncErrors` makes each route registered on an app or router
 * pass its rejection to `next(err)`; `jsonErrorHandler` answers it with a 500 and logs it.
 */

import type { ErrorRequestHandler, Router } from 'express';

/** Route methods only: `use` mounts whole routers and static serving, which are patched where made. */
const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'all'] as const;

/** A handler whose returned promise, if any, forwards its rejection to `next`. */
export function forwardRejections(fn: unknown): unknown {
  // Error handlers (4 arguments) and anything that is not a function are left alone.
  if (typeof fn !== 'function' || fn.length >= 4) return fn;
  const handler = fn as (...args: unknown[]) => unknown;
  return function (this: unknown, req: unknown, res: unknown, next: (err?: unknown) => void) {
    try {
      const out = handler.call(this, req, res, next);
      if (out && typeof (out as Promise<unknown>).then === 'function') (out as Promise<unknown>).catch(next);
      return out;
    } catch (err) {
      next(err);
    }
  };
}

/** Patches `target`'s route methods so every handler registered from now on is wrapped. */
export function catchAsyncErrors<T extends Pick<Router, (typeof METHODS)[number]>>(target: T): T {
  for (const method of METHODS) {
    const original = (target[method] as (...args: unknown[]) => unknown).bind(target);
    // `app.get('name')` with one argument reads a setting: passed through untouched.
    (target as unknown as Record<string, unknown>)[method] = (...args: unknown[]) =>
      args.length < 2 ? original(...args) : original(...args.map((a) => (Array.isArray(a) ? a.map(forwardRejections) : forwardRejections(a))));
  }
  return target;
}

/** The last middleware: a JSON 500 for anything a route threw, logged with its path. */
export const jsonErrorHandler: ErrorRequestHandler = (err, req, res, next) => {
  console.error(`[Marginalia] ${req.method} ${req.path} failed:`, err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Something went wrong on this device. Please try again.' });
};
