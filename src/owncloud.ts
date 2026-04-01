import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';

export interface PropfindEntry {
  href: string;
  type: 'file' | 'directory';
  size: number | null;
  lastModified: string | null;
}

interface HttpResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

interface RequestOptions {
  hostname: string;
  port: number;
  path: string;
  method: string;
  protocol: string;
  headers: Record<string, string | number>;
}

function buildUrl(serverUrl: string, remotePath: string): URL {
  const base = serverUrl.replace(/\/$/, '');
  const normalized = remotePath.startsWith('/') ? remotePath : `/${remotePath}`;
  return new URL(`${base}/remote.php/webdav${normalized}`);
}

function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

function request(options: RequestOptions, body: Buffer | null = null): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const transport = options.protocol === 'http:' ? http : https;
    const req = transport.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () =>
        resolve({
          statusCode: res.statusCode!,
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

async function ensureDirectories(
  serverUrl: string,
  username: string,
  password: string,
  remotePath: string
): Promise<void> {
  const dir = path.posix.dirname(remotePath);
  if (dir === '/' || dir === '.') return;

  const parts = dir.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current += `/${part}`;
    const url = buildUrl(serverUrl, current);
    const options: RequestOptions = {
      hostname: url.hostname,
      port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'MKCOL',
      protocol: url.protocol,
      headers: {
        Authorization: basicAuth(username, password),
      },
    };
    const res = await request(options);
    if (res.statusCode !== 201 && res.statusCode !== 405) {
      throw new Error(
        `Failed to create directory ${current}: HTTP ${res.statusCode}\n${res.body}`
      );
    }
  }
}

async function uploadFile(
  serverUrl: string,
  username: string,
  password: string,
  localPath: string,
  remotePath: string
): Promise<void> {
  await ensureDirectories(serverUrl, username, password, remotePath);

  const fileContent = fs.readFileSync(localPath);
  const url = buildUrl(serverUrl, remotePath);
  const options: RequestOptions = {
    hostname: url.hostname,
    port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
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

async function uploadDirectory(
  serverUrl: string,
  username: string,
  password: string,
  localDir: string,
  remoteDir: string
): Promise<string[]> {
  const uploaded: string[] = [];
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

async function downloadFile(
  serverUrl: string,
  username: string,
  password: string,
  remotePath: string,
  localPath: string
): Promise<void> {
  const url = buildUrl(serverUrl, remotePath);
  const options: RequestOptions = {
    hostname: url.hostname,
    port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
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
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
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

function parsePropfind(xml: string): PropfindEntry[] {
  const items: PropfindEntry[] = [];
  const responseRegex = /<[Dd]:response>([\s\S]*?)<\/[Dd]:response>/g;
  let responseMatch;
  while ((responseMatch = responseRegex.exec(xml)) !== null) {
    const block = responseMatch[1];

    const hrefMatch = /<[Dd]:href>(.*?)<\/[Dd]:href>/.exec(block);
    if (!hrefMatch) continue;
    const href = decodeURIComponent(hrefMatch[1]);

    const isCollection = /<[Dd]:collection\s*\/>/.test(block);
    const type: 'file' | 'directory' = isCollection ? 'directory' : 'file';

    const sizeMatch = /<[Dd]:getcontentlength>(.*?)<\/[Dd]:getcontentlength>/.exec(block);
    const size = sizeMatch ? parseInt(sizeMatch[1], 10) : null;

    const modifiedMatch =
      /<[Dd]:getlastmodified>(.*?)<\/[Dd]:getlastmodified>/.exec(block);
    const lastModified = modifiedMatch ? modifiedMatch[1] : null;

    items.push({ href, type, size, lastModified });
  }
  return items;
}

async function listFiles(
  serverUrl: string,
  username: string,
  password: string,
  remotePath: string,
  depth: number = 1
): Promise<PropfindEntry[]> {
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

  const options: RequestOptions = {
    hostname: url.hostname,
    port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
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

export { uploadFile, uploadDirectory, downloadFile, listFiles, buildUrl, parsePropfind };
