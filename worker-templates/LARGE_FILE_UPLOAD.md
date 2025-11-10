# Large File Upload Support (up to 2GB)

This document describes the implementation of chunked file uploads for handling large files up to 2GB in TeleDrive.

## Overview

The system supports uploading files up to 2GB using a hybrid approach:
- **Files ≤ 50MB**: Direct upload via Telegram Bot API (fast & simple)
- **Files > 50MB**: Chunked upload + Telegram Client API via Telethon (supports up to 2GB)

Files larger than 10MB are automatically split into 5MB chunks on the client side, uploaded sequentially, and reassembled on the server before being sent to Telegram.

## Features

✅ **Chunked Upload**: Files split into 50MB chunks (safe under 100MB request limits)
✅ **Progress Tracking**: Real-time progress indicators with speed and ETA
✅ **Upload Queue**: Google Drive-style queue showing all active uploads
✅ **Pause/Resume**: Ability to pause and resume uploads
✅ **Auto-Resume**: Uploads resume automatically from last completed chunk if interrupted
✅ **Multiple Files**: Queue multiple files simultaneously
✅ **Error Handling**: Automatic retry with exponential backoff

## Architecture

### Client Side (Frontend)

**Components:**
- `UploadQueue.jsx`: Visual queue component showing upload progress
- `chunkedUpload.js`: Core chunking logic and upload management
- `Dashboard.jsx`: Integrated upload functionality

**Flow:**
1. User selects file(s)
2. Files added to upload queue
3. Files >10MB use chunked upload, smaller files use direct upload
4. Progress tracked and displayed in queue
5. Chunks uploaded sequentially with retry logic
6. On completion, server assembles and uploads to Telegram

### Server Side (Workers)

**Supported Workers:**

#### 1. Render Service (Python/Flask) - **RECOMMENDED for 2GB support**
- **File**: `worker-templates/render-service-chunked.py`
- **Request Limit**: 10MB (Render free tier)
- **Chunk Size**: 5MB (optimized for free tier)
- **Upload Method**: 
  - Files ≤ 50MB: Telegram Bot API (direct)
  - Files > 50MB: **Telegram Client API via Telethon** (up to 2GB)
- **Status**: ✅ Fully Supported

**Endpoints:**
- `POST /init-upload`: Initialize chunked upload session
- `POST /upload-chunk`: Receive individual chunk
- `POST /complete-upload`: Assemble chunks and upload to Telegram (auto-selects Bot API or Client API)
- `GET /upload-status/<upload_id>`: Query upload progress
- `POST /cancel-upload`: Cancel upload and cleanup
- `POST /upload`: Legacy endpoint for small files

**Dependencies:**
- Flask, requests, gunicorn (standard)
- **telethon**: Telegram Client API library
- **cryptg**: Encryption library for faster Telethon operations
- `POST /upload`: Legacy endpoint for small files

#### 2. Cloudflare Worker
- **File**: `worker-templates/cloudflare-worker-chunked.js`
- **Request Limit**: 100MB
- **Chunk Size**: 50MB
- **Status**: ✅ Fully Supported

**Note**: Uses in-memory storage for chunks. For production with multiple worker instances, consider using Cloudflare Durable Objects or R2.

#### 3. Vercel Serverless
- **Request Limit**: 4.5MB (Hobby tier)
- **Status**: ❌ Not Suitable for Large Files
- **Recommendation**: Use Render or Cloudflare for large file uploads

## Setup Instructions

### For Render

1. **Deploy New Worker:**
   ```bash
   # Use the new chunked upload version
   cp worker-templates/render-service-chunked.py your-render-service/
   cp worker-templates/requirements.txt your-render-service/
   ```

2. **Install Dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Environment Variables:**
   ```
   BACKEND_URL=https://your-backend-url.com
   PORT=10000
   ```

4. **Deploy:**
   - Push to your Render Git repository
   - Render will automatically deploy

### For Cloudflare Workers

1. **Install Wrangler CLI:**
   ```bash
   npm install -g wrangler
   ```

2. **Create Worker:**
   ```bash
   wrangler init tgdrive-worker
   cd tgdrive-worker
   ```

3. **Copy Worker Code:**
   ```bash
   cp ../worker-templates/cloudflare-worker-chunked.js src/index.js
   ```

4. **Configure wrangler.toml:**
   ```toml
   name = "tgdrive-worker"
   main = "src/index.js"
   compatibility_date = "2024-01-01"
   
   [vars]
   BACKEND_URL = "https://your-backend-url.com"
   ```

5. **Deploy:**
   ```bash
   wrangler publish
   ```

## Client Usage

### Automatic Detection

The system automatically detects file size and chooses the appropriate upload method:

```javascript
import { shouldUseChunkedUpload, ChunkedUploader } from './utils/chunkedUpload';

if (shouldUseChunkedUpload(file.size)) {
  // Uses chunked upload (files >10MB)
  const uploader = new ChunkedUploader(file, workerUrl, authToken, {
    onProgress: (progress) => console.log(progress),
    onComplete: (result) => console.log('Done!', result),
    onError: (error) => console.error(error),
  });
  await uploader.start();
} else {
  // Uses direct upload (files <10MB)
  // ... standard upload code
}
```

### Manual Control

```javascript
const uploader = new ChunkedUploader(file, workerUrl, authToken);

// Start upload
await uploader.start();

// Pause
uploader.pause();

// Resume
uploader.resume();

// Cancel
await uploader.cancel();

// Get status from server
const status = await uploader.getStatus();
```

## Upload Queue UI

The upload queue appears in the bottom-right corner of the Dashboard:

**Features:**
- Individual progress bars for each file
- Upload speed (MB/s)
- Estimated time remaining (ETA)
- Pause/Resume/Cancel buttons
- Clear completed uploads
- Auto-hides when empty

## Technical Details

### Chunk Management

**Chunk Size**: 50MB
- Safe under 100MB request limits (with headers/overhead)
- Balances between too many requests and memory usage

**Storage**:
- **Render**: Temporary files in `/tmp/tgdrive_chunks`
- **Cloudflare**: In-memory (per worker instance)

**Cleanup**:
- Chunks automatically deleted after successful upload
- Cleanup on cancel
- Temporary files cleaned up on error

### Progress Tracking

**Calculated Metrics:**
- **Progress**: `(uploadedChunks / totalChunks) * 100`
- **Speed**: `bytesUploaded / timeElapsed` (bytes/second)
- **ETA**: `remainingBytes / currentSpeed` (seconds)

**LocalStorage**:
- Upload progress saved to localStorage
- Enables resume after page refresh
- Cleared on successful completion

### Error Handling

**Retry Logic:**
- Each chunk retried up to 3 times
- 2-second delay between retries
- Exponential backoff for network errors

**Error States:**
- Network failures: Auto-retry
- Server errors: Show error message, allow manual retry
- Timeout: Configurable timeout (10 minutes default for completion)

## Performance Considerations

### Memory Usage

**Client Side:**
- File sliced into chunks (does not load entire file)
- One chunk in memory at a time
- ~50MB peak memory per upload

**Server Side (Render):**
- Chunks written to disk immediately
- Final file assembled from disk chunks
- Streaming upload to Telegram
- ~50-100MB peak memory

**Server Side (Cloudflare):**
- Chunks stored in memory
- Limited by worker memory (128MB default)
- Consider Durable Objects for large scale

### Network Optimization

- **Sequential Upload**: One chunk at a time prevents overwhelming connection
- **Resume Support**: Avoid re-uploading completed chunks
- **Progress Tracking**: Minimal overhead, updated per chunk

### Recommendations

**For Best Performance:**
1. Use Render for production (better for large files)
2. Enable HTTP/2 or HTTP/3 if available
3. Upload during off-peak hours for very large files
4. Ensure stable network connection for multi-GB uploads

## Limits & Constraints

| Platform | Request Size | Max File | Execution Time | Best For |
|----------|-------------|----------|----------------|----------|
| **Render (Free)** | 100MB | 2GB | 10 minutes | ✅ Large files |
| **Cloudflare (Free)** | 100MB | 2GB | 30 seconds | ⚠️ Large files (with Durable Objects) |
| **Vercel (Free)** | 4.5MB | 4.5MB | 10 seconds | ❌ Large files |
| **Telegram** | - | 2GB | - | Storage backend |

## Troubleshooting

### Upload Fails Immediately

**Check:**
- Worker URL configured in Settings
- Worker is running and accessible
- BACKEND_URL environment variable set correctly

### Chunks Upload But Complete Fails

**Check:**
- Telegram bot token valid
- Bot has admin permissions in channel
- Telegram API rate limits not exceeded

### Progress Stuck

**Check:**
- Network connection stable
- Browser console for errors
- Worker logs for server-side errors

**Fix:**
- Pause and resume upload
- Cancel and restart
- Check worker status/logs

### Memory Issues

**Render:**
- Increase worker memory allocation
- Ensure /tmp has sufficient space

**Cloudflare:**
- Reduce chunk size (requires frontend change)
- Use Durable Objects or R2 for persistence
- Upgrade to paid plan for more memory

## Migration Guide

### From Old Worker to New Chunked Worker

**Backward Compatible:**
- Old `/upload` endpoint still supported
- Small files (<10MB) automatically use legacy endpoint
- No frontend changes required for existing small file uploads

**Steps:**
1. Deploy new worker code
2. No changes needed - both methods work
3. Large files automatically use new chunked system

## API Reference

### POST /upload-chunk

Upload a single chunk.

**Request:**
```
FormData:
  - chunk: File (binary data)
  - uploadId: string
  - chunkIndex: number
  - totalChunks: number
  - fileName: string
  - fileSize: number
  - authToken: string
  - userId: string (optional)
```

**Response:**
```json
{
  "success": true,
  "chunk_index": 5,
  "received_chunks": 6,
  "total_chunks": 10,
  "complete": false
}
```

### POST /complete-upload

Assemble chunks and upload to Telegram.

**Request:**
```json
{
  "uploadId": "1234567890_abc123"
}
```

**Response:**
```json
{
  "success": true,
  "messageId": 12345,
  "fileId": "BQACAgIAAxkBAAIC...",
  "fileName": "large-video.mp4"
}
```

### GET /upload-status/:uploadId

Query upload session status.

**Response:**
```json
{
  "upload_id": "1234567890_abc123",
  "file_name": "large-video.mp4",
  "total_chunks": 10,
  "received_chunks": 6,
  "received_chunk_indices": [0, 1, 2, 3, 4, 5],
  "complete": false
}
```

### POST /cancel-upload

Cancel upload and cleanup.

**Request:**
```json
{
  "uploadId": "1234567890_abc123"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Upload cancelled"
}
```

## Security Considerations

1. **Authentication**: All requests require valid authToken
2. **File Size Limits**: Enforced on both client and server
3. **Cleanup**: Temporary files/chunks automatically deleted
4. **Rate Limiting**: Consider implementing per-user upload limits
5. **Timeout**: Long-running uploads have timeout protection

## Future Improvements

- [ ] Parallel chunk upload (multiple chunks simultaneously)
- [ ] Better chunk storage (S3, R2, etc.)
- [ ] Upload scheduling (queue large uploads)
- [ ] Bandwidth throttling options
- [ ] Compression before upload
- [ ] Multi-part upload to Telegram (if API supports)

## Support

For issues or questions:
1. Check worker logs
2. Enable browser DevTools Network tab
3. Check backend logs for credential fetch issues
4. Verify Telegram bot permissions

---

**Last Updated**: November 2024
**Version**: 2.0.0
