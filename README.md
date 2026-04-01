# owncloud-manager-action

A Node.js 20 GitHub Action to **upload**, **download**, and **list** files on an [OwnCloud](https://owncloud.com/) server via WebDAV.

## Inputs

| Name          | Required | Description |
|---------------|----------|-------------|
| `action`      | ✅        | Action to perform: `upload`, `download`, or `list` |
| `server_url`  | ✅        | OwnCloud server base URL (e.g. `https://cloud.example.com`) |
| `username`    | ✅        | OwnCloud username |
| `password`    | ✅        | OwnCloud password or app token (use a secret) |
| `remote_path` | ✅        | Path on OwnCloud (destination for upload, source for download, directory for list) |
| `local_path`  | ✗        | Local file or directory path (required for `upload` and `download`) |

## Outputs

| Name    | Description |
|---------|-------------|
| `files` | JSON array. For `upload`: remote paths of uploaded files. For `list`: objects with `href`, `type`, `size`, and `lastModified`. |

## Usage

### Upload a file

```yaml
- uses: Fork-on-the-Table-Collective/owncloud-manager-action@v1
  with:
    action: upload
    server_url: https://cloud.example.com
    username: ${{ secrets.OC_USER }}
    password: ${{ secrets.OC_PASS }}
    remote_path: /backups/artifact.zip
    local_path: ./build/artifact.zip
```

### Upload a directory

```yaml
- uses: Fork-on-the-Table-Collective/owncloud-manager-action@v1
  with:
    action: upload
    server_url: https://cloud.example.com
    username: ${{ secrets.OC_USER }}
    password: ${{ secrets.OC_PASS }}
    remote_path: /builds/2024-01-01
    local_path: ./dist
```

### Download a file

```yaml
- uses: Fork-on-the-Table-Collective/owncloud-manager-action@v1
  with:
    action: download
    server_url: https://cloud.example.com
    username: ${{ secrets.OC_USER }}
    password: ${{ secrets.OC_PASS }}
    remote_path: /configs/settings.json
    local_path: ./settings.json
```

### List files

```yaml
- id: list
  uses: Fork-on-the-Table-Collective/owncloud-manager-action@v1
  with:
    action: list
    server_url: https://cloud.example.com
    username: ${{ secrets.OC_USER }}
    password: ${{ secrets.OC_PASS }}
    remote_path: /backups

- name: Print file list
  run: echo '${{ steps.list.outputs.files }}'
```

## Development

```bash
npm install          # install dependencies
npm run build        # bundle dist/index.js with esbuild
npm test             # run unit tests
```

## License

ISC
