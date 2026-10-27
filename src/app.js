const url = require('url');
const path = require('path');
const fs = require('fs');
const { MiniRouter } = require('./utils/routerUtils');
const apiRoutes = require('./routes');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

/**
 * Application Engine
 */
class App extends MiniRouter {
  constructor() {
    super();
    this._setupGlobalMiddlewares();
    this._setupRoutes();
  }

  _setupGlobalMiddlewares() {
    // 1. Enhanced Request/Response & CORS Middleware
    this.use(async (req, res, next) => {
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
      res.setHeader('Access-Control-Allow-Credentials', 'true');

      // Response Helpers
      res.statusCode = 200;
      res.status = function (code) {
        this.statusCode = code;
        return this;
      };

      res.json = function (data) {
        if (this.writableEnded) return;
        this.setHeader('Content-Type', 'application/json; charset=utf-8');
        this.end(JSON.stringify(data));
      };

      res.send = function (body) {
        if (this.writableEnded) return;
        if (typeof body === 'object') {
          return this.json(body);
        }
        this.end(body);
      };

      // Handle Pre-flight OPTIONS
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        return res.end();
      }

      // Request URL parsing
      const parsedUrl = url.parse(req.url, true);
      req.query = parsedUrl.query || {};
      req.pathname = parsedUrl.pathname;
      req.originalUrl = req.url;

      // 2. Static File Serving for /uploads
      if (req.method === 'GET' && req.pathname && req.pathname.startsWith('/uploads/')) {
        const relativePath = req.pathname.substring('/uploads/'.length);
        const safePath = path.normalize(relativePath).replace(/^(\.\.[\/\\])+/, '');
        const UPLOADS_BASE = path.resolve(__dirname, '../uploads');
        const filePath = path.resolve(UPLOADS_BASE, safePath);

        if (filePath.startsWith(UPLOADS_BASE) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          const ext = path.extname(filePath).toLowerCase();
          const mimeTypes = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.webp': 'image/webp',
            '.gif': 'image/gif'
          };
          const contentType = mimeTypes[ext] || 'application/octet-stream';
          res.statusCode = 200;
          res.setHeader('Content-Type', contentType);
          res.setHeader('Cache-Control', 'public, max-age=86400');
          return fs.createReadStream(filePath).pipe(res);
        } else {
          res.statusCode = 404;
          return res.json({ success: false, error: 'Uploaded file not found.' });
        }
      }

      // Parse JSON body if present (Bypass multipart/form-data for Multer)
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        const contentType = req.headers['content-type'] || '';
        if (contentType.toLowerCase().includes('multipart/form-data')) {
          req.body = {};
          return next();
        }

        let bodyRaw = '';
        req.on('data', (chunk) => {
          bodyRaw += chunk;
          if (bodyRaw.length > 1e6) {
            // 1MB limit guard
            req.destroy();
          }
        });

        req.on('end', () => {
          if (bodyRaw.trim()) {
            try {
              req.body = JSON.parse(bodyRaw);
            } catch (e) {
              req.body = {};
            }
          } else {
            req.body = {};
          }
          next();
        });

        req.on('error', (err) => {
          next(err);
        });
      } else {
        req.body = {};
        next();
      }
    });
  }


  _setupRoutes() {
    // Root service status endpoint
    this.get('/health', (req, res) => {
      res.status(200).json({
        success: true,
        service: 'voice-chat-friends-backend',
        status: 'online',
        phase: 'Phase 1 MVP',
        timestamp: new Date().toISOString()
      });
    });


    // Mount API v1 routes
    this.use('/api/v1', apiRoutes);

    // 404 Fallback
    this.use((req, res, next) => {
      if (!res.writableEnded) {
        notFoundHandler(req, res);
      }
    });

    // Central Error Handler
    this.use((err, req, res, next) => {
      if (!res.writableEnded) {
        errorHandler(err, req, res, next);
      }
    });
  }

  /**
   * HTTP Request Listener callback compatible with http.createServer(app.callback())
   */
  callback() {
    return (req, res) => {
      this.handle(req, res, '', (err) => {
        if (err && !res.writableEnded) {
          errorHandler(err, req, res);
        } else if (!res.writableEnded) {
          notFoundHandler(req, res);
        }
      });
    };
  }
}

module.exports = new App();
