import * as core from '@actions/core';
import path from 'path';
import fs from 'fs';
import archiver from 'archiver';
import { uploadFile, uploadDirectory, downloadFile, listFiles } from './owncloud.js';

function zipPath(sourcePath: string, zipDest: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipDest);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve(zipDest));
    archive.on('error', reject);
    archive.pipe(output);

    const stat = fs.statSync(sourcePath);
    if (stat.isDirectory()) {
      archive.directory(sourcePath, false);
    } else {
      archive.file(sourcePath, { name: path.basename(sourcePath) });
    }
    archive.finalize();
  });
}

async function run(): Promise<void> {
  try {
    const action = core.getInput('action', { required: true }).toLowerCase().trim();
    const serverUrl = core.getInput('server_url', { required: true }).replace(/\/$/, '');
    const username = core.getInput('username', { required: true });
    const password = core.getInput('password', { required: true });
    const remotePath = core.getInput('remote_path', { required: true });
    const localPath = core.getInput('local_path');
    const zipName = core.getInput('zip_name');

    if (!['upload', 'download', 'list'].includes(action)) {
      throw new Error(`Invalid action "${action}". Must be one of: upload, download, list.`);
    }

    if (action === 'upload') {
      if (!localPath) throw new Error('local_path is required for the upload action.');

      const absLocal = path.resolve(localPath);

      if (zipName) {
        const zipDest = path.resolve(zipName);
        core.info(`Zipping "${absLocal}" into "${zipDest}" …`);
        await zipPath(absLocal, zipDest);
        const remoteZip = remotePath.endsWith('/')
          ? `${remotePath}${zipName}`
          : remotePath;
        core.info(`Uploading zip "${zipDest}" to "${remoteZip}" …`);
        await uploadFile(serverUrl, username, password, zipDest, remoteZip);
        core.info('Upload complete.');
        core.setOutput('files', JSON.stringify([remoteZip]));
      } else {
        const stat = fs.statSync(absLocal);

        if (stat.isDirectory()) {
          core.info(`Uploading directory "${absLocal}" to "${remotePath}" …`);
          const uploaded = await uploadDirectory(serverUrl, username, password, absLocal, remotePath);
          core.info(`Uploaded ${uploaded.length} file(s).`);
          core.setOutput('files', JSON.stringify(uploaded));
        } else {
          core.info(`Uploading file "${absLocal}" to "${remotePath}" …`);
          await uploadFile(serverUrl, username, password, absLocal, remotePath);
          core.info('Upload complete.');
          core.setOutput('files', JSON.stringify([remotePath]));
        }
      }
    } else if (action === 'download') {
      if (!localPath) throw new Error('local_path is required for the download action.');

      const absLocal = path.resolve(localPath);
      core.info(`Downloading "${remotePath}" to "${absLocal}" …`);
      await downloadFile(serverUrl, username, password, remotePath, absLocal);
      core.info('Download complete.');
    } else if (action === 'list') {
      core.info(`Listing contents of "${remotePath}" …`);
      const items = await listFiles(serverUrl, username, password, remotePath);
      const entries = items.filter((item) => {
        const normalized = item.href.replace(/\/$/, '');
        const suffix = `/remote.php/webdav${remotePath.replace(/\/$/, '')}`;
        return !normalized.endsWith(suffix);
      });
      core.info(`Found ${entries.length} item(s):`);
      for (const entry of entries) {
        const sizeInfo = entry.size !== null ? ` (${entry.size} bytes)` : '';
        core.info(`  [${entry.type}] ${entry.href}${sizeInfo}`);
      }
      core.setOutput('files', JSON.stringify(entries));
    }
  } catch (error) {
    core.setFailed((error as Error).message);
  }
}

run();
