'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _slicedToArray = function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; }();

var _awsSdk = require('aws-sdk');

var _awsSdk2 = _interopRequireDefault(_awsSdk);

var _ghostStorageBase = require('ghost-storage-base');

var _ghostStorageBase2 = _interopRequireDefault(_ghostStorageBase);

var _path = require('path');

var _path2 = _interopRequireDefault(_path);

var _fs = require('fs');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

var readFileAsync = function readFileAsync(fp) {
  return new Promise(function (resolve, reject) {
    return (0, _fs.readFile)(fp, function (err, data) {
      return err ? reject(err) : resolve(data);
    });
  });
};
var stripLeadingSlash = function stripLeadingSlash(s) {
  return s.indexOf('/') === 0 ? s.substring(1) : s;
};
var stripEndingSlash = function stripEndingSlash(s) {
  return s.indexOf('/') === s.length - 1 ? s.substring(0, s.length - 1) : s;
};
var ensureEndingSlash = function ensureEndingSlash(s) {
  return s && s.indexOf('/') !== s.length - 1 ? `${s}/` : s;
};
var normalizeUploadFilename = function normalizeUploadFilename(value) {
  var raw = String(value || '').trim() || 'upload.bin';
  var deduped = raw.match(/^(.*\.[a-z0-9]+)-[a-z0-9_-]+$/i);
  return deduped ? deduped[1] : raw;
};
// Sanitize filename for safe S3 object key. Preserves CJK characters
// (hiragana/katakana U+3040-30FF, CJK unified U+3400-9FFF) and common
// safe punctuation so non-Latin filenames remain readable.
var sanitizeFileName = function sanitizeFileName(fileName) {
  return fileName.replace(/[^\w.\-()+\u3040-\u30ff\u3400-\u9fff]/g, '-');
};
var buildUniqueFileName = function () {
  var _ref = _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee(store, dir, name, ext) {
    var index, append, filename, exists;
    return regeneratorRuntime.wrap(function _callee$(_context) {
      while (1) {
        switch (_context.prev = _context.next) {
          case 0:
            index = 0;

          case 1:
            if (!true) {
              _context.next = 12;
              break;
            }

            append = index ? `-${index}` : '';
            filename = ext ? `${name}${append}${ext}` : `${name}${append}`;
            _context.next = 6;
            return store.exists(filename, dir);

          case 6:
            exists = _context.sent;

            if (exists) {
              _context.next = 9;
              break;
            }

            return _context.abrupt('return', (0, _path.join)(dir, filename));

          case 9:

            index += 1;
            _context.next = 1;
            break;

          case 12:
          case 'end':
            return _context.stop();
        }
      }
    }, _callee, undefined);
  }));

  return function buildUniqueFileName(_x, _x2, _x3, _x4) {
    return _ref.apply(this, arguments);
  };
}();

class Store extends _ghostStorageBase2.default {
  constructor() {
    var config = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

    super(config);

    var accessKeyId = config.accessKeyId,
        assetHost = config.assetHost,
        bucket = config.bucket,
        pathPrefix = config.pathPrefix,
        region = config.region,
        secretAccessKey = config.secretAccessKey,
        endpoint = config.endpoint,
        serverSideEncryption = config.serverSideEncryption,
        forcePathStyle = config.forcePathStyle,
        signatureVersion = config.signatureVersion,
        acl = config.acl;

    // Compatible with the aws-sdk's default environment variables

    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.region = process.env.AWS_DEFAULT_REGION || region;

    this.bucket = process.env.GHOST_STORAGE_ADAPTER_S3_PATH_BUCKET || bucket;

    // Optional configurations
    this.host = process.env.GHOST_STORAGE_ADAPTER_S3_ASSET_HOST || assetHost || `https://s3${this.region === 'us-east-1' ? '' : `-${this.region}`}.amazonaws.com/${this.bucket}`;
    this.pathPrefix = stripLeadingSlash(process.env.GHOST_STORAGE_ADAPTER_S3_PATH_PREFIX || pathPrefix || '');
    this.endpoint = process.env.GHOST_STORAGE_ADAPTER_S3_ENDPOINT || endpoint || '';
    this.serverSideEncryption = process.env.GHOST_STORAGE_ADAPTER_S3_SSE || serverSideEncryption || '';
    this.s3ForcePathStyle = Boolean(process.env.GHOST_STORAGE_ADAPTER_S3_FORCE_PATH_STYLE) || Boolean(forcePathStyle) || false;
    this.signatureVersion = process.env.GHOST_STORAGE_ADAPTER_S3_SIGNATURE_VERSION || signatureVersion || 'v4';
    this.acl = process.env.GHOST_STORAGE_ADAPTER_S3_ACL || acl || 'public-read';
  }

  delete(fileName, targetDir) {
    var _this = this;

    var directory = targetDir || this.getTargetDir(this.pathPrefix);

    return new Promise(function (resolve, reject) {
      _this.s3().deleteObject({
        Bucket: _this.bucket,
        Key: stripLeadingSlash((0, _path.join)(directory, fileName))
      }, function (err) {
        return err ? resolve(false) : resolve(true);
      });
    });
  }

  exists(fileName, targetDir) {
    var _this2 = this;

    return new Promise(function (resolve, reject) {
      _this2.s3().getObject({
        Bucket: _this2.bucket,
        Key: stripLeadingSlash((0, _path.join)(targetDir, fileName))
      }, function (err) {
        return err ? resolve(false) : resolve(true);
      });
    });
  }

  // Bulk-delete every object under a key prefix (S3 has no real "folders" — this
  // empties a logical folder). Uses ListObjectsV2 + DeleteObjects in batches of
  // up to 1000 keys, so clearing e.g. a project's artifacts is O(objects/1000)
  // API calls instead of one deleteObject per file. Returns the count deleted.
  // Pass a trailing slash for folder semantics (e.g. "chart-jobs/{id}/jobs/") —
  // an empty prefix is refused to avoid ever emptying the whole bucket.
  deletePrefix(prefix) {
    var _this3 = this;

    var normalizedPrefix = stripLeadingSlash(String(prefix || ''));
    if (!normalizedPrefix) {
      return Promise.resolve(0);
    }

    var s3 = this.s3();
    var listPage = function listPage(continuationToken) {
      return new Promise(function (resolve, reject) {
        s3.listObjectsV2({
          Bucket: _this3.bucket,
          Prefix: normalizedPrefix,
          MaxKeys: 1000,
          ContinuationToken: continuationToken
        }, function (err, data) {
          return err ? reject(err) : resolve(data);
        });
      });
    };
    var deleteBatch = function deleteBatch(objects) {
      return new Promise(function (resolve, reject) {
        s3.deleteObjects({
          Bucket: _this3.bucket,
          Delete: { Objects: objects, Quiet: true }
        }, function (err, data) {
          return err ? reject(err) : resolve(data);
        });
      });
    };

    return _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee2() {
      var deleted, continuationToken, page, contents, keys;
      return regeneratorRuntime.wrap(function _callee2$(_context2) {
        while (1) {
          switch (_context2.prev = _context2.next) {
            case 0:
              deleted = 0;
              continuationToken = void 0;

            case 2:
              _context2.next = 4;
              return listPage(continuationToken);

            case 4:
              page = _context2.sent;
              contents = Array.isArray(page && page.Contents) ? page.Contents : [];
              keys = contents.map(function (o) {
                return { Key: o.Key };
              }).filter(function (o) {
                return o.Key;
              });

              if (!keys.length) {
                _context2.next = 11;
                break;
              }

              _context2.next = 10;
              return deleteBatch(keys);

            case 10:
              deleted += keys.length;

            case 11:
              continuationToken = page && page.IsTruncated ? page.NextContinuationToken : null;

            case 12:
              if (continuationToken) {
                _context2.next = 2;
                break;
              }

            case 13:
              return _context2.abrupt('return', deleted);

            case 14:
            case 'end':
              return _context2.stop();
          }
        }
      }, _callee2, _this3);
    }))();
  }

  s3() {
    var options = {
      bucket: this.bucket,
      region: this.region,
      signatureVersion: this.signatureVersion,
      s3ForcePathStyle: this.s3ForcePathStyle

      // Set credentials only if provided, falls back to AWS SDK's default provider chain
    };if (this.accessKeyId && this.secretAccessKey) {
      options.credentials = new _awsSdk2.default.Credentials(this.accessKeyId, this.secretAccessKey);
    }

    if (this.endpoint !== '') {
      options.endpoint = this.endpoint;
    }
    return new _awsSdk2.default.S3(options);
  }

  save(image, targetDir) {
    var _this4 = this;

    var directory = targetDir || this.getTargetDir(this.pathPrefix);
    var originalName = image && (image.name || image.originalname) || '';
    var normalizedName = normalizeUploadFilename(originalName);
    var fileExtension = _path2.default.extname(normalizedName);
    var ext = fileExtension.match(/\.\d+$/) ? null : fileExtension;
    var name = sanitizeFileName(ext ? _path2.default.basename(normalizedName, ext) : _path2.default.basename(normalizedName));

    return new Promise(function (resolve, reject) {
      Promise.all([buildUniqueFileName(_this4, directory, name, ext), readFileAsync(image.path)]).then(function (_ref3) {
        var _ref4 = _slicedToArray(_ref3, 2),
            fileName = _ref4[0],
            file = _ref4[1];

        var config = {
          //ACL: this.acl,
          Body: file,
          Bucket: _this4.bucket,
          CacheControl: `max-age=${30 * 24 * 60 * 60}`,
          ContentType: image.type,
          Key: stripLeadingSlash(fileName)
        };
        if (_this4.serverSideEncryption !== '') {
          config.ServerSideEncryption = _this4.serverSideEncryption;
        }
        _this4.s3().putObject(config, function (err, data) {
          return err ? reject(err) : resolve(`${_this4.host}/${fileName}`);
        });
      }).catch(function (err) {
        return reject(err);
      });
    });
  }

  serve() {
    var _this5 = this;

    return function (req, res, next) {
      return _this5.s3().getObject({
        Bucket: _this5.bucket,
        Key: stripLeadingSlash(stripEndingSlash(_this5.pathPrefix) + req.path)
      }).on('httpHeaders', function (statusCode, headers, response) {
        return res.set(headers);
      }).createReadStream().on('error', function (err) {
        res.status(404);
        next(err);
      }).pipe(res);
    };
  }

  read(options) {
    var _this6 = this;

    options = options || {};

    return new Promise(function (resolve, reject) {
      // remove trailing slashes
      var path = (options.path || '').replace(/\/$|\\$/, '');

      // check if path is stored in s3 handled by us
      if (!path.startsWith(_this6.host)) {
        reject(new Error(`${path} is not stored in s3`));
      }
      path = path.substring(_this6.host.length);

      _this6.s3().getObject({
        Bucket: _this6.bucket,
        Key: stripLeadingSlash(path)
      }, function (err, data) {
        return err ? reject(err) : resolve(data.Body);
      });
    });
  }

  list() {
    var _this7 = this;

    var options = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

    var rawPrefix = typeof options.prefix === 'string' ? options.prefix : this.pathPrefix;
    var prefix = ensureEndingSlash(stripLeadingSlash(rawPrefix || ''));
    var limit = Number.parseInt(options.limit, 10);
    var continuationToken = options.continuationToken || options.next_cursor;

    var params = {
      Bucket: this.bucket,
      Prefix: prefix,
      MaxKeys: Number.isNaN(limit) || limit <= 0 ? 100 : Math.min(limit, 1000)
    };

    if (continuationToken) {
      params.ContinuationToken = continuationToken;
    }

    return new Promise(function (resolve, reject) {
      _this7.s3().listObjectsV2(params, function (err, data) {
        if (err) {
          reject(err);
          return;
        }

        var contents = Array.isArray(data.Contents) ? data.Contents : [];
        var items = contents.filter(function (item) {
          return item && item.Key && !item.Key.endsWith('/');
        }).map(function (item) {
          return {
            key: item.Key,
            url: `${_this7.host}/${item.Key}`,
            path: item.Key,
            name: item.Key.split('/').pop(),
            size: item.Size,
            etag: item.ETag,
            lastModified: item.LastModified
          };
        });

        resolve({
          items,
          prefix,
          count: items.length,
          nextCursor: data.IsTruncated ? data.NextContinuationToken : null
        });
      });
    });
  }

  getPresignedPutUrl() {
    var _this8 = this;

    var options = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

    var key = stripLeadingSlash(String(options.key || '').trim());
    var contentType = String(options.contentType || 'application/octet-stream').trim();
    var expiresInSeconds = Number.parseInt(options.expiresInSeconds, 10);
    var cacheControl = String(options.cacheControl || `max-age=${30 * 24 * 60 * 60}`).trim();

    if (!key) {
      return Promise.reject(new Error('key is required'));
    }

    var params = {
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      CacheControl: cacheControl,
      Expires: Number.isNaN(expiresInSeconds) || expiresInSeconds <= 0 ? 900 : expiresInSeconds
    };

    if (this.serverSideEncryption !== '') {
      params.ServerSideEncryption = this.serverSideEncryption;
    }

    return new Promise(function (resolve, reject) {
      _this8.s3().getSignedUrl('putObject', params, function (err, url) {
        if (err) {
          reject(err);
          return;
        }

        resolve({
          uploadUrl: url,
          key,
          url: `${_this8.host}/${key}`,
          headers: {
            'Content-Type': contentType,
            'Cache-Control': cacheControl
          }
        });
      });
    });
  }

  urlToPath(url) {
    var path = url;
    if (path.startsWith(this.host)) {
      path = path.replace(this.host, '');
    }
    if (path.startsWith('/')) {
      path = path.substring(1);
    }
    return path;
  }
}

exports.default = Store;
module.exports = exports['default'];
