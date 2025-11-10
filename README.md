# TeleStore - Unlimited Cloud Storage Powered by Telegram

![TeleStore](https://img.shields.io/badge/TeleStore-v1.0-blue)
![FastAPI](https://img.shields.io/badge/FastAPI-0.110.1-green)
![React](https://img.shields.io/badge/React-19.0.0-blue)
![MongoDB](https://img.shields.io/badge/MongoDB-latest-green)

A Google Drive / Google Photos–style web platform that uses Telegram as the main storage backend and Cloudinary/imgbb for thumbnails. Store unlimited files using your personal Telegram channel!

## 🌟 Features

### Core Features
- **Email/Password Authentication** - Secure user registration and login
- **Telegram Integration** - Connect via QR code or phone number
- **Automatic Channel Creation** - Private Telegram channel created automatically
- **File Management** - Upload, rename, delete, organize files and folders
- **Thumbnail Generation** - In-browser thumbnail creation for fast previews
- **Dual Storage Support** - Cloudinary AND imgbb for thumbnails
- **Public Sharing** - Generate shareable links for files
- **Trash Management** - Soft delete with restore functionality
- **Worker Templates** - Deploy your own upload worker (Cloudflare/Vercel/Render)
- **Auto-Sync** - Telegram bot integration for real-time sync

### Technical Highlights
- **Bandwidth Efficient** - Only metadata stored in MongoDB, files in Telegram
- **Direct Downloads** - Files loaded directly from Telegram CDN
- **Scalable Architecture** - Serverless workers for uploads
- **Modern UI** - Beautiful, responsive interface with Shadcn UI
- **Real-time Updates** - Near-instant sync between Telegram and web

## 🏗️ Architecture

```
┌─────────────┐     ┌──────────────┐     ┌────────────────┐
│   Browser   │────▶│   Frontend   │────▶│    Backend     │
│   (React)   │     │  (React 19)  │     │   (FastAPI)    │
└─────────────┘     └──────────────┘     └────────────────┘
                                                   │
                    ┌──────────────────────────────┼──────────────┐
                    │                              │              │
                    ▼                              ▼              ▼
            ┌──────────────┐            ┌──────────────┐  ┌──────────┐
            │   MongoDB    │            │   Telegram   │  │Cloudinary│
            │  (Metadata)  │            │   (Files)    │  │ (Thumbs) │
            └──────────────┘            └──────────────┘  └──────────┘
                                                │
                                        ┌───────┴───────┐
                                        │               │
                                        ▼               ▼
                                ┌──────────────┐  ┌─────────┐
                                │    Worker    │  │   Bot   │
                                │(CF/Vercel/R) │  │ (Sync)  │
                                └──────────────┘  └─────────┘
```

## 📋 Prerequisites

### Required
- Python 3.11+
- Node.js 18+
- MongoDB
- Telegram Account
- Telegram API credentials (api_id, api_hash from https://my.telegram.org)

### Optional (for full functionality)
- Cloudinary account (for thumbnails)
- ImgBB account (alternative for thumbnails)
- Cloudflare/Vercel/Render account (for worker deployment)

## 🚀 Quick Start

### 1. Clone and Install

```bash
# Backend
cd backend
pip install -r requirements.txt

# Frontend
cd frontend
yarn install
```

### 2. Configure Environment

**Backend (.env)**
```bash
MONGO_URL="mongodb://localhost:27017"
DB_NAME="telestore"
JWT_SECRET_KEY="your-super-secret-key-here"

# Get from https://my.telegram.org
TELEGRAM_API_ID="your_api_id"
TELEGRAM_API_HASH="your_api_hash"
```

**Frontend (.env)**
```bash
REACT_APP_BACKEND_URL=https://your-backend-url.com
```

### 3. Run Development Servers

```bash
# Backend (from /app/backend)
sudo supervisorctl restart backend

# Frontend (from /app/frontend)
sudo supervisorctl restart frontend
```

### 4. Access the Application

Open your browser and navigate to your frontend URL.

## 📱 User Guide

### Step 1: Create Account
1. Visit the application
2. Click "Sign Up" tab
3. Enter email and password
4. Click "Create Account"

### Step 2: Connect Telegram
1. Go to Settings (gear icon)
2. Choose connection method:
   - **QR Code**: Generate and scan with Telegram app
   - **Phone**: Enter phone number and verification code
3. Private channel created automatically
4. Copy channel invite link (optional)

### Step 3: Configure API Keys (Optional but Recommended)
1. Go to Settings → Storage Keys
2. Add Cloudinary credentials:
   - Cloud Name
   - API Key
   - API Secret
3. Or add ImgBB API Key
4. Click "Save API Keys"

### Step 4: Deploy Worker (Required for Uploads)

Choose one platform:

#### Option A: Cloudflare Workers
```bash
cd worker-templates
# Edit cloudflare-worker.js with your credentials
wrangler deploy
```

#### Option B: Vercel Serverless
```bash
cd worker-templates
mkdir my-worker && cd my-worker
npm init -y
npm install form-data node-fetch
# Copy vercel-serverless.js to api/upload.js
vercel deploy
```

#### Option C: Render
```bash
cd worker-templates
# Upload render-service.py to Render
# Set environment variables in Render dashboard
```

See `/worker-templates/README.md` for detailed instructions.

### Step 5: Upload Files
1. Return to Dashboard
2. Click "Upload Files"
3. Select files to upload
4. Thumbnails generated automatically
5. Files uploaded to your Telegram channel

### Step 6: Manage Files
- **Create Folders**: Click "New Folder"
- **Rename**: Click three dots → Rename
- **Delete**: Click three dots → Delete (moves to trash)
- **Share**: Click three dots → Share (copies link)
- **Search**: Use search bar to find files

## 🔧 API Documentation

### Authentication

**Sign Up**
```http
POST /api/auth/signup
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securepassword"
}
```

**Login**
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securepassword"
}
```

**Get Current User**
```http
GET /api/auth/me
Authorization: Bearer <token>
```

### Telegram

**Request QR Code**
```http
POST /api/telegram/request-qr
Authorization: Bearer <token>
```

**Verify QR Login**
```http
POST /api/telegram/verify-qr
Authorization: Bearer <token>
Content-Type: application/json

{
  "session_id": "uuid"
}
```

**Request Phone Code**
```http
POST /api/telegram/request-code
Authorization: Bearer <token>
Content-Type: application/json

{
  "phone": "+1234567890"
}
```

**Verify Phone Code**
```http
POST /api/telegram/verify-code
Authorization: Bearer <token>
Content-Type: application/json

{
  "phone": "+1234567890",
  "code": "12345",
  "phone_code_hash": "hash_from_request_code"
}
```

### Files

**List Files**
```http
GET /api/files?folder_id=<optional>
Authorization: Bearer <token>
```

**Create File Metadata**
```http
POST /api/files
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "photo.jpg",
  "size": 1024000,
  "mime_type": "image/jpeg",
  "telegram_msg_id": 123,
  "thumbnail_url": "https://...",
  "thumbnail_provider": "cloudinary"
}
```

**Update File**
```http
PUT /api/files/{file_id}
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "new_name.jpg"
}
```

**Delete File**
```http
DELETE /api/files/{file_id}?permanent=false
Authorization: Bearer <token>
```

**Share File**
```http
POST /api/files/{file_id}/share
Authorization: Bearer <token>
```

### Folders

**List Folders**
```http
GET /api/folders?parent_id=<optional>
Authorization: Bearer <token>
```

**Create Folder**
```http
POST /api/folders
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "My Folder",
  "parent_id": null
}
```

## 🔐 Security

- **Password Hashing**: bcrypt with salt
- **JWT Authentication**: Secure token-based auth
- **Private Channels**: Files stored in user's private Telegram channel
- **Session Security**: Telegram session strings encrypted
- **CORS Protection**: Configurable origins
- **API Key Encryption**: Stored securely in database

## 🎨 UI/UX Features

- **Modern Design**: Clean, professional interface
- **Responsive**: Works on desktop, tablet, and mobile
- **Dark Mode Ready**: Easy to implement
- **Smooth Animations**: Polished user experience
- **Intuitive Navigation**: Easy to use for non-technical users
- **Toast Notifications**: Real-time feedback
- **Loading States**: Clear progress indicators

## 📦 Tech Stack

### Backend
- **FastAPI**: Modern Python web framework
- **Motor**: Async MongoDB driver
- **Telethon**: Telegram client library
- **Pydantic**: Data validation
- **JWT**: Authentication
- **bcrypt**: Password hashing

### Frontend
- **React 19**: Latest React version
- **React Router**: Navigation
- **Axios**: HTTP client
- **Shadcn UI**: Component library
- **Tailwind CSS**: Styling
- **Lucide React**: Icons
- **Sonner**: Toast notifications

### Database
- **MongoDB**: NoSQL database for metadata

### Storage
- **Telegram**: Primary file storage
- **Cloudinary**: Thumbnail storage (optional)
- **ImgBB**: Alternative thumbnail storage (optional)

## 🐛 Troubleshooting

### Backend Issues

**"Invalid telegram credentials"**
- Get api_id and api_hash from https://my.telegram.org
- Add them to backend/.env
- Restart backend

**"MongoDB connection failed"**
- Ensure MongoDB is running
- Check MONGO_URL in .env

### Frontend Issues

**"Network Error"**
- Check REACT_APP_BACKEND_URL in frontend/.env
- Ensure backend is running
- Check CORS settings

### Telegram Issues

**"QR code expired"**
- Generate a new QR code
- Scan within 30 seconds

**"Chat not found"**
- Ensure bot is admin in channel
- Channel ID should be `-100XXXXXXXXXX` format

**"Session expired"**
- Re-login to Telegram in Settings
- Update worker with new session string

### Worker Issues

**"File upload failed"**
- Check worker logs
- Verify Telegram bot token
- Ensure bot has admin access to channel
- Check worker environment variables

## 🚀 Deployment

### Backend (Vercel/Render)

**Vercel**
```bash
cd backend
vercel deploy
```

**Render**
1. Connect GitHub repo
2. Set environment variables
3. Deploy

### Frontend (Vercel/Netlify)

**Vercel**
```bash
cd frontend
vercel deploy
```

**Netlify**
```bash
cd frontend
netlify deploy --prod
```

### Database (MongoDB Atlas)

1. Create cluster at https://cloud.mongodb.com
2. Get connection string
3. Update MONGO_URL in backend .env

## 📝 Environment Variables Reference

### Backend
| Variable | Description | Required |
|----------|-------------|----------|
| MONGO_URL | MongoDB connection string | Yes |
| DB_NAME | Database name | Yes |
| JWT_SECRET_KEY | Secret key for JWT | Yes |
| TELEGRAM_API_ID | Telegram API ID | Yes |
| TELEGRAM_API_HASH | Telegram API hash | Yes |
| CORS_ORIGINS | Allowed origins (comma-separated) | No |

### Frontend
| Variable | Description | Required |
|----------|-------------|----------|
| REACT_APP_BACKEND_URL | Backend API URL | Yes |

### Worker
| Variable | Description | Required |
|----------|-------------|----------|
| TELEGRAM_BOT_TOKEN | Bot token from @BotFather | Yes |
| TELEGRAM_CHANNEL_ID | Private channel ID | Yes |
| BACKEND_URL | TeleStore backend URL | Yes |

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

MIT License - feel free to use this project for personal or commercial purposes.

## 🙏 Acknowledgments

- Telegram for their excellent API and unlimited storage
- FastAPI for the amazing Python framework
- React team for React 19
- Shadcn for beautiful UI components
- Emergent Labs for the development platform

## 📞 Support

For issues and questions:
1. Check the Troubleshooting section
2. Review worker-templates/README.md
3. Check backend logs: `tail -f /var/log/supervisor/backend.*.log`
4. Check frontend console for errors

## 🗺️ Roadmap

- [ ] Telegram bot for auto-sync
- [ ] Folder upload support
- [ ] Bulk operations
- [ ] File versioning
- [ ] Collaborative sharing
- [ ] Mobile app (React Native)
- [ ] Desktop app (Electron)
- [ ] End-to-end encryption
- [ ] File preview (PDF, videos)
- [ ] Search improvements
- [ ] Analytics dashboard

---

Made with ❤️ using FastAPI, React, and Telegram
