'use strict'

// npm test (node --test test/)  (exercises the built bundle via index.js → dist/index.js)
const test = require('node:test')
const assert = require('node:assert/strict')
const Store = require('..')

const makeStore = (config = {}) => {
  const store = new Store({ bucket: 'bucket', region: 'ap-northeast-1', assetHost: 'https://cdn.example.com', pathPrefix: '60-think-dev', ...config })
  const calls = []
  store.s3 = () => ({ copyObject (params, cb) { calls.push(params); cb(store.copyError || null, {}) } })
  return { store, calls }
}

test('copy() is exposed by the built adapter', () => {
  assert.equal(typeof new Store({ bucket: 'b' }).copy, 'function')
})

test('copy() issues a server-side copyObject and resolves to the public URL', async () => {
  const { store, calls } = makeStore()
  const url = await store.copy('60-think-dev/gallery/users/u1/2026/10/a.png', '60-think-dev/gallery/chart_projects/p1/2026/10/a-1234abcd.png')
  assert.equal(url, 'https://cdn.example.com/60-think-dev/gallery/chart_projects/p1/2026/10/a-1234abcd.png')
  assert.deepEqual(calls, [{
    Bucket: 'bucket',
    CopySource: 'bucket/60-think-dev/gallery/users/u1/2026/10/a.png',
    Key: '60-think-dev/gallery/chart_projects/p1/2026/10/a-1234abcd.png',
    MetadataDirective: 'COPY'
  }])
})

test('copy() URL-encodes each CopySource segment (Unicode / spaces) but keeps Key raw', async () => {
  const { store, calls } = makeStore()
  await store.copy('/60-think-dev/gallery/日本語 ファイル+1.png', '/60-think-dev/dest/日本語 ファイル+1-x.png')
  assert.equal(calls[0].CopySource, `bucket/60-think-dev/gallery/${encodeURIComponent('日本語 ファイル+1.png')}`)
  assert.equal(calls[0].Key, '60-think-dev/dest/日本語 ファイル+1-x.png')
})

test('copy() does not add pathPrefix again', async () => {
  const { store, calls } = makeStore()
  await store.copy('60-think-dev/x/a.png', '60-think-dev/y/a.png')
  assert.ok(!calls[0].Key.startsWith('60-think-dev/60-think-dev'))
  assert.ok(!calls[0].CopySource.includes('60-think-dev/60-think-dev'))
})

test('copy() passes ServerSideEncryption when configured', async () => {
  const { store, calls } = makeStore({ serverSideEncryption: 'AES256' })
  await store.copy('k/a.png', 'k/b.png')
  assert.equal(calls[0].ServerSideEncryption, 'AES256')
})

test('copy() rejects on S3 error and on empty keys', async () => {
  const { store, calls } = makeStore()
  store.copyError = new Error('AccessDenied')
  await assert.rejects(store.copy('k/a.png', 'k/b.png'), /AccessDenied/)
  await assert.rejects(store.copy('', 'k/b.png'), /source key is required/)
  await assert.rejects(store.copy('k/a.png', '  '), /destination key is required/)
  assert.equal(calls.length, 1)
})
