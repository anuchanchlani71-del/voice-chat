const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure persistent uploads/avatars directory exists
const UPLOADS_DIR = path.join(__dirname, '../../uploads/avatars');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Disk Storage Configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename: function (req, file, cb) {
    const userId = req.user ? (req.user.id || req.user._id.toString()) : 'guest';
    const cleanUserId = String(userId).replace(/[^a-z0-9]/gi, '_');
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    const uniqueSuffix = Date.now() + '_' + Math.round(Math.random() * 1e6);
    cb(null, `avatar_${cleanUserId}_${uniqueSuffix}${ext}`);
  }
});

// File Type Filter
const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedMimeTypes.includes(file.mimetype) && allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid image file type. Only JPEG, PNG, WebP, and GIF are supported.'), false);
  }
};

// Multer Upload Instance (2 MB Max Size, Single File)
const uploadAvatarMulter = multer({
  storage: storage,
  limits: {
    fileSize: 2 * 1024 * 1024 // 2 MB Limit
  },
  fileFilter: fileFilter
}).single('avatar');

/**
 * Validate image content magic bytes after upload
 */
function validateImageMagicBytes(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const buffer = Buffer.alloc(12);
  const fd = fs.openSync(filePath, 'r');
  fs.readSync(fd, buffer, 0, 12, 0);
  fs.closeSync(fd);

  // Magic Byte Check:
  // JPEG: FF D8 FF
  // PNG: 89 50 4E 47
  // GIF: 47 49 46 38
  // WebP: 52 49 46 46 ... 57 45 42 50
  const isJpeg = buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
  const isGif = buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38;
  const isWebp = buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
                 buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;

  return isJpeg || isPng || isGif || isWebp;
}

/**
 * Middleware wrapper for handling Multer errors and magic byte validation cleanly
 */
function handleAvatarUpload(req, res, next) {
  uploadAvatarMulter(req, res, function (err) {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          error: 'File size exceeds 2 MB limit. Please select a smaller photo.'
        });
      }
      return res.status(400).json({
        success: false,
        error: `Upload error: ${err.message}`
      });
    } else if (err) {
      return res.status(400).json({
        success: false,
        error: err.message || 'Failed to upload photo.'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No profile photo file provided in request.'
      });
    }

    // Validate magic bytes
    if (!validateImageMagicBytes(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (unlinkErr) {}
      return res.status(400).json({
        success: false,
        error: 'Uploaded file content is not a valid image format.'
      });
    }

    next();
  });
}

module.exports = {
  handleAvatarUpload,
  UPLOADS_DIR
};
