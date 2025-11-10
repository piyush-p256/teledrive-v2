# TeleStore Worker Templates

These templates allow you to deploy your own file upload worker to handle uploads directly to Telegram.

## 🎉 Automatic Credential Management

**NEW**: Workers now automatically fetch credentials from your TeleStore backend! No need to manually configure bot tokens, channel IDs, or session strings in worker environment variables.

### How It Works
1. **User logs into Telegram** in TeleStore (QR code or phone)
2. **Creates bot via @BotFather** and adds token in TeleStore settings
3. **Worker fetches credentials** automatically using user's auth token
4. **Credentials are cached** at the worker for 1 hour (reduces backend calls)
5. **Auto-refresh** when cache expires or on worker restart

### Benefits
- ✅ No manual credential configuration in workers
- ✅ Credentials stay secure in your backend database
- ✅ Automatic updates when you change bot/channel
- ✅ Efficient caching reduces API calls
- ✅ Works across multiple workers seamlessly

---

## Quick Setup Instructions

### 1. Get Telegram API Credentials (One-time, Backend Only)
1. Visit https://my.telegram.org
2. Log in with your phone number
3. Go to "API development tools"
4. Create an app and save your `api_id` and `api_hash`
5. Add these to TeleStore backend `.env` file

### 2. Login to Telegram in TeleStore
1. Go to TeleStore Settings
2. Click "Connect Telegram"
3. Scan QR code or enter phone number
4. Your private channel will be created automatically

### 3. Create and Add Telegram Bot
1. Open Telegram and search for [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow instructions
3. Copy your bot token
4. In TeleStore Settings, add the bot token
5. Bot will be automatically added as admin to your channel

### 4. Deploy Worker (see platform-specific instructions below)
- Only need to set `BACKEND_URL` environment variable
- No need to set bot tokens or channel IDs!

---

## Cloudflare Worker Deployment

### Prerequisites
- Cloudflare account
- Wrangler CLI installed (`npm install -g wrangler`)

### Steps
1. Create a new Cloudflare Worker
```bash
wrangler init telestore-worker
```

2. Copy `cloudflare-worker.js` content to `src/index.js`

3. Update BACKEND_URL in the code:
```javascript
const CONFIG = {
  BACKEND_URL: 'https://your-telestore-backend.com', // Your TeleStore backend
  MAX_FILE_SIZE: 2000 * 1024 * 1024,
  CACHE_DURATION: 3600000, // 1 hour
};
```

4. Deploy:
```bash
wrangler deploy
```

5. Copy the worker URL and use it in your TeleStore app for file uploads

**Note**: Credentials are fetched automatically from backend. No environment variables needed!

---

## Vercel Serverless Deployment

### Prerequisites
- Vercel account
- Vercel CLI installed (`npm install -g vercel`)

### Steps
1. Create a new project folder:
```bash
mkdir telestore-worker && cd telestore-worker
npm init -y
npm install form-data node-fetch
```

2. Create `api/upload.js` and copy `vercel-serverless.js` content

3. Create `vercel.json`:
```json
{
  "version": 2,
  "builds": [
    { "src": "api/**/*.js", "use": "@vercel/node" }
  ]
}
```

4. Set environment variable in Vercel dashboard:
   - `BACKEND_URL` - Your TeleStore backend URL

5. Deploy:
```bash
vercel
```

6. Copy the deployment URL + `/api/upload` and use it in your TeleStore app

**Note**: Only `BACKEND_URL` is required. Bot token and channel ID are fetched automatically!

---

## Render Deployment

### Prerequisites
- Render account

### Steps
1. Create a new project folder:
```bash
mkdir telestore-worker && cd telestore-worker
```

2. Copy `render-service-chunked.py` to the folder (recommended for large files up to 2GB)
   - Use `render-service.py` for basic setup (files up to 50MB)

3. Create `requirements.txt`:
```
fastapi==0.115.0
uvicorn[standard]==0.30.0
requests==2.32.5
gunicorn==21.2.0
telethon==1.34.0
cryptg==0.4.0
python-multipart==0.0.9
```

**Note**: 
- `fastapi`: High-performance async framework for file streaming
- `uvicorn`: ASGI server for FastAPI
- `telethon` and `cryptg`: Required for uploading/downloading large files (>50MB) via Telegram Client API
- `python-multipart`: Required for file upload handling

4. Copy `gunicorn_config.py` to your project folder (for large file upload support)

5. Create `render.yaml`:
```yaml
services:
  - type: web
    name: telestore-worker
    env: python
    buildCommand: pip install -r requirements.txt
    startCommand: gunicorn -c gunicorn_config.py render-service-chunked:app
    envVars:
      - key: BACKEND_URL
        sync: false
```

**Note**: The `gunicorn_config.py` uses Uvicorn workers for async support, allowing efficient streaming of large files without worker timeouts

5. Push to GitHub and connect to Render

6. Set `BACKEND_URL` environment variable in Render dashboard

7. Deploy and copy the service URL + `/upload`

**Note**: Only `BACKEND_URL` is required. Bot token and channel ID are fetched automatically!

---

## 🚀 Large File Upload Support (up to 2GB)

The `render-service-chunked.py` template supports uploading files up to **2GB** using a hybrid approach:

### How It Works
- **Files ≤ 50MB**: Uses Telegram Bot API (faster, simpler)
- **Files > 50MB**: Automatically switches to Telegram Client API via Telethon (supports up to 2GB)

### Why Two APIs?
- **Bot API**: Limited to 50MB but very fast and simple
- **Client API**: Supports up to 2GB but requires user session authentication

### Setup Requirements for Large Files
1. User must have logged into Telegram in TeleStore (creates session)
2. User must have Telegram API credentials (api_id, api_hash) configured in backend
3. Worker must have `telethon` library installed (included in requirements.txt)

### Chunked Upload Flow
1. Frontend splits large file into 5MB chunks
2. Chunks uploaded to worker incrementally
3. Worker merges chunks into final file
4. Worker checks file size:
   - If ≤ 50MB → Bot API upload
   - If > 50MB → Telethon Client API upload
5. File appears in Telegram channel
6. Worker notifies backend
7. File appears in TeleStore UI

### Benefits
✅ Support for files up to 2GB (vs 50MB Bot API limit)
✅ No file size upgrade required - automatic switching
✅ Progress tracking for large uploads
✅ Resume support if chunk upload fails
✅ Works on Render free tier (5MB chunks fit within 10MB request limit)

---

## 📥 Large File Download Support (up to 2GB)

The `render-service-chunked.py` template now uses **FastAPI with pure async streaming** for reliable large file downloads:

### Architecture Improvements
- **Pure Async Streaming**: No more threading/queue overhead - uses FastAPI's `StreamingResponse` with async generators
- **1MB Telegram Chunks**: Increased from 512KB for better efficiency
- **Client Disconnection Detection**: Stops download if client disconnects
- **No Worker Timeouts**: Async streaming doesn't block workers, eliminating SIGKILL issues

### How Downloads Work
1. Frontend requests file with optional Range header (e.g., `bytes=0-5242879` for 5MB chunk)
2. Worker verifies download token with backend
3. Worker opens Telethon client and streams chunks asynchronously
4. Each 1MB chunk is yielded to client without blocking
5. Worker detects client disconnections and stops gracefully

### Why FastAPI Instead of Flask?
- **Flask Problem**: Synchronous threading with blocking `queue.get()` made workers appear stuck to gunicorn, causing SIGKILL
- **FastAPI Solution**: Native async/await support allows workers to yield chunks without blocking, preventing timeouts
- **Proven Approach**: Same pattern used by TGDrive for streaming multi-GB files

### Benefits
✅ Download files up to 2GB without worker timeouts
✅ Efficient memory usage (1MB chunks streamed, not loaded in memory)
✅ Automatic retry support via Range requests
✅ Works on free-tier hosting (Render, Railway, etc.)
✅ No more "WORKER TIMEOUT" or "SIGKILL" errors

---

## Testing Your Worker

Test with curl (you'll need your auth token from TeleStore):
```bash
curl -X POST https://your-worker-url/upload \
  -F "file=@test.jpg" \
  -F "userId=your-user-id" \
  -F "authToken=your-auth-token" \
  -F "fileName=test.jpg"
```

Expected response:
```json
{
  "success": true,
  "messageId": 123,
  "fileId": "xxx",
  "fileName": "test.jpg"
}
```

---

## How Credential Caching Works

### Cache Behavior
- **First Request**: Worker fetches credentials from backend using auth token
- **Subsequent Requests**: Uses cached credentials (1 hour validity)
- **Cache Expiry**: Automatically fetches fresh credentials after 1 hour
- **Worker Restart**: Cache is cleared, fetches on next request
- **Fallback**: If backend is unreachable, uses expired cache if available

### Performance Benefits
- Reduces backend API calls by 99%+ (typical 1000 uploads = 1 credential fetch)
- No latency overhead after first request
- Graceful degradation if backend is temporarily down

---

## Troubleshooting

### "Auth token required" error
- Make sure you're passing the user's auth token in upload requests
- Check that the token is valid (not expired)

### "Telegram not fully configured" error
- User needs to log into Telegram in TeleStore settings
- User needs to create and add a bot token in TeleStore settings

### "Failed to fetch credentials" error
- Check that `BACKEND_URL` is correct in worker config
- Verify backend is accessible from worker
- Check backend logs for authentication errors

### "Chat not found" error
- Make sure bot is added as admin to the channel
- This should happen automatically when bot token is added

### "File too large" error
- Telegram has a 2GB file size limit
- Worker might have timeout limits (adjust as needed)

### CORS errors
- Worker templates include CORS headers
- Check that your frontend URL is correct

### "500 Internal Server Error" after successful upload
**IMPORTANT UPDATE (v2.0)**: If you deployed a worker before this update, you need to redeploy it.

**Symptoms:**
- Video/file uploads to Telegram successfully
- But frontend shows "Response body is already used" error
- File doesn't appear in UI even though it's in Telegram

**Cause:**
Older worker versions had an unnecessary webhook notification that could fail after successful upload.

**Solution:**
1. Copy the updated worker code from this directory
2. Redeploy to your Cloudflare/Vercel/Render account
3. Worker will now return immediately after Telegram upload (faster & more reliable)

### "Telegram session not authorized" error (Large files >50MB)
**Symptoms:**
- Small files upload fine
- Large files (>50MB) fail with "Telegram session not authorized"

**Cause:**
Large files require Telegram Client API (via Telethon), which needs user session authentication.

**Solution:**
1. Go to TeleStore Settings
2. Click "Connect Telegram"
3. Scan QR code or enter phone number
4. This creates a session that allows Client API uploads
5. Try uploading large file again

### "Failed to get credentials" for large file uploads
**Symptoms:**
- Large file upload fails with credential errors
- Worker logs show missing telegram_api_id or telegram_api_hash

**Cause:**
Backend needs Telegram API credentials to support Client API uploads.

**Solution:**
1. Get Telegram API credentials from https://my.telegram.org
2. Add to backend .env file:
   ```
   TELEGRAM_API_ID=your_api_id
   TELEGRAM_API_HASH=your_api_hash
   ```
3. Restart backend
4. Try uploading large file again

### "Worker timeout" or "SIGKILL" errors for large files
**Symptoms:**
- Upload starts successfully but fails after 30 seconds
- Render logs show "WORKER TIMEOUT (pid:XX)" or "Worker was sent SIGKILL"
- File is uploading to Telegram but worker gets killed

**Cause:**
Default Gunicorn timeout (30s) is too short for large file uploads via Telethon.

**Solution:**
1. Use the provided `gunicorn_config.py` configuration file
2. Update your start command to: `gunicorn -c gunicorn_config.py render-service-chunked:app`
3. This sets timeout to 30 minutes (1800 seconds) for 2GB uploads
4. Redeploy your Render service

**What Changed:**
- Removed blocking webhook call after Telegram upload
- Frontend now creates file metadata directly (more reliable)
- Worker is simpler and faster

---

## Chunked Downloads for Large Files (2GB Support)

**NEW**: The Render worker now supports chunked downloads with Range requests to handle files up to 2GB on free-tier hosting!

### How It Works

1. **Frontend requests file in 5MB chunks** using Range headers
2. **Each chunk request completes in ~10-30 seconds** (no timeout issues)
3. **Worker streams only that specific byte range** from Telegram
4. **Browser assembles chunks** into complete file using Blob API
5. **Progress bar shows download progress** during multi-chunk downloads

### Benefits

- ✅ **No timeout issues** - Each chunk completes quickly
- ✅ **Low memory usage** - Only 5MB in memory at a time
- ✅ **Works on free tier** - Render, Vercel, Cloudflare all supported
- ✅ **Resume support** - Failed chunks are retried automatically
- ✅ **Progress tracking** - Real-time download progress
- ✅ **2GB files supported** - Tested with large video files

### Technical Details

**Range Request Format:**
```
GET /download?messageId=123&token=xxx&fileName=video.mp4
Range: bytes=0-5242879
```

**Response:**
```
HTTP/1.1 206 Partial Content
Content-Range: bytes 0-5242879/2147483648
Accept-Ranges: bytes
Content-Type: application/octet-stream
```

### Frontend Integration

The frontend `downloadHelper.js` automatically handles:
- Chunked downloads for files >20MB
- Direct downloads for files <20MB
- Progress tracking and retry logic
- Blob assembly and browser download trigger

### Important for Free Tier Hosting

**Render/Vercel/Cloudflare have HTTP request timeouts (~2 min)**, which makes streaming a 2GB file in one request impossible. Chunked downloads solve this by:
- Breaking the file into small pieces that complete quickly
- Each request is independent (no long-running connections)
- Memory efficient (only one chunk in memory at a time)

This is the **same approach used by Google Drive, Dropbox, and other cloud storage services**.

### Testing Chunked Downloads

A test HTML page is included: `test-chunked-download.html`

1. Open the file in your browser
2. Fill in:
   - Worker URL (your Render worker URL)
   - Message ID (from Telegram)
   - Download token (JWT from backend)
   - File name and size
3. Click "Start Chunked Download" to test

The test page will:
- Download file in 5MB chunks
- Show real-time progress
- Log each chunk download
- Combine and trigger browser download

---

## Security Notes

- ✅ Credentials never stored in worker code or environment variables
- ✅ Auth token required for credential access
- ✅ Credentials cached securely in worker memory only
- ✅ Automatic credential refresh ensures up-to-date access
- ✅ Each user's credentials isolated by auth token
- ✅ Download tokens expire after 1 hour (JWT-based)
- ⚠️ Use HTTPS for all worker deployments
- ⚠️ Never log or expose auth tokens

---

## Migration from Old Setup

If you previously configured workers with manual credentials:

1. **Remove old environment variables**: 
   - Delete `TELEGRAM_BOT_TOKEN`
   - Delete `TELEGRAM_CHANNEL_ID`
   - Delete `TELEGRAM_SESSION`
   - Keep only `BACKEND_URL`

2. **Update worker code**: 
   - Replace old worker code with new templates
   - Ensure `authToken` is passed in upload requests

3. **Update frontend upload logic**:
   - Include `authToken` in FormData when uploading

4. **Test thoroughly**: 
   - Verify uploads work
   - Check that credentials are being cached
   - Monitor backend logs for credential fetch requests

---

## Advanced Configuration

### Adjust Cache Duration

**Cloudflare Worker / Vercel:**
```javascript
const CONFIG = {
  CACHE_DURATION: 7200000, // 2 hours in milliseconds
};
```

**Render (Python):**
```python
CONFIG = {
    'CACHE_DURATION': 7200,  # 2 hours in seconds
}
```

### Disable Caching (Not Recommended)
Set `CACHE_DURATION` to `0` to fetch credentials on every request. This will increase backend load significantly.

---
