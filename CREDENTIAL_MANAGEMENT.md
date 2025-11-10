# TeleStore Automatic Credential Management

## Overview

TeleStore now features **automatic credential management** for workers. When users log into Telegram and configure their bot, all necessary credentials (bot token, channel ID, session strings, API keys) are stored securely in the database and automatically provided to workers on demand.

## Architecture

```
┌─────────────────┐
│   User Logs In  │
│   to Telegram   │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Backend Stores Credentials:    │
│  - telegram_session             │
│  - telegram_user_id             │
│  - telegram_channel_id          │
│  - telegram_bot_token           │
│  - telegram_api_id (from .env)  │
│  - telegram_api_hash (from .env)│
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Worker Requests Credentials    │
│  - Sends: auth_token, user_id   │
│  - Receives: all credentials    │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Worker Caches Credentials      │
│  - In-memory cache (1 hour)     │
│  - Auto-refresh on expiry       │
│  - Fallback to expired cache    │
└─────────────────────────────────┘
```

## Backend Implementation

### Database Schema

The `User` model stores all necessary credentials:

```python
class User(BaseModel):
    id: str
    email: EmailStr
    telegram_session: Optional[str] = None           # Session string for Telethon
    telegram_user_id: Optional[int] = None           # Telegram user ID
    telegram_channel_id: Optional[int] = None        # Private channel ID
    telegram_channel_invite: Optional[str] = None    # Channel invite link
    telegram_bot_token: Optional[str] = None         # Bot token from @BotFather
    telegram_bot_username: Optional[str] = None      # Bot username
    # ... other fields
```

### API Endpoints

#### 1. Telegram Login (QR or Phone)
```
POST /api/telegram/request-qr
POST /api/telegram/verify-qr
POST /api/telegram/request-code
POST /api/telegram/verify-code
```

These endpoints:
- Create a Telegram client session
- Authenticate the user
- Create a private channel
- Store session string and channel ID in database

#### 2. Bot Token Configuration
```
POST /api/settings/bot-token
```

This endpoint:
- Validates the bot token
- Automatically adds bot to user's channel as admin
- Stores bot token and username in database

Request:
```json
{
  "bot_token": "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
}
```

Response:
```json
{
  "success": true,
  "bot_username": "my_telestore_bot",
  "message": "Bot token saved successfully"
}
```

#### 3. Worker Credentials Endpoint
```
GET /api/worker/credentials
Authorization: Bearer <user_token>
```

This endpoint:
- Requires user authentication
- Returns all credentials needed by workers
- Used by workers to fetch credentials

Response:
```json
{
  "bot_token": "123456:ABC-DEF...",
  "channel_id": "-1001234567890",
  "telegram_session": "1AgAOMTQ...",
  "telegram_api_id": "12345678",
  "telegram_api_hash": "abc123...",
  "user_id": "user-uuid",
  "backend_url": "https://backend.com"
}
```

## Worker Implementation

### Credential Fetching

All three worker templates (Cloudflare, Vercel, Render) implement the same credential fetching logic:

```javascript
// Example: Cloudflare Worker
let credentialsCache = {
  data: null,
  timestamp: 0,
  userId: null
};

async function getCredentials(userId, authToken) {
  const now = Date.now();
  
  // Check cache validity
  if (credentialsCache.data && 
      credentialsCache.userId === userId && 
      (now - credentialsCache.timestamp) < CACHE_DURATION) {
    return credentialsCache.data;
  }
  
  // Fetch from backend
  const response = await fetch(`${BACKEND_URL}/api/worker/credentials`, {
    headers: { 'Authorization': `Bearer ${authToken}` }
  });
  
  const credentials = await response.json();
  
  // Cache credentials
  credentialsCache = {
    data: credentials,
    timestamp: now,
    userId: userId
  };
  
  return credentials;
}
```

### Upload Request Flow

When uploading a file, the frontend must include the user's auth token:

```javascript
const formData = new FormData();
formData.append('file', file);
formData.append('userId', user.id);
formData.append('authToken', authToken);  // Required!
formData.append('fileName', file.name);

const response = await fetch(WORKER_URL, {
  method: 'POST',
  body: formData
});
```

The worker then:
1. Extracts `userId` and `authToken` from the request
2. Calls `getCredentials(userId, authToken)`
3. Uses cached or fetches fresh credentials
4. Uploads file to Telegram using bot token and channel ID
5. Notifies backend of successful upload

### Caching Strategy

**Cache Duration**: 1 hour (3600 seconds / 3600000 milliseconds)

**Cache Key**: User ID (each user has separate cache)

**Cache Invalidation**:
- Automatic after 1 hour
- Worker restart (in-memory cache cleared)
- Backend unreachable (uses expired cache as fallback)

**Performance Impact**:
- First upload: 1 backend API call for credentials + 1 Telegram upload
- Next 1000 uploads (within 1 hour): 0 credential fetches, only Telegram uploads
- Reduces backend load by 99%+

## Security Considerations

### ✅ Secure Practices

1. **No Hardcoded Credentials**: Workers never store credentials in code or environment variables
2. **Authentication Required**: All credential requests require valid JWT token
3. **Per-User Isolation**: Each user's credentials are separate and access-controlled
4. **Encrypted Transport**: All communication over HTTPS
5. **Memory-Only Cache**: Credentials cached in RAM, never persisted to disk
6. **Limited Exposure**: Credentials only sent over authenticated channels

### ⚠️ Security Notes

1. **Auth Token Security**: Keep user auth tokens secure in frontend (localStorage/sessionStorage)
2. **HTTPS Mandatory**: Always use HTTPS for worker deployments
3. **Token Rotation**: If user changes bot token, worker cache auto-refreshes within 1 hour
4. **Access Control**: Backend validates user owns the requested credentials

## Setup Guide for Users

### Step 1: Backend Configuration (One-Time)

Add Telegram API credentials to backend `.env`:

```bash
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=abc123def456...
```

Get these from https://my.telegram.org

### Step 2: User Login to Telegram

1. Open TeleStore web app
2. Go to Settings → Telegram
3. Click "Connect via QR" or "Connect via Phone"
4. Complete authentication
5. Private channel created automatically

### Step 3: Create and Add Bot

1. Open Telegram app
2. Search for @BotFather
3. Send `/newbot` command
4. Follow instructions to create bot
5. Copy bot token
6. In TeleStore Settings, paste bot token and click "Save"
7. Bot automatically added as admin to your private channel

### Step 4: Deploy Worker

Choose any platform (Cloudflare, Vercel, or Render):

**Cloudflare:**
```bash
wrangler init my-worker
# Copy cloudflare-worker.js to src/index.js
# Update BACKEND_URL in the code
wrangler deploy
```

**Vercel:**
```bash
mkdir my-worker && cd my-worker
npm init -y
npm install form-data node-fetch
# Create api/upload.js with vercel-serverless.js content
# Set BACKEND_URL environment variable
vercel deploy
```

**Render:**
```bash
# Upload render-service.py
# Set BACKEND_URL environment variable
# Deploy
```

**Important**: Only `BACKEND_URL` needs to be configured. No bot tokens or channel IDs required!

### Step 5: Start Uploading

Files can now be uploaded through the worker. The worker will automatically fetch and cache your credentials.

## Troubleshooting

### "Auth token required" Error

**Cause**: Frontend not sending auth token to worker

**Solution**: Ensure upload requests include auth token:
```javascript
formData.append('authToken', localStorage.getItem('authToken'));
```

### "Telegram not fully configured" Error

**Cause**: User hasn't completed Telegram login or bot setup

**Solution**: 
1. Complete Telegram login (QR or phone)
2. Create bot via @BotFather
3. Add bot token in Settings

### "Failed to fetch credentials" Error

**Cause**: Worker can't reach backend

**Solution**:
1. Verify `BACKEND_URL` is correct
2. Check backend is accessible from worker
3. Verify no firewall/CORS issues

### Credentials Not Updating

**Cause**: Worker cache hasn't expired

**Solution**: 
- Wait up to 1 hour for cache to expire
- Or restart worker to clear cache immediately

### Bot Not Admin Error

**Cause**: Bot not added to channel with admin rights

**Solution**: 
1. Go to Settings
2. Re-save bot token
3. Backend will automatically re-add bot as admin

## API Reference

### POST /api/settings/bot-token

Add or update Telegram bot token.

**Request:**
```json
{
  "bot_token": "string"
}
```

**Response:**
```json
{
  "success": true,
  "bot_username": "string",
  "message": "string"
}
```

**Errors:**
- `400`: Invalid bot token
- `401`: Unauthorized
- `500`: Server error

### GET /api/worker/credentials

Get worker credentials for authenticated user.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response:**
```json
{
  "bot_token": "string",
  "channel_id": "string",
  "telegram_session": "string",
  "telegram_api_id": "string",
  "telegram_api_hash": "string",
  "user_id": "string",
  "backend_url": "string"
}
```

**Errors:**
- `400`: Telegram not fully configured
- `401`: Unauthorized
- `500`: Server error

## Benefits Summary

### For Users
- ✅ No manual worker configuration
- ✅ Easy setup (just deploy worker, set backend URL)
- ✅ Automatic credential sync across all workers
- ✅ Change bot/channel anytime without updating workers
- ✅ Secure credential management

### For Developers
- ✅ Simplified deployment
- ✅ No environment variable management
- ✅ Built-in caching for performance
- ✅ Graceful error handling
- ✅ Scalable architecture

### For System
- ✅ Reduced backend API calls (99%+ reduction)
- ✅ Centralized credential storage
- ✅ Easy credential rotation
- ✅ Better security through token-based access
- ✅ Support for multiple workers per user

## Migration from Manual Configuration

If you have existing workers with hardcoded credentials:

1. Update worker code to new templates
2. Remove these environment variables:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHANNEL_ID`
   - `TELEGRAM_SESSION`
3. Keep only: `BACKEND_URL`
4. Update frontend to send `authToken` in uploads
5. Test thoroughly

## Future Enhancements

Potential improvements:

- [ ] Worker URL management in frontend
- [ ] Credential rotation API
- [ ] Multi-channel support per user
- [ ] Worker health monitoring
- [ ] Credential usage analytics
- [ ] Automatic worker deployment tools
- [ ] Redis-based distributed caching
- [ ] Webhook for credential updates

---

**Last Updated**: January 2025
**Version**: 1.0
