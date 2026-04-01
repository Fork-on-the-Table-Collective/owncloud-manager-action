import assert from 'assert';
import { buildUrl, uploadFile, uploadDirectory, downloadFile, listFiles, parsePropfind } from '../src/owncloud.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${(err as Error).message}`);
    failed++;
  }
}

console.log('\nowncloud.ts unit tests\n');

// buildUrl
test('buildUrl: trailing slash stripped from server URL', () => {
  const url = buildUrl('https://cloud.example.com/', '/docs/file.txt');
  assert.strictEqual(url.href, 'https://cloud.example.com/remote.php/webdav/docs/file.txt');
});

test('buildUrl: remotePath without leading slash', () => {
  const url = buildUrl('https://cloud.example.com', 'docs/file.txt');
  assert.strictEqual(url.href, 'https://cloud.example.com/remote.php/webdav/docs/file.txt');
});

test('buildUrl: root path', () => {
  const url = buildUrl('https://cloud.example.com', '/');
  assert.strictEqual(url.href, 'https://cloud.example.com/remote.php/webdav/');
});

test('buildUrl: port preserved', () => {
  const url = buildUrl('http://localhost:8080', '/test/file.txt');
  assert.strictEqual(url.hostname, 'localhost');
  assert.strictEqual(url.port, '8080');
  assert.ok(url.pathname.includes('/remote.php/webdav/test/file.txt'));
});

test('buildUrl: path with spaces is encoded in URL', () => {
  const url = buildUrl('https://cloud.example.com', '/my folder/my file.txt');
  assert.ok(url.pathname.includes('my%20folder'));
});

test('module exports expected functions', () => {
  assert.strictEqual(typeof uploadFile, 'function');
  assert.strictEqual(typeof uploadDirectory, 'function');
  assert.strictEqual(typeof downloadFile, 'function');
  assert.strictEqual(typeof listFiles, 'function');
  assert.strictEqual(typeof buildUrl, 'function');
  assert.strictEqual(typeof parsePropfind, 'function');
});

// parsePropfind
const samplePropfind = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/remote.php/webdav/docs/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection /></d:resourcetype>
        <d:getlastmodified>Mon, 01 Jan 2024 00:00:00 GMT</d:getlastmodified>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/webdav/docs/report.pdf</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype/>
        <d:getcontentlength>12345</d:getcontentlength>
        <d:getlastmodified>Tue, 02 Jan 2024 12:00:00 GMT</d:getlastmodified>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;

test('parsePropfind: returns correct number of entries', () => {
  const items = parsePropfind(samplePropfind);
  assert.strictEqual(items.length, 2);
});

test('parsePropfind: identifies directory correctly', () => {
  const items = parsePropfind(samplePropfind);
  const dir = items.find((i) => i.href.endsWith('/docs/'));
  assert.ok(dir, 'directory entry not found');
  assert.strictEqual(dir.type, 'directory');
  assert.strictEqual(dir.size, null);
});

test('parsePropfind: identifies file correctly', () => {
  const items = parsePropfind(samplePropfind);
  const file = items.find((i) => i.href.includes('report.pdf'));
  assert.ok(file, 'file entry not found');
  assert.strictEqual(file.type, 'file');
  assert.strictEqual(file.size, 12345);
  assert.strictEqual(file.lastModified, 'Tue, 02 Jan 2024 12:00:00 GMT');
});

test('parsePropfind: returns empty array for empty response', () => {
  const items = parsePropfind('<d:multistatus xmlns:d="DAV:"></d:multistatus>');
  assert.deepStrictEqual(items, []);
});

test('parsePropfind: decodes percent-encoded hrefs', () => {
  const xml = `<d:multistatus xmlns:d="DAV:">
    <d:response>
      <d:href>/remote.php/webdav/my%20folder/my%20file.txt</d:href>
      <d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat>
    </d:response>
  </d:multistatus>`;
  const items = parsePropfind(xml);
  assert.ok(items[0].href.includes('my folder'), 'href was not decoded');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
