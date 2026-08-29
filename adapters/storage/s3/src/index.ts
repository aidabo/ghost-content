import AWS = require('aws-sdk')
import BaseStore = require('ghost-storage-base')
import path = require('path')
import { readFile } from 'fs'

const readFileAsync = (fp: string): Promise<Buffer> => new Promise((resolve, reject) => readFile(fp, (err, data) => err ? reject(err) : resolve(data)))
const stripLeadingSlash = (s: string): string => s.indexOf('/') === 0 ? s.substring(1) : s
const stripEndingSlash = (s: string): string => s.indexOf('/') === (s.length - 1) ? s.substring(0, s.length - 1) : s
const ensureEndingSlash = (s: string): string => (s && s.indexOf('/') !== (s.length - 1)) ? `${s}/` : s
const normalizeUploadFilename = (value: unknown): string => {
  const raw = String(value || '').trim() || 'upload.bin'
  const deduped = raw.match(/^(.*\.[a-z0-9]+)-[a-z0-9_-]+$/i)
  return deduped ? deduped[1] : raw
}
const sanitizeFileName = (fileName: string): string => fileName.replace(/[^\w.\-()+\u3040-\u30ff\u3400-\u9fff]/g, '-')

interface UploadImage { path: string; name?: string; originalname?: string; type?: string }
interface ListOptions { prefix?: string; limit?: string | number; continuationToken?: string; next_cursor?: string }
interface PresignedOptions { key?: string; contentType?: string; expiresInSeconds?: string | number; cacheControl?: string }
interface StoreConfig {
  accessKeyId?: string; assetHost?: string; bucket?: string; pathPrefix?: string; region?: string
  secretAccessKey?: string; endpoint?: string; serverSideEncryption?: string; forcePathStyle?: boolean
  signatureVersion?: string; acl?: string
}

const buildUniqueFileName = async (store: Store, dir: string, name: string, ext: string | null): Promise<string> => {
  let index = 0
  while (true) {
    const append = index ? `-${index}` : ''
    const filename = ext ? `${name}${append}${ext}` : `${name}${append}`
    if (!await store.exists(filename, dir)) return path.join(dir, filename)
    index += 1
  }
}

class Store extends (BaseStore as any) {
  accessKeyId?: string; secretAccessKey?: string; region?: string; bucket?: string; host: string; pathPrefix: string
  endpoint: string; serverSideEncryption: string; s3ForcePathStyle: boolean; signatureVersion: string; acl: string

  constructor (config: StoreConfig = {}) {
    super(config)
    const { accessKeyId, assetHost, bucket, pathPrefix, region, secretAccessKey, endpoint, serverSideEncryption, forcePathStyle, signatureVersion, acl } = config
    this.accessKeyId = accessKeyId
    this.secretAccessKey = secretAccessKey
    this.region = process.env.AWS_DEFAULT_REGION || region
    this.bucket = process.env.GHOST_STORAGE_ADAPTER_S3_PATH_BUCKET || bucket
    this.host = process.env.GHOST_STORAGE_ADAPTER_S3_ASSET_HOST || assetHost || `https://s3${this.region === 'us-east-1' ? '' : `-${this.region}`}.amazonaws.com/${this.bucket}`
    this.pathPrefix = stripLeadingSlash(process.env.GHOST_STORAGE_ADAPTER_S3_PATH_PREFIX || pathPrefix || '')
    this.endpoint = process.env.GHOST_STORAGE_ADAPTER_S3_ENDPOINT || endpoint || ''
    this.serverSideEncryption = process.env.GHOST_STORAGE_ADAPTER_S3_SSE || serverSideEncryption || ''
    this.s3ForcePathStyle = Boolean(process.env.GHOST_STORAGE_ADAPTER_S3_FORCE_PATH_STYLE) || Boolean(forcePathStyle) || false
    this.signatureVersion = process.env.GHOST_STORAGE_ADAPTER_S3_SIGNATURE_VERSION || signatureVersion || 'v4'
    this.acl = process.env.GHOST_STORAGE_ADAPTER_S3_ACL || acl || 'public-read'
  }

  delete (fileName: string, targetDir?: string): Promise<boolean> {
    const directory = targetDir || (this as any).getTargetDir(this.pathPrefix)
    return new Promise(resolve => this.s3().deleteObject({ Bucket: this.bucket, Key: stripLeadingSlash(path.join(directory, fileName)) }, err => resolve(!err)))
  }

  exists (fileName: string, targetDir: string): Promise<boolean> {
    return new Promise(resolve => this.s3().getObject({ Bucket: this.bucket, Key: stripLeadingSlash(path.join(targetDir, fileName)) }, err => resolve(!err)))
  }

  deletePrefix (prefix: string): Promise<number> {
    const normalizedPrefix = stripLeadingSlash(String(prefix || ''))
    if (!normalizedPrefix) return Promise.resolve(0)
    const s3 = this.s3()
    const listPage = (ContinuationToken?: string): Promise<AWS.S3.ListObjectsV2Output> => new Promise((resolve, reject) => s3.listObjectsV2({ Bucket: this.bucket, Prefix: normalizedPrefix, MaxKeys: 1000, ContinuationToken }, (err, data) => err ? reject(err) : resolve(data)))
    const deleteBatch = (Objects: AWS.S3.ObjectIdentifier[]): Promise<AWS.S3.DeleteObjectsOutput> => new Promise((resolve, reject) => s3.deleteObjects({ Bucket: this.bucket, Delete: { Objects, Quiet: true } }, (err, data) => err ? reject(err) : resolve(data)))
    return (async () => { let deleted = 0; let token: string | undefined; do { const page = await listPage(token); const keys = (page.Contents || []).map(o => ({ Key: o.Key })).filter(o => o.Key) as AWS.S3.ObjectIdentifier[]; if (keys.length) { await deleteBatch(keys); deleted += keys.length }; token = page.IsTruncated ? page.NextContinuationToken : undefined } while (token); return deleted })()
  }

  s3 (): AWS.S3 {
    const options: AWS.S3.ClientConfiguration = { region: this.region, signatureVersion: this.signatureVersion, s3ForcePathStyle: this.s3ForcePathStyle }
    if (this.accessKeyId && this.secretAccessKey) options.credentials = new AWS.Credentials(this.accessKeyId, this.secretAccessKey)
    if (this.endpoint) options.endpoint = this.endpoint
    return new AWS.S3(options)
  }

  save (image: UploadImage, targetDir?: string): Promise<string> {
    const directory = targetDir || (this as any).getTargetDir(this.pathPrefix)
    const normalizedName = normalizeUploadFilename(image && (image.name || image.originalname))
    const fileExtension = path.extname(normalizedName)
    const ext = fileExtension.match(/\.\d+$/) ? null : fileExtension
    const name = sanitizeFileName(ext ? path.basename(normalizedName, ext) : path.basename(normalizedName))
    return Promise.all([buildUniqueFileName(this, directory, name, ext), readFileAsync(image.path)]).then(([fileName, file]) => {
      const config: AWS.S3.PutObjectRequest = { Body: file, Bucket: this.bucket!, CacheControl: `max-age=${30 * 24 * 60 * 60}`, ContentType: image.type, Key: stripLeadingSlash(fileName) }
      if (this.serverSideEncryption) config.ServerSideEncryption = this.serverSideEncryption
      return new Promise<string>((resolve, reject) => this.s3().putObject(config, err => err ? reject(err) : resolve(`${this.host}/${fileName}`)))
    })
  }

  serve (): (req: any, res: any, next: any) => any { return (req, res, next) => this.s3().getObject({ Bucket: this.bucket, Key: stripLeadingSlash(stripEndingSlash(this.pathPrefix) + req.path) }).on('httpHeaders', (_status, headers) => res.set(headers)).createReadStream().on('error', err => { res.status(404); next(err) }).pipe(res) }

  read (options: { path?: string } = {}): Promise<AWS.S3.Body> {
    let objectPath = (options.path || '').replace(/\/$|\\$/, '')
    if (!objectPath.startsWith(this.host)) return Promise.reject(new Error(`${objectPath} is not stored in s3`))
    objectPath = objectPath.substring(this.host.length)
    return new Promise((resolve, reject) => this.s3().getObject({ Bucket: this.bucket, Key: stripLeadingSlash(objectPath) }, (err, data) => err ? reject(err) : resolve(data.Body)))
  }

  list (options: ListOptions = {}): Promise<any> { const prefix = ensureEndingSlash(stripLeadingSlash(typeof options.prefix === 'string' ? options.prefix : this.pathPrefix || '')); const rawLimit = Number.parseInt(String(options.limit), 10); const params: AWS.S3.ListObjectsV2Request = { Bucket: this.bucket!, Prefix: prefix, MaxKeys: Number.isNaN(rawLimit) || rawLimit <= 0 ? 100 : Math.min(rawLimit, 1000) }; const token = options.continuationToken || options.next_cursor; if (token) params.ContinuationToken = token; return new Promise((resolve, reject) => this.s3().listObjectsV2(params, (err, data) => { if (err) return reject(err); const items = (data.Contents || []).filter(item => item.Key && !item.Key.endsWith('/')).map(item => ({ key: item.Key, url: `${this.host}/${item.Key}`, path: item.Key, name: item.Key!.split('/').pop(), size: item.Size, etag: item.ETag, lastModified: item.LastModified })); resolve({ items, prefix, count: items.length, nextCursor: data.IsTruncated ? data.NextContinuationToken : null }) })) }

  getPresignedPutUrl (options: PresignedOptions = {}): Promise<any> { const key = stripLeadingSlash(String(options.key || '').trim()); const contentType = String(options.contentType || 'application/octet-stream').trim(); const expires = Number.parseInt(String(options.expiresInSeconds), 10); const cacheControl = String(options.cacheControl || `max-age=${30 * 24 * 60 * 60}`).trim(); if (!key) return Promise.reject(new Error('key is required')); const params: AWS.S3.GetObjectRequest & { Expires: number; ContentType: string; CacheControl: string } = { Bucket: this.bucket!, Key: key, ContentType: contentType, CacheControl: cacheControl, Expires: Number.isNaN(expires) || expires <= 0 ? 900 : expires }; if (this.serverSideEncryption) (params as any).ServerSideEncryption = this.serverSideEncryption; return new Promise((resolve, reject) => this.s3().getSignedUrl('putObject', params as any, (err, url) => err ? reject(err) : resolve({ uploadUrl: url, key, url: `${this.host}/${key}`, headers: { 'Content-Type': contentType, 'Cache-Control': cacheControl } }))) }

  urlToPath (url: string): string { let objectPath = url; if (objectPath.startsWith(this.host)) objectPath = objectPath.replace(this.host, ''); return objectPath.startsWith('/') ? objectPath.substring(1) : objectPath }
}

export = Store
