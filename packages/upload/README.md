# @vobs/upload

File uploads for vobs: FormData encoding over any HTTPClient, concurrency control, reactive progress, and per-task cancel and retry.

## Install

```bash
npm install @vobs/upload
```

## Quick start

```ts
import { createHTTPClient } from '@vobs/http'
import { createUpload } from '@vobs/upload'

const upload = createUpload({
  http: createHTTPClient(),
  url: '/upload',
  fieldName: 'document',
  accept: ['image/*', '.pdf'],
  maxFileSize: 10 * 1024 * 1024,
  concurrency: 3
})

const task = upload.upload(file, { metadata: { tenant: 'acme' } })

task.progress.value // 0-100 while uploading
await task.promise  // mapped response, or null when cancelled or failed
task.error.value    // UploadError when status is 'error'
```

Files are validated against `accept` (MIME or extension patterns) and `maxFileSize` before a task is created; invalid files throw `UploadError` and never enter the queue. At most `concurrency` tasks upload at once; the rest wait in line. `task.cancel()` aborts the underlying HTTP request through its signal. Failed tasks can be re-run with `task.retry()`, which inherits the task's retry options.

## API

| Signature | Description |
| --- | --- |
| `createUpload(options): UploadContext` | Requires `http` and `url`; options: `method`, `fieldName`, `metadata`, `accept`, `maxFileSize`, `concurrency`, `headers`, `timeout`, `retry`, `response`. |
| `upload.upload(file, options?): UploadTask` | Create one task; per-task options override metadata, headers, retry settings, and response mapping. |
| `upload.uploadAll(files, options?): UploadTask[]` | Queue a batch through the same concurrency limit. |
| `upload.tasks` | Signal listing every task in creation order. |
| `upload.clearCompleted() / dispose()` | Drop finished tasks; cancel and release everything. |
| `task.progress / status / error / result` | Signals for percent, status (`pending` to `cancelled`), error, and mapped response. |
| `task.promise` | Resolves with the mapped result, or null on cancel and failure. |
| `task.cancel() / task.retry()` | Abort the in-flight request; re-run a failed task. |
| `uploadPlugin(options?) / useUpload()` | Provide and inject `UPLOAD_KEY`; injects `HTTP_KEY` unless `http` is passed. |
| `UploadError` | Error with `code`: `INVALID_FILE`, `FILE_TYPE_UNSUPPORTED`, `FILE_TOO_LARGE`, `UPLOAD_FAILED`, `UPLOAD_CONTEXT_DISPOSED`. |

## Types

UploadStatus, UploadFile, UploadMetadata, UploadTask, UploadTaskOptions, UploadOptions, UploadContext, UploadPluginOptions, UploadErrorCode
