'use strict';

/**
 * Unit tests for owncloud.js helper functions.
 * These tests run without a real OwnCloud server.
 */

const assert = require('assert');
const { buildUrl } = require('../src/owncloud');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

console.log('\nowncloud.js unit tests\n');

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

// parsePropfind (tested indirectly via exports — extend if needed)
test('module exports expected functions', () => {
  const mod = require('../src/owncloud');
  assert.strictEqual(typeof mod.uploadFile, 'function');
  assert.strictEqual(typeof mod.uploadDirectory, 'function');
  assert.strictEqual(typeof mod.downloadFile, 'function');
  assert.strictEqual(typeof mod.listFiles, 'function');
  assert.strictEqual(typeof mod.buildUrl, 'function');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
