'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

/**
 * Build a fully-qualified WebDAV URL for the given remote path.
 * OwnCloud exposes WebDAV at /remote.php/webdav/<path>.
 *
 * @param {string} serverUrl  Base server URL, e.g. https://cloud.example.com
 * @param {string} remotePath Path inside OwnCloud, e.g. /documents/report.pdf
 * @returns {URL}
 */
function buildUrl(serverUrl, remotePath) {
  const base = serverUrl.replace(/\/$/, '');
  const normalized = remotePath.startsWith('/') ? remotePath : `/${remotePath}`;
  return new URL(`${base}/remote.php/webdav${normalized}`);
}

/**
 * Create the Authorization header value for Basic auth.
 *
 * @param {string} username
 * @param {string} password
 * @returns {string}
 */
function basicAuth(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

/**
 * Perform an HTTP/HTTPS request and return { statusCode, headers, body }.
 *
 * @param {object} options  node http/https request options
 * @param {Buffer|null} body  optional request body
 * @returns {Promise<{statusCode: number, headers: object, body: string}>}
 */
function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const transport = options.protocol === 'http:' ? http : https;
    const req = transport.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () =>
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        })
      );
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Ensure that every directory component of remotePath exists on OwnCloud,
 * creating missing directories with MKCOL.
 *
 * @param {string} serverUrl
 * @param {string} username
 * @param {string} password
 * @param {string} remotePath  e.g. /a/b/c/file.txt  — directories up to /a/b/c are ensured
 */
async function ensureDirectories(serverUrl, username, password, remotePath) {
  const dir = path.posix.dirname(remotePath);
  if (dir === '/' || dir === '.') return;

  const parts = dir.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current += `/${part}`;
    const url = buildUrl(serverUrl, current);
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'MKCOL',
      protocol: url.protocol,
      headers: {
        Authorization: basicAuth(username, password),
      },
    };
    const res = await request(options);
    // 201 = created, 405 = already exists — both are fine
    if (res.statusCode !== 201 && res.statusCode !== 405) {
      throw new Error(
        `Failed to create directory ${current}: HTTP ${res.statusCode}\n${res.body}`
      );
    }
  }
}

/**
 * Upload a local file to OwnCloud.
 *
 * @param {string} serverUrl
 * @param {string} username
 * @param {string} password
 * @param {string} localPath   Absolute or relative local file path
 * @param {string} remotePath  Destination path on OwnCloud
 */
async function uploadFile(serverUrl, username, password, localPath, remotePath) {
  await ensureDirectories(serverUrl, username, password, remotePath);

  const fileContent = fs.readFileSync(localPath);
  const url = buildUrl(serverUrl, remotePath);
  const options = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname,
    method: 'PUT',
    protocol: url.protocol,
    headers: {
      Authorization: basicAuth(username, password),
      'Content-Type': 'application/octet-stream',
      'Content-Length': fileContent.length,
    },
  };

  const res = await request(options, fileContent);
  if (res.statusCode !== 200 && res.statusCode !== 201 && res.statusCode !== 204) {
    throw new Error(`Upload failed for ${remotePath}: HTTP ${res.statusCode}\n${res.body}`);
  }
}

/**
 * Recursively upload a local directory to OwnCloud.
 *
 * @param {string} serverUrl
 * @param {string} username
 * @param {string} password
 * @param {string} localDir    Local directory path
 * @param {string} remoteDir   Destination directory path on OwnCloud
 * @returns {Promise<string[]>}  List of uploaded remote paths
 */
async function uploadDirectory(serverUrl, username, password, localDir, remoteDir) {
  const uploaded = [];
  const entries = fs.readdirSync(localDir, { withFileTypes: true });
  for (const entry of entries) {
    const localEntry = path.join(localDir, entry.name);
    const remoteEntry = `${remoteDir.replace(/\/$/, '')}/${entry.name}`;
    if (entry.isDirectory()) {
      const sub = await uploadDirectory(serverUrl, username, password, localEntry, remoteEntry);
      uploaded.push(...sub);
    } else {
      await uploadFile(serverUrl, username, password, localEntry, remoteEntry);
      uploaded.push(remoteEntry);
    }
  }
  return uploaded;
}

/**
 * Download a file from OwnCloud to a local path.
 *
 * @param {string} serverUrl
 * @param {string} username
 * @param {string} password
 * @param {string} remotePath  Source path on OwnCloud
 * @param {string} localPath   Destination local file path
 */
async function downloadFile(serverUrl, username, password, remotePath, localPath) {
  const url = buildUrl(serverUrl, remotePath);
  const options = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname,
    method: 'GET',
    protocol: url.protocol,
    headers: {
      Authorization: basicAuth(username, password),
    },
  };

  return new Promise((resolve, reject) => {
    const transport = options.protocol === 'http:' ? http : https;
    const req = transport.request(options, (res) => {
      if (res.statusCode !== 200) {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          reject(
            new Error(
              `Download failed for ${remotePath}: HTTP ${res.statusCode}\n${Buffer.concat(chunks).toString()}`
            )
          )
        );
        return;
      }
      const dir = path.dirname(localPath);
      if (dir) fs.mkdirSync(dir, { recursive: true });
      const dest = fs.createWriteStream(localPath);
      res.pipe(dest);
      dest.on('finish', resolve);
      dest.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Parse a WebDAV PROPFIND XML response and extract file/directory entries.
 *
 * @param {string} xml
 * @returns {Array<{href: string, type: string, size: number|null, lastModified: string|null}>}
 */
function parsePropfind(xml) {
  const items = [];
  const responseRegex = /<[Dd]:response>([\s\S]*?)<\/[Dd]:response>/g;
  let responseMatch;
  while ((responseMatch = responseRegex.exec(xml)) !== null) {
    const block = responseMatch[1];

    const hrefMatch = /<[Dd]:href>(.*?)<\/[Dd]:href>/.exec(block);
    if (!hrefMatch) continue;
    const href = decodeURIComponent(hrefMatch[1]);

    const isCollection = /<[Dd]:collection\s*\/>/.test(block);
    const type = isCollection ? 'directory' : 'file';

    const sizeMatch = /<[Dd]:getcontentlength>(.*?)<\/[Dd]:getcontentlength>/.exec(block);
    const size = sizeMatch ? parseInt(sizeMatch[1], 10) : null;

    const modifiedMatch =
      /<[Dd]:getlastmodified>(.*?)<\/[Dd]:getlastmodified>/.exec(block);
    const lastModified = modifiedMatch ? modifiedMatch[1] : null;

    items.push({ href, type, size, lastModified });
  }
  return items;
}

/**
 * List files and directories at the given remote path.
 *
 * @param {string} serverUrl
 * @param {string} username
 * @param {string} password
 * @param {string} remotePath  Path on OwnCloud to list
 * @param {number} depth       WebDAV depth (0 = resource only, 1 = immediate children)
 * @returns {Promise<Array<{href: string, type: string, size: number|null, lastModified: string|null}>>}
 */
async function listFiles(serverUrl, username, password, remotePath, depth = 1) {
  const url = buildUrl(serverUrl, remotePath);
  const body = Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?>' +
      '<d:propfind xmlns:d="DAV:">' +
      '<d:prop>' +
      '<d:resourcetype/>' +
      '<d:getcontentlength/>' +
      '<d:getlastmodified/>' +
      '</d:prop>' +
      '</d:propfind>'
  );

  const options = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname,
    method: 'PROPFIND',
    protocol: url.protocol,
    headers: {
      Authorization: basicAuth(username, password),
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Length': body.length,
      Depth: String(depth),
    },
  };

  const res = await request(options, body);
  if (res.statusCode !== 207) {
    throw new Error(`List failed for ${remotePath}: HTTP ${res.statusCode}\n${res.body}`);
  }

  return parsePropfind(res.body);
}

module.exports = { uploadFile, uploadDirectory, downloadFile, listFiles, buildUrl };
