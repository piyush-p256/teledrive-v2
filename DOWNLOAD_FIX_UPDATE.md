# Download Function Fix - Telethon API Correction

## Error Found in Logs

```
TypeError: DownloadMethods.iter_download() takes 2 positional arguments but 3 positional arguments (and 1 keyword-only argument) were given
```

## Root Cause

Incorrect Telethon API usage in `/app/worker-templates/render-service-chunked.py`:

**WRONG (Previous Code):**
```python
async for chunk in client.iter_download(
    channel,              # ❌ Wrong: passing channel and message_id separately
    int(message_id),
    chunk_size=chunk_size
):
```

**CORRECT (Fixed Code):**
```python
# First get the message
message = await client.get_messages(channel, ids=int(message_id))

# Then download from the message object
async for chunk in client.iter_download(message, chunk_size=chunk_size):
```

## What Changed

**File**: `/app/worker-templates/render-service-chunked.py`  
**Function**: `download_and_stream()` (inside `generate_file_stream()`)  
**Lines**: ~632-652

### Updated Code

```python
async def download_and_stream():
    chunks = []
    await client.connect()
    
    try:
        # Get the channel entity
        channel = await client.get_entity(int(credentials['channel_id']))
        
        # Get the message containing the file ← NEW
        message = await client.get_messages(channel, ids=int(message_id))
        
        if not message:
            raise Exception(f"Message {message_id} not found in channel")
        
        # Download file in chunks from the message
        chunk_size = 1024 * 1024  # 1MB chunks
        async for chunk in client.iter_download(message, chunk_size=chunk_size):  # ← FIXED
            chunks.append(chunk)
    
    finally:
        await client.disconnect()
    
    return chunks
```

## Why This Works

Telethon's `iter_download()` expects:
- **Option 1**: A message object directly (what we're using now)
- **Option 2**: An entity with file attribute

We were incorrectly passing both channel and message_id as separate arguments.

The correct approach:
1. Get the message object using `get_messages(channel, ids=message_id)`
2. Pass the message object to `iter_download()`

## Action Required

🔴 **YOU MUST REDEPLOY YOUR RENDER WORKER AGAIN** with this fixed code:

1. **Copy updated file**: `/app/worker-templates/render-service-chunked.py`
2. **Replace in your Render repository**
3. **Commit and push** (Render will auto-deploy)
4. **Test large file download** - should work now!

## Testing

After redeployment:

```bash
# Should see in Render logs:
# No more TypeError
# Successful file streaming
# Files download completely
```

Try downloading your large files (>50MB) - they should work now!

## Summary

- ✅ Fix applied to worker template
- ✅ Correct Telethon API usage
- ✅ Documentation updated
- 🔴 User must redeploy worker with fixed code

The issue was a simple API signature mismatch. With this fix, large file downloads will work correctly!
