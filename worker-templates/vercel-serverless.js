// Vercel Serverless Function for TeleStore File Upload
// Place this in /api/upload.js in your Vercel project

import FormData from 'form-data';
import fetch from 'node-fetch';

// Configuration - only set BACKEND_URL, credentials will be fetched automatically
const CONFIG = {
  BACKEND_URL: process.env.BACKEND_URL || 'https://your-telestore-backend.com',
  MAX_FILE_SIZE: 2000 * 1024 * 1024,
  CACHE_DURATION: 3600000, // 1 hour in milliseconds
};

// In-memory cache for credentials
let credentialsCache = {
  data: null,
  timestamp: 0,
  userId: null
};

// Function to fetch credentials from backend
async function getCredentials(userId, authToken) {
  const now = Date.now();
  
  // Return cached credentials if still valid and for same user
  if (credentialsCache.data && 
      credentialsCache.userId === userId && 
      (now - credentialsCache.timestamp) < CONFIG.CACHE_DURATION) {
    return credentialsCache.data;
  }
  
  // Fetch fresh credentials from backend
  try {
    const response = await fetch(`${CONFIG.BACKEND_URL}/api/worker/credentials`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch credentials: ${response.statusText}`);
    }
    
    const credentials = await response.json();
    
    // Cache the credentials
    credentialsCache = {
      data: credentials,
      timestamp: now,
      userId: userId
    };
    
    return credentials;
  } catch (error) {
    // If cache exists, use it even if expired (fallback)
    if (credentialsCache.data && credentialsCache.userId === userId) {
      console.warn('Using expired cache due to fetch error:', error);
      return credentialsCache.data;
    }
    throw error;
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Parse multipart form data
    const formData = await parseFormData(req);
    const file = formData.file;
    const userId = formData.userId;
    const authToken = formData.authToken; // User's auth token for fetching credentials
    const fileName = formData.fileName || file.name;

    if (!file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    if (!authToken) {
      return res.status(400).json({ error: 'Auth token required' });
    }

    if (file.size > CONFIG.MAX_FILE_SIZE) {
      return res.status(400).json({ error: 'File too large (max 2GB)' });
    }

    // Fetch credentials from backend (or use cache)
    const credentials = await getCredentials(userId, authToken);

    // Upload to Telegram
    const telegramFormData = new FormData();
    telegramFormData.append('chat_id', credentials.channel_id);
    telegramFormData.append('document', file.buffer, fileName);
    telegramFormData.append('caption', `Uploaded: ${fileName}`);

    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${credentials.bot_token}/sendDocument`,
      {
        method: 'POST',
        body: telegramFormData,
      }
    );

    const telegramResult = await telegramResponse.json();

    if (!telegramResult.ok) {
      throw new Error(telegramResult.description || 'Telegram upload failed');
    }

    const messageId = telegramResult.result.message_id;
    
    // Telegram returns different properties based on file type
    // Videos: result.video, Documents: result.document, Audio: result.audio, Photos: result.photo
    const fileId = telegramResult.result.document?.file_id 
      || telegramResult.result.video?.file_id
      || telegramResult.result.audio?.file_id
      || telegramResult.result.photo?.[0]?.file_id
      || null;
    
    if (!fileId) {
      throw new Error('Failed to get file_id from Telegram response');
    }

    // Notify backend
    await fetch(`${CONFIG.BACKEND_URL}/api/webhook/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        fileName,
        messageId,
        fileId,
        size: file.size,
        mimeType: file.type,
      }),
    });

    return res.status(200).json({
      success: true,
      messageId,
      fileId,
      fileName,
    });
  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// Helper to parse form data
async function parseFormData(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      // Simplified parser - use busboy or formidable in production
      resolve({ file: {}, userId: '', fileName: '' });
    });
    req.on('error', reject);
  });
}
