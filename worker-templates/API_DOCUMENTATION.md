# TeleStore Worker API Documentation

## Overview

The worker handles file uploads to Telegram with support for files up to 2GB using a chunked upload + background processing architecture.

## Upload Flow

### For Small Files (< 10MB)
```
Client → POST /upload → Worker → Telegram Bot API → Response
```

### For Large Files (> 10MB)
```
1. Client splits file into 5MB chunks
2. Client → POST /init-upload → Worker (initialize session)
3. Client → POST /upload-chunk (repeat for each chunk)
4. Client → POST /complete-upload → Worker (merge + start background upload)
5. Worker returns immediately with uploadId
6. Client → GET /upload-progress/{uploadId} (poll for status)
7. Background thread uploads to Telegram
8. Client receives final messageId and fileId when complete
```

## API Endpoints

### 1. Health Check

**GET /**

Check if worker is running.

**Response:**
```json
{
  "status": "ok",
  "service": "TeleStore Render Upload Service",
  "chunk_size": "5MB",
  "endpoints": [...]
}
```

---

### 2. Initialize Chunked Upload

**POST /init-upload**

Initialize a new chunked upload session.

**Request Body:**
```json
{
  "uploadId": "unique-upload-id",
  "fileName": "video.mp4",
  "totalChunks": 20,
  "fileSize": 104857600
}
```

**Response:**
```json
{
  "success": true,
  "uploadId": "unique-upload-id",
  "message": "Upload session initialized"
}
```

---

### 3. Upload Chunk

**POST /upload-chunk**

Upload individual file chunk.

**Request (multipart/form-data):**
- `chunk` (file): The chunk file data
- `uploadId` (string): Upload session ID
- `chunkIndex` (integer): Index of this chunk (0-based)
- `totalChunks` (integer): Total number of chunks
- `fileName` (string): Original file name
- `fileSize` (integer): Original file size
- `userId` (string): User ID
- `authToken` (string): Authentication token

**Response:**
```json
{
  "success": true,
  "chunk_index": 5,
  "received_chunks": 6,
  "total_chunks": 20,
  "complete": false
}
```

---

### 4. Complete Upload

**POST /complete-upload**

Merge all chunks and start background upload to Telegram.

**⚠️ IMPORTANT**: This endpoint returns immediately. The actual upload happens in the background. Use `/upload-progress/{uploadId}` to check status.

**Request Body:**
```json
{
  "uploadId": "unique-upload-id"
}
```

**Response (Immediate):**
```json
{
  "success": true,
  "uploadId": "unique-upload-id",
  "message": "Upload started in background",
  "checkProgressAt": "/upload-progress/unique-upload-id"
}
```

**What Happens After Response:**
1. Worker merges all chunks into final file
2. Worker cleans up individual chunk files
3. Background thread starts Telegram upload
4. Progress tracked in memory
5. File cleaned up after successful upload

---

### 5. Check Upload Progress

**GET /upload-progress/{uploadId}**

Poll this endpoint to check background upload progress.

**Response (Uploading):**
```json
{
  "uploadId": "unique-upload-id",
  "status": "uploading",
  "progress": 45,
  "error": null,
  "messageId": null,
  "fileId": null
}
```

**Response (Completed):**
```json
{
  "uploadId": "unique-upload-id",
  "status": "completed",
  "progress": 100,
  "error": null,
  "messageId": 12345,
  "fileId": "file_abc123"
}
```

**Response (Failed):**
```json
{
  "uploadId": "unique-upload-id",
  "status": "failed",
  "progress": 30,
  "error": "Telegram session not authorized",
  "messageId": null,
  "fileId": null
}
```

**Status Values:**
- `uploading`: Upload in progress
- `completed`: Upload successful
- `failed`: Upload failed (see error field)

**Progress Values:**
- `0-100`: Percentage complete
- `0-30`: Initializing and connecting to Telegram
- `30-90`: Uploading file to Telegram
- `90-100`: Finalizing and cleanup

---

### 6. Check Chunk Upload Status

**GET /upload-status/{uploadId}**

Check status of chunk upload (before merging).

**Response:**
```json
{
  "upload_id": "unique-upload-id",
  "file_name": "video.mp4",
  "total_chunks": 20,
  "received_chunks": 15,
  "received_chunk_indices": [0, 1, 2, ..., 14],
  "complete": false
}
```

---

### 7. Cancel Upload

**POST /cancel-upload**

Cancel an upload and clean up chunks.

**Request Body:**
```json
{
  "uploadId": "unique-upload-id"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Upload cancelled"
}
```

---

### 8. Legacy Upload (Small Files)

**POST /upload**

Direct upload for small files (< 50MB). No chunking needed.

**Request (multipart/form-data):**
- `file` (file): The file to upload
- `userId` (string): User ID
- `authToken` (string): Authentication token
- `fileName` (string, optional): Custom file name

**Response:**
```json
{
  "success": true,
  "messageId": 12345,
  "fileId": "file_abc123",
  "fileName": "document.pdf"
}
```

---

## Client Implementation Example

### Polling for Upload Progress

```javascript
async function pollUploadProgress(uploadId) {
  const maxAttempts = 600; // 10 minutes with 1s interval
  let attempts = 0;
  
  while (attempts < maxAttempts) {
    const response = await fetch(`${workerUrl}/upload-progress/${uploadId}`);
    const data = await response.json();
    
    console.log(`Upload progress: ${data.progress}%`);
    
    if (data.status === 'completed') {
      console.log('Upload complete!');
      return {
        messageId: data.messageId,
        fileId: data.fileId
      };
    }
    
    if (data.status === 'failed') {
      throw new Error(data.error);
    }
    
    // Wait 1 second before next poll
    await new Promise(resolve => setTimeout(resolve, 1000));
    attempts++;
  }
  
  throw new Error('Upload timeout');
}

// Usage after /complete-upload
const completeResponse = await fetch(`${workerUrl}/complete-upload`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ uploadId })
});

const { uploadId } = await completeResponse.json();
const result = await pollUploadProgress(uploadId);
console.log('File uploaded:', result);
```

---

## Background Upload Architecture

### Why Background Threads?

**Problem:** 
- Large file uploads (>50MB) via Telethon take 30+ seconds
- Gunicorn worker timeout would kill the request
- Client connection would fail

**Solution:**
- `/complete-upload` returns immediately (< 1 second)
- Actual upload runs in background thread
- Thread continues even after HTTP response sent
- Client polls for progress

### Thread Safety

- Each upload gets unique `uploadId`
- Progress stored in thread-safe dict
- File cleanup after completion
- No shared state between uploads

### Memory Management

- Chunks merged to single file before background upload
- Individual chunks deleted after merge
- Final merged file deleted after upload
- Progress data cleaned up after 1 hour (TODO)

---

## File Size Limits

| API | Max File Size | Speed | Use Case |
|-----|---------------|-------|----------|
| Bot API | 50MB | Fast | Small files, documents |
| Client API (Telethon) | 2GB | Slower | Large files, videos |

**Automatic Selection:**
- Worker automatically chooses the right API based on file size
- No client-side logic needed
- Seamless switching

---

## Error Handling

### Common Errors

**Upload Not Found (404)**
```json
{
  "error": "Upload session not found"
}
```
- Cause: Invalid uploadId or session expired
- Solution: Restart upload from beginning

**Missing Chunks (400)**
```json
{
  "error": "Not all chunks received",
  "received": 15,
  "total": 20
}
```
- Cause: Some chunks failed to upload
- Solution: Re-upload missing chunks

**Telegram Authentication (500)**
```json
{
  "status": "failed",
  "error": "Telegram session not authorized"
}
```
- Cause: User not logged into Telegram in TeleStore
- Solution: User must login via TeleStore settings

**Channel Resolution (500)**
```json
{
  "status": "failed",
  "error": "Could not resolve channel ID"
}
```
- Cause: Invalid channel ID or bot not added to channel
- Solution: Check channel setup in TeleStore

---

## Performance Tips

### Optimal Chunk Size

- **5MB**: Recommended for Render free tier (10MB request limit)
- **10MB**: Better for paid tiers (faster uploads)
- **50MB**: Maximum for Bot API

### Polling Frequency

- **Recommended**: 1 second intervals
- **Minimum**: 500ms (don't overload worker)
- **Maximum**: 5 seconds (slow feedback)

### Concurrent Uploads

- **Free tier**: 1-2 concurrent uploads
- **Paid tier**: 4-8 concurrent uploads
- Worker uses threading for parallelism

---

## Backend Webhook

After successful upload, worker notifies TeleStore backend:

**POST {BACKEND_URL}/api/webhook/upload**

```json
{
  "userId": "user123",
  "fileName": "video.mp4",
  "messageId": 12345,
  "fileId": "file_abc123",
  "size": 104857600,
  "mimeType": "application/octet-stream"
}
```

This updates the user's file list in TeleStore UI.

---

## Security

### Authentication

- Every request requires valid `authToken`
- Worker validates token with backend
- Credentials cached for 1 hour
- No hardcoded secrets

### CORS

- Enabled for all origins (development)
- Configure for production: `origins: ['https://your-app.com']`

### File Storage

- Temporary files stored in `/tmp`
- Deleted after upload
- No persistent storage on worker

---

## Monitoring

### Key Metrics to Track

1. **Upload Success Rate**: % of uploads that complete
2. **Average Upload Time**: Time from chunk #1 to Telegram complete
3. **Error Rate**: % of failed uploads
4. **Worker Memory**: RAM usage during uploads
5. **Active Threads**: Number of concurrent background uploads

### Logs to Monitor

```
[uploadId] Background upload started
[uploadId] Using Bot API / Telethon Client API
[uploadId] Upload progress: X%
[uploadId] Upload completed successfully
[uploadId] Upload failed: error message
```

---

## Troubleshooting

### Upload Stuck at X%

- Check Render logs for errors
- Verify network connectivity
- Check Telegram API status
- Increase timeout if needed

### Memory Errors

- Reduce concurrent uploads
- Upgrade Render plan
- Optimize chunk size

### Slow Uploads

- Telethon is slower than Bot API (normal)
- Upgrade Render plan for better bandwidth
- Consider different hosting closer to Telegram servers

---

## Future Improvements

- [ ] Resume failed uploads from last chunk
- [ ] Automatic retry with exponential backoff
- [ ] Progress data persistence (Redis/DB)
- [ ] Webhook for upload completion (push instead of poll)
- [ ] WebSocket for real-time progress
- [ ] Multi-part parallel upload (faster)
- [ ] Compression before upload
- [ ] Progress data cleanup (remove old entries)
