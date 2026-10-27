const url = require('url');

/**
 * Route pattern matching supporting named parameters (:id, :param)
 */
function matchRoutePath(pattern, pathname) {
  if (pattern === pathname) {
    return { matches: true, params: {} };
  }

  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);

  if (patternParts.length !== pathParts.length) {
    return { matches: false, params: {} };
  }

  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    const pPart = patternParts[i];
    const aPart = pathParts[i];

    if (pPart.startsWith(':')) {
      const paramName = pPart.slice(1);
      params[paramName] = decodeURIComponent(aPart);
    } else if (pPart !== aPart) {
      return { matches: false, params: {} };
    }
  }

  return { matches: true, params };
}

/**
 * Clean Express-compatible Router & Middleware Dispatcher.
 * Operates natively on standard Node.js HTTP req/res with zero external dependencies.
 */
class MiniRouter {
  constructor() {
    this.stack = [];
  }

  use(pathOrMiddleware, ...handlers) {
    if (typeof pathOrMiddleware === 'string') {
      const prefix = pathOrMiddleware.endsWith('/') && pathOrMiddleware.length > 1
        ? pathOrMiddleware.slice(0, -1)
        : pathOrMiddleware;

      for (const handler of handlers) {
        if (handler instanceof MiniRouter) {
          this.stack.push({
            type: 'router',
            prefix,
            router: handler
          });
        } else {
          this.stack.push({
            type: 'middleware',
            prefix,
            fn: handler
          });
        }
      }
    } else {
      const allHandlers = [pathOrMiddleware, ...handlers];
      for (const fn of allHandlers) {
        if (fn instanceof MiniRouter) {
          this.stack.push({
            type: 'router',
            prefix: '',
            router: fn
          });
        } else {
          this.stack.push({
            type: 'middleware',
            prefix: '',
            fn
          });
        }
      }
    }
    return this;
  }

  _addRoute(method, path, ...handlers) {
    const cleanPath = path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path;
    this.stack.push({
      type: 'route',
      method: method.toUpperCase(),
      path: cleanPath,
      handlers
    });
  }

  get(path, ...handlers) {
    this._addRoute('GET', path, ...handlers);
    return this;
  }

  post(path, ...handlers) {
    this._addRoute('POST', path, ...handlers);
    return this;
  }

  put(path, ...handlers) {
    this._addRoute('PUT', path, ...handlers);
    return this;
  }

  patch(path, ...handlers) {
    this._addRoute('PATCH', path, ...handlers);
    return this;
  }

  delete(path, ...handlers) {
    this._addRoute('DELETE', path, ...handlers);
    return this;
  }

  options(path, ...handlers) {
    this._addRoute('OPTIONS', path, ...handlers);
    return this;
  }

  async handle(req, res, basePath = '', parentNext = null) {
    if (!req.params) req.params = {};

    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname.endsWith('/') && parsedUrl.pathname.length > 1
      ? parsedUrl.pathname.slice(0, -1)
      : parsedUrl.pathname;

    let index = 0;

    const next = async (err) => {
      if (err) {
        if (parentNext) return parentNext(err);
        return res.status(500).json({ success: false, error: err.message });
      }

      if (index >= this.stack.length) {
        if (parentNext) return parentNext();
        return;
      }

      const layer = this.stack[index++];

      if (layer.type === 'middleware') {
        const fullPrefix = (basePath + layer.prefix) || '';
        if (!fullPrefix || pathname === fullPrefix || pathname.startsWith(fullPrefix + '/')) {
          try {
            await layer.fn(req, res, next);
          } catch (e) {
            next(e);
          }
        } else {
          next();
        }
      } else if (layer.type === 'router') {
        const fullPrefix = (basePath + layer.prefix) || '';
        if (!fullPrefix || pathname === fullPrefix || pathname.startsWith(fullPrefix + '/')) {
          await layer.router.handle(req, res, fullPrefix, next);
        } else {
          next();
        }
      } else if (layer.type === 'route') {
        const fullPath = (basePath + layer.path) || '/';
        const methodMatch = layer.method === req.method || (layer.method === 'GET' && req.method === 'HEAD');
        const matchResult = matchRoutePath(fullPath, pathname);

        if (methodMatch && matchResult.matches) {
          req.params = { ...req.params, ...matchResult.params };
          let handlerIndex = 0;
          const runHandlers = async (handlerErr) => {
            if (handlerErr) return next(handlerErr);
            if (handlerIndex >= layer.handlers.length) return next();
            const currentHandler = layer.handlers[handlerIndex++];
            try {
              await currentHandler(req, res, runHandlers);
            } catch (e) {
              runHandlers(e);
            }
          };
          runHandlers();
        } else {
          next();
        }
      }
    };

    await next();
  }
}

function Router() {
  return new MiniRouter();
}

module.exports = {
  Router,
  MiniRouter,
  matchRoutePath
};
