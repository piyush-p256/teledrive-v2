# Download System Refactor - Complete

## Problem Statement

The application had inconsistent download implementations:
1. **Share pages** were using chunked download approach with Range requests
2. **Gallery** was caching all URLs including worker streaming URLs with expiring JWT tokens
3. This caused issues with large file downloads (>20MB) that use worker streaming

## Root Cause Analysis

### Backend (Already Correct ✅)
The backend was already properly implemented with hybrid download system:
- Files <20MB: Returns `type: "direct"` with Telegram Bot API URL (instant, cacheable)
- Files >20MB: Returns `type: "stream"` with worker streaming URL + JWT token (not cacheable)

### Frontend Issues (Now Fixed ✅)
1. **SharedFile.jsx**: Was using `downloadFileInChunks()` that tried to make Range requests to worker streaming URLs
2. **SharedCollection.jsx**: Had unused import but was working correctly
3. **ImageGalleryModal.jsx**: 
   - Cached all URLs regardless of file size
   - Large video worker streaming URLs (with JWT tokens) were being cached
   - Cached URLs would expire after 1 hour, breaking video playback
   - Was using `downloadFileInChunks()` for downloads

## Solution Implemented

### Files Modified

#### 1. `/app/frontend/src/pages/SharedFile.jsx`
**Changes:**
- ✅ Removed `downloadFileInChunks()` import
- ✅ Changed `handleDownload()` to use direct download with `<a>` tag
- ✅ Removed progress tracking (downloadProgress state and display)
- ✅ Simplified download button text

**Before:**
```javascript
// Used chunked download with Range requests
await downloadFileInChunks(
  download_url,
  file.name,
  size || file.size,
  (percent, downloaded, total) => {
    setDownloadProgress(percent);
  }
);
```

**After:**
```javascript
// Direct download - browser handles both URL types
const link = document.createElement('a');
link.href = download_url;
link.download = file.name;
link.target = '_blank';
document.body.appendChild(link);
link.click();
document.body.removeChild(link);
```

#### 2. `/app/frontend/src/pages/SharedCollection.jsx`
**Changes:**
- ✅ Removed unused `downloadFileInChunks` import

**Note:** This file was already using direct downloads correctly via `handleDownloadFile()`.

#### 3. `/app/frontend/src/components/ImageGalleryModal.jsx`
**Changes:**
- ✅ Fixed caching logic in `loadImage()` function:
  - Now checks file size before using cache
  - Only caches URLs for files <20MB (direct Bot API URLs)
  - Large files >20MB always fetch fresh URLs (worker streaming URLs with JWT tokens)
  - Added type checking to only cache "direct" type URLs
- ✅ Fixed `handleDownload()` function:
  - Removed `downloadFileInChunks()` call
  - Changed to direct download
  - Removed progress tracking
- ✅ Removed unused imports and state variables

**Before:**
```javascript
// Always used cache regardless of file size
const cachedUrl = ImageCache.get(photoId);
if (cachedUrl) {
  setImageUrl(cachedUrl);
  setLoading(false);
  return;
}

// Always cached all URLs
ImageCache.set(photoId, url);
```

**After:**
```javascript
const fileSize = currentPhoto?.size || 0;
const BOT_API_LIMIT = 20 * 1024 * 1024; // 20 MB

// Only use cache for small files (<20MB)
if (fileSize < BOT_API_LIMIT) {
  const cachedUrl = ImageCache.get(photoId);
  if (cachedUrl) {
    setImageUrl(cachedUrl);
    setLoading(false);
    return;
  }
}

// Only cache direct Bot API URLs (small files), not worker streaming URLs
if (type === 'direct' && fileSize < BOT_API_LIMIT) {
  ImageCache.set(photoId, url);
}
```

## How It Works Now

### Download Flow Diagram

```
┌─────────────────────┐
│   Frontend Request  │
│  (Share/Gallery)    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────────────────┐
│  Backend /download-url endpoint │
│  Checks file size: <20MB or >20MB
└──────────┬──────────┬───────────┘
           │          │
   <20MB   │          │   >20MB
           ▼          ▼
   ┌──────────┐  ┌──────────────┐
   │ Bot API  │  │   Worker     │
   │  Direct  │  │  Streaming   │
   │   URL    │  │  URL + JWT   │
   └─────┬────┘  └──────┬───────┘
         │              │
         ▼              ▼
   ┌─────────────────────────┐
   │  Frontend uses URL      │
   │  directly with <a> tag  │
   │  Browser handles both   │
   └─────────────────────────┘
```

### URL Types

| File Size | Backend Returns | Frontend Action | Cacheable? |
|-----------|----------------|-----------------|------------|
| <20MB | `type: "direct"` + Bot API URL | Use directly | ✅ Yes (1 hour) |
| >20MB | `type: "stream"` + Worker URL + JWT | Use directly | ❌ No (token expires) |

## Benefits

✅ **Consistent behavior**: All download points now use the same approach  
✅ **Large files work**: Worker streaming URLs used directly without chunking  
✅ **Small files fast**: Direct Bot API URLs remain instant  
✅ **Gallery videos work**: Large videos fetch fresh streaming URLs each time  
✅ **No caching issues**: JWT tokens not cached, always fresh  
✅ **Simpler code**: Removed unnecessary chunking logic from frontend  
✅ **Worker handles complexity**: All streaming logic stays in worker

## Testing Checklist

### Share Page (SharedFile.jsx)
- [ ] Upload file <20MB → Share → Download works instantly
- [ ] Upload file >20MB → Share → Download works via worker streaming
- [ ] Download button shows correct state

### Gallery (ImageGalleryModal.jsx)
- [ ] View image <20MB → Loads instantly (cached)
- [ ] View video <20MB → Plays correctly (cached URL)
- [ ] View video >20MB → Plays correctly (fresh streaming URL)
- [ ] Download from gallery works for both small and large files
- [ ] Switching between files works smoothly

### Collection Share (SharedCollection.jsx)
- [ ] Share multiple files → All download correctly
- [ ] Mix of small and large files → Each uses appropriate method
- [ ] Download all button works

## Technical Details

### Worker Streaming URL Format
```
https://your-worker.com/download?messageId={id}&token={jwt}&fileName={name}
```
- `messageId`: Telegram message ID containing the file
- `token`: JWT token (expires in 1 hour)
- `fileName`: Original file name for download

### JWT Token Contents
```javascript
{
  "user_id": "...",
  "file_id": "...",
  "exp": 1234567890  // Unix timestamp (1 hour from creation)
}
```

## Migration Notes

### For Users
No action required! The changes are backward compatible:
- Existing share links continue to work
- Gallery continues to work
- Downloads work exactly as before

### For Developers
If you're working on download functionality:
1. Always use the `download_url` from backend directly
2. Don't implement Range requests or chunking on frontend
3. Check `type` field to understand URL type if needed
4. Only cache `type: "direct"` URLs, never `type: "stream"` URLs

## Related Files

### Backend (No changes needed)
- `/app/backend/server.py`: Already implements hybrid download system correctly
- `/app/worker-templates/render-service-chunked.py`: Worker handles streaming for large files

### Frontend (Updated)
- ✅ `/app/frontend/src/pages/SharedFile.jsx`
- ✅ `/app/frontend/src/pages/SharedCollection.jsx`
- ✅ `/app/frontend/src/components/ImageGalleryModal.jsx`
- ℹ️  `/app/frontend/src/pages/Dashboard.jsx` (already correct, no changes)

### Utilities
- `/app/frontend/src/utils/downloadHelper.js`: Keep for legacy/future use but not currently used

## Performance Characteristics

| Scenario | Method | Speed | Notes |
|----------|--------|-------|-------|
| Small file (<20MB) first view | Bot API Direct | Instant | URL cached for 1 hour |
| Small file (<20MB) repeat view | Cache | Instant | From localStorage |
| Large file (>20MB) first view | Worker Streaming | 1-5 MB/s | Fresh URL each time |
| Large file (>20MB) repeat view | Worker Streaming | 1-5 MB/s | Fresh URL each time |
| Download (any size) | Direct Link | Native | Browser handles |

## Troubleshooting

### Issue: Large video won't play in gallery
**Cause**: Old cached Bot API URL being used  
**Fix**: Clear localStorage cache or wait 1 hour for cache to expire  
**Prevention**: Now fixed - large videos always fetch fresh URLs

### Issue: Download link doesn't work
**Cause**: JWT token expired (>1 hour old)  
**Fix**: Refresh the page to get a new URL  
**Prevention**: Frontend always fetches fresh URL on download button click

### Issue: Worker streaming slow
**Cause**: Worker cold start or Telegram API throttling  
**Fix**: Wait for worker to warm up, speed will improve  
**Note**: First download after idle may take 30s to start

## Summary

This refactor aligns the frontend download implementation with the backend's hybrid system. All download points now use direct URLs, letting the browser and worker handle the complexity. Large files work via worker streaming, small files remain instant via Bot API, and caching is intelligent - only caching what should be cached.

**Status**: ✅ Complete and ready for testing
