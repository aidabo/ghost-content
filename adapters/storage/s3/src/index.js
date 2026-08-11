import AWS from 'aws-sdk'
import BaseStore from 'ghost-storage-base'
import path, { join } from 'path'
import { readFile } from 'fs'

const readFileAsync = fp => new Promise((resolve, reject) => readFile(fp, (err, data) => err ? reject(err) : resolve(data)))
const stripLeadingSlash = s => s.indexOf('/') === 0 ? s.substring(1) : s
const stripEndingSlash = s => s.indexOf('/') === (s.length - 1) ? s.substring(0, s.length - 1) : s
const ensureEndingSlash = s => (s && s.indexOf('/') !== (s.length - 1)) ? `${s}/` : s
const normalizeUploadFilename = (value) => {
  const raw = String(value || '').trim() || 'upload.bin'
  const deduped = raw.match(/^(.*\.[a-z0-9]+)-[a-z0-9_-]+$/i)
  return deduped ? deduped[1] : raw
}
// Sanitize filename for safe S3 object key. Preserves CJK characters
// (hiragana/katakana U+3040-30FF, CJK unified U+3400-9FFF) and common
// safe punctuation so non-Latin filenames remain readable.
const sanitizeFileName = (fileName) => fileName.replace(/[^\w.\-()+\u3040-\u30ff\u3400-\u9fff]/g, '-')
const buildUniqueFileName = async (store, dir, name, ext) => {
  let index = 0

  while (true) {
    const append = index ? `-${index}` : ''
    const filename = ext ? `${name}${append}${ext}` : `${name}${append}`
    const exists = await store.exists(filename, dir)

    if (!exists) {
      return join(dir, filename)
    }

    index += 1
  }
}

class Store extends BaseStore {
  constructor (config = {}) {
    super(config)

    const {
      accessKeyId,
      assetHost,
      bucket,
      pathPrefix,
      region,
      secretAccessKey,
      endpoint,
      serverSideEncryption,
      forcePathStyle,
      signatureVersion,
      acl
    } = config

    // Compatible with the aws-sdk's default environment variables
    this.accessKeyId = accessKeyId
    this.secretAccessKey = secretAccessKey
    this.region = process.env.AWS_DEFAULT_REGION || region

    this.bucket = process.env.GHOST_STORAGE_ADAPTER_S3_PATH_BUCKET || bucket

    // Optional configurations
    this.host = process.env.GHOST_STORAGE_ADAPTER_S3_ASSET_HOST || assetHost || `https://s3${this.region === 'us-east-1' ? '' : `-${this.region}`}.amazonaws.com/${this.bucket}`
    this.pathPrefix = stripLeadingSlash(process.env.GHOST_STORAGE_ADAPTER_S3_PATH_PREFIX || pathPrefix || '')
    this.endpoint = process.env.GHOST_STORAGE_ADAPTER_S3_ENDPOINT || endpoint || ''
    this.serverSideEncryption = process.env.GHOST_STORAGE_ADAPTER_S3_SSE || serverSideEncryption || ''
    this.s3ForcePathStyle = Boolean(process.env.GHOST_STORAGE_ADAPTER_S3_FORCE_PATH_STYLE) || Boolean(forcePathStyle) || false
    this.signatureVersion = process.env.GHOST_STORAGE_ADAPTER_S3_SIGNATURE_VERSION || signatureVersion || 'v4'
    this.acl = process.env.GHOST_STORAGE_ADAPTER_S3_ACL || acl || 'public-read'
  }

  delete (fileName, targetDir) {
    const directory = targetDir || this.getTargetDir(this.pathPrefix)

    return new Promise((resolve, reject) => {
      this.s3()
        .deleteObject({
          Bucket: this.bucket,
          Key: stripLeadingSlash(join(directory, fileName))
        }, (err) => err ? resolve(false) : resolve(true))
    })
  }

  exists (fileName, targetDir) {
    return new Promise((resolve, reject) => {
      this.s3()
        .getObject({
          Bucket: this.bucket,
          Key: stripLeadingSlash(join(targetDir, fileName))
        }, (err) => err ? resolve(false) : resolve(true))
    })
  }

  // Bulk-delete every object under a key prefix (S3 has no real "folders" — this
  // empties a logical folder). Uses ListObjectsV2 + DeleteObjects in batches of
  // up to 1000 keys, so clearing e.g. a project's artifacts is O(objects/1000)
  // API calls instead of one deleteObject per file. Returns the count deleted.
  // Pass a trailing slash for folder semantics (e.g. "chart-jobs/{id}/jobs/") —
  // an empty prefix is refused to avoid ever emptying the whole bucket.
  deletePrefix (prefix) {
    const normalizedPrefix = stripLeadingSlash(String(prefix || ''))
    if (!normalizedPrefix) {
      return Promise.resolve(0)
    }

    const s3 = this.s3()
    const listPage = (continuationToken) => new Promise((resolve, reject) => {
      s3.listObjectsV2({
        Bucket: this.bucket,
        Prefix: normalizedPrefix,
        MaxKeys: 1000,
        ContinuationToken: continuationToken
      }, (err, data) => err ? reject(err) : resolve(data))
    })
    const deleteBatch = (objects) => new Promise((resolve, reject) => {
      s3.deleteObjects({
        Bucket: this.bucket,
        Delete: { Objects: objects, Quiet: true }
      }, (err, data) => err ? reject(err) : resolve(data))
    })

    return (async () => {
      let deleted = 0
      let continuationToken
      do {
        const page = await listPage(continuationToken)
        const contents = Array.isArray(page && page.Contents) ? page.Contents : []
        const keys = contents.map(o => ({ Key: o.Key })).filter(o => o.Key)
        if (keys.length) {
          // A single ListObjectsV2 page is already <= 1000 keys, so one
          // DeleteObjects call per page stays within the 1000-key limit.
          await deleteBatch(keys)
          deleted += keys.length
        }
        continuationToken = page && page.IsTruncated ? page.NextContinuationToken : null
      } while (continuationToken)
      return deleted
    })()
  }

  s3 () {
    const options = {
      bucket: this.bucket,
      region: this.region,
      signatureVersion: this.signatureVersion,
      s3ForcePathStyle: this.s3ForcePathStyle
    }

    // Set credentials only if provided, falls back to AWS SDK's default provider chain
    if (this.accessKeyId && this.secretAccessKey) {
      options.credentials = new AWS.Credentials(this.accessKeyId, this.secretAccessKey)
    }

    if (this.endpoint !== '') {
      options.endpoint = this.endpoint
    }
    return new AWS.S3(options)
  }

  save (image, targetDir) {
    const directory = targetDir || this.getTargetDir(this.pathPrefix)
    const originalName = image && (image.name || image.originalname) || ''
    const normalizedName = normalizeUploadFilename(originalName)
    const fileExtension = path.extname(normalizedName)
    const ext = fileExtension.match(/\.\d+$/) ? null : fileExtension
    const name = sanitizeFileName(ext ? path.basename(normalizedName, ext) : path.basename(normalizedName))

    return new Promise((resolve, reject) => {
      Promise.all([
        buildUniqueFileName(this, directory, name, ext),
        readFileAsync(image.path)
      ]).then(([ fileName, file ]) => {
        let config = {
          //ACL: this.acl,
          Body: file,
          Bucket: this.bucket,
          CacheControl: `max-age=${30 * 24 * 60 * 60}`,
          ContentType: image.type,
          Key: stripLeadingSlash(fileName)
        }
        if (this.serverSideEncryption !== '') {
          config.ServerSideEncryption = this.serverSideEncryption
        }
        this.s3()
          .putObject(config, (err, data) => err ? reject(err) : resolve(`${this.host}/${fileName}`))
      })
      .catch(err => reject(err))
    })
  }

  serve () {
    return (req, res, next) =>
      this.s3()
        .getObject({
          Bucket: this.bucket,
          Key: stripLeadingSlash(stripEndingSlash(this.pathPrefix) + req.path)
        })
        .on('httpHeaders', (statusCode, headers, response) => res.set(headers))
        .createReadStream()
        .on('error', err => {
          res.status(404)
          next(err)
        })
        .pipe(res)
  }

  read (options) {
    options = options || {}

    return new Promise((resolve, reject) => {
      // remove trailing slashes
      let path = (options.path || '').replace(/\/$|\\$/, '')

      // check if path is stored in s3 handled by us
      if (!path.startsWith(this.host)) {
        reject(new Error(`${path} is not stored in s3`))
      }
      path = path.substring(this.host.length)

      this.s3()
        .getObject({
          Bucket: this.bucket,
          Key: stripLeadingSlash(path)
        }, (err, data) => err ? reject(err) : resolve(data.Body))
    })
  }

  list (options = {}) {
    const rawPrefix = typeof options.prefix === 'string' ? options.prefix : this.pathPrefix
    const prefix = ensureEndingSlash(stripLeadingSlash(rawPrefix || ''))
    const limit = Number.parseInt(options.limit, 10)
    const continuationToken = options.continuationToken || options.next_cursor

    const params = {
      Bucket: this.bucket,
      Prefix: prefix,
      MaxKeys: Number.isNaN(limit) || limit <= 0 ? 100 : Math.min(limit, 1000)
    }

    if (continuationToken) {
      params.ContinuationToken = continuationToken
    }

    return new Promise((resolve, reject) => {
      this.s3().listObjectsV2(params, (err, data) => {
        if (err) {
          reject(err)
          return
        }

        const contents = Array.isArray(data.Contents) ? data.Contents : []
        const items = contents
          .filter(item => item && item.Key && !item.Key.endsWith('/'))
          .map(item => ({
            key: item.Key,
            url: `${this.host}/${item.Key}`,
            path: item.Key,
            name: item.Key.split('/').pop(),
            size: item.Size,
            etag: item.ETag,
            lastModified: item.LastModified
          }))

        resolve({
          items,
          prefix,
          count: items.length,
          nextCursor: data.IsTruncated ? data.NextContinuationToken : null
        })
      })
    })
  }

  getPresignedPutUrl (options = {}) {
    const key = stripLeadingSlash(String(options.key || '').trim())
    const contentType = String(options.contentType || 'application/octet-stream').trim()
    const expiresInSeconds = Number.parseInt(options.expiresInSeconds, 10)
    const cacheControl = String(options.cacheControl || `max-age=${30 * 24 * 60 * 60}`).trim()

    if (!key) {
      return Promise.reject(new Error('key is required'))
    }

    const params = {
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      CacheControl: cacheControl,
      Expires: Number.isNaN(expiresInSeconds) || expiresInSeconds <= 0 ? 900 : expiresInSeconds
    }

    if (this.serverSideEncryption !== '') {
      params.ServerSideEncryption = this.serverSideEncryption
    }

    return new Promise((resolve, reject) => {
      this.s3().getSignedUrl('putObject', params, (err, url) => {
        if (err) {
          reject(err)
          return
        }

        resolve({
          uploadUrl: url,
          key,
          url: `${this.host}/${key}`,
          headers: {
            'Content-Type': contentType,
            'Cache-Control': cacheControl
          }
        })
      })
    })
  }

  urlToPath (url) {
    var path = url
    if (path.startsWith(this.host)) {
      path = path.replace(this.host, '')
    }
    if (path.startsWith('/')) {
      path = path.substring(1)
    }
    return path
  }
}

export default Store
