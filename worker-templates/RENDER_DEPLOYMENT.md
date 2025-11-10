# Render.com Deployment Guide for TeleStore Worker

This guide helps you deploy the TeleStore worker on Render.com with support for large file uploads (up to 2GB).

## Quick Deploy (Recommended)

### Option 1: Deploy via GitHub

1. **Fork or Push to GitHub**
   ```bash
   # Create a new repository on GitHub
   # Push your worker code
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/yourusername/telestore-worker.git
   git push -u origin main
   ```

2. **Connect to Render**
   - Go to [Render Dashboard](https://dashboard.render.com/)
   - Click "New +" → "Web Service"
   - Connect your GitHub repository
   - Render will auto-detect the `render.yaml` configuration

3. **Configure Environment Variable**
   - Set `BACKEND_URL` to your TeleStore backend URL
   - Example: `https://your-telestore-backend.com`

4. **Deploy**
   - Click "Create Web Service"
   - Wait for deployment to complete
   - Copy your worker URL (e.g., `https://your-worker.onrender.com`)

### Option 2: Deploy via Blueprint (One-Click)

1. Click the "Deploy to Render" button in the main README
2. Fill in the `BACKEND_URL` environment variable
3. Click "Apply"

## Manual Deployment Steps

### 1. Prepare Your Project

Create a folder with these files:

```
telestore-worker/
├── render-service-chunked.py
├── requirements.txt
├── gunicorn_config.py
├── render.yaml
└── README.md
```

### 2. File Contents

**requirements.txt:**
```
Flask==3.0.0
Flask-Cors==4.0.0
requests==2.32.5
Werkzeug==3.0.1
gunicorn==21.2.0
telethon==1.34.0
cryptg==0.4.0
```

**gunicorn_config.py:**
```python
# See /app/worker-templates/gunicorn_config.py
```

**render.yaml:**
```yaml
# See /app/worker-templates/render.yaml
```

### 3. Deploy to Render

#### Via Dashboard:

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Click "New +" → "Web Service"
3. Choose "Deploy an existing image from a registry" OR "Build and deploy from a Git repository"
4. Fill in:
   - **Name**: telestore-worker
   - **Environment**: Python 3
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `gunicorn -c gunicorn_config.py render-service-chunked:app`
5. Add environment variable:
   - Key: `BACKEND_URL`
   - Value: Your TeleStore backend URL
6. Click "Create Web Service"

#### Via Render CLI:

```bash
# Install Render CLI
npm install -g @render/cli

# Login
render login

# Deploy
render deploy
```

## Configuration Details

### Gunicorn Settings

The `gunicorn_config.py` file is critical for large file uploads:

- **Timeout**: 1800 seconds (30 minutes)
  - Allows 2GB files to upload completely
  - Default 30s timeout would kill the worker
  
- **Workers**: 2
  - Handles multiple upload requests
  - Adjust based on Render plan (free tier: 512MB RAM)

- **Worker Class**: sync
  - Required for Flask with async Telethon
  - Alternative: Use 'gevent' for better concurrency

### Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `BACKEND_URL` | Yes | Your TeleStore backend URL | `https://backend.com` |
| `PORT` | No | Render sets automatically | `10000` |
| `PYTHON_VERSION` | No | Python version | `3.11.0` |

## Post-Deployment

### 1. Get Your Worker URL

After deployment, Render provides a URL like:
```
https://telestore-worker-xyz.onrender.com
```

### 2. Add to TeleStore

1. Login to your TeleStore app
2. Go to Settings → Worker Setup
3. Paste your worker URL
4. Save

### 3. Test Upload

1. Try uploading a small file (< 50MB) → Uses Bot API
2. Try uploading a large file (> 50MB) → Uses Telethon Client API
3. Monitor Render logs for any errors

## Monitoring and Logs

### View Logs

```bash
# Via Dashboard
# Go to your service → Logs tab

# Via CLI
render logs -f
```

### Important Log Messages

**✅ Success Indicators:**
```
File size X bytes <= 50MB, using Bot API
File size X bytes > 50MB, using Telegram Client API
Successfully resolved channel entity
File uploaded successfully via Telethon
```

**❌ Error Indicators:**
```
WORKER TIMEOUT → Increase timeout in gunicorn_config.py
telegram_session is missing → User needs to login to Telegram
Telegram session not authorized → User needs to re-login
Could not resolve channel ID → Check channel_id format
```

## Troubleshooting

### Worker Keeps Timing Out

**Problem**: Large files fail with "WORKER TIMEOUT"

**Solution**:
1. Verify `gunicorn_config.py` is in your project
2. Check start command uses: `gunicorn -c gunicorn_config.py ...`
3. Increase timeout if needed (edit `gunicorn_config.py`)

### Out of Memory Errors

**Problem**: Worker killed with "out of memory"

**Solution**:
1. Upgrade Render plan (free tier: 512MB, starter: 2GB)
2. Reduce number of workers in `gunicorn_config.py`
3. Use chunked uploads properly (5MB chunks)

### Slow Upload Speeds

**Problem**: Large files take very long to upload

**Factors**:
- Render free tier has limited bandwidth
- Telethon Client API is slower than Bot API
- Network conditions between Render and Telegram servers

**Solutions**:
1. Upgrade to Render paid plan for better bandwidth
2. Use a different hosting provider closer to Telegram servers
3. For files < 50MB, Bot API is much faster

### Cold Starts

**Problem**: Worker takes time to start after inactivity

**Solution**:
- Free tier: Workers spin down after 15 min inactivity
- Paid tier: Workers stay always active
- Use auto-pinger feature in TeleStore (keeps worker warm)

## Performance Tips

### 1. Optimize for Your Use Case

**Mostly Small Files (<50MB)**:
- Default configuration works great
- Bot API is very fast

**Mostly Large Files (>50MB)**:
- Consider paid Render plan for better RAM/bandwidth
- Monitor upload times and adjust timeout if needed

### 2. Scaling

**Free Tier**:
- 512MB RAM
- 1 worker recommended
- Good for personal use

**Starter Tier ($7/mo)**:
- 2GB RAM  
- 2-4 workers
- Good for small teams

**Standard Tier ($25/mo)**:
- 8GB RAM
- 4-8 workers
- Good for production use

### 3. Monitoring

Set up alerts in Render:
- CPU usage > 80%
- Memory usage > 80%
- Error rate > 5%

## Security Best Practices

1. **Never commit credentials**
   - Use environment variables
   - Add `.env` to `.gitignore`

2. **HTTPS Only**
   - Render provides free SSL
   - All traffic encrypted

3. **Rate Limiting**
   - Consider adding rate limiting for production
   - Prevents abuse of worker

4. **Authentication**
   - Worker validates auth tokens
   - Backend credentials cached securely

## Cost Optimization

### Free Tier Strategy

- **Cold starts**: Worker spins down after 15 min
- **Monthly hours**: 750 hours free
- **Strategy**: Use auto-pinger only during active hours

### Paid Tier Benefits

- **Always on**: No cold starts
- **Better performance**: More RAM/CPU
- **Multiple workers**: Handle concurrent uploads
- **Priority support**: Faster help from Render

## Upgrading Your Worker

### Update Code

```bash
# Pull latest code
git pull origin main

# Push to trigger redeploy
git push

# Render auto-deploys on push
```

### Manual Redeploy

```bash
# Via Dashboard
# Go to service → Manual Deploy → Deploy latest commit

# Via CLI
render deploy --service your-service-id
```

## Support

- **Render Documentation**: https://render.com/docs
- **TeleStore Issues**: Create issue in TeleStore repo
- **Worker Issues**: Check Render logs first
- **Performance Issues**: Upgrade Render plan

## Additional Resources

- [Render Python Deployment](https://render.com/docs/deploy-flask)
- [Gunicorn Configuration](https://docs.gunicorn.org/en/stable/configure.html)
- [Telethon Documentation](https://docs.telethon.dev/)
- [Flask-CORS Documentation](https://flask-cors.readthedocs.io/)
