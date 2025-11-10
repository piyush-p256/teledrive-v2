// Cloudflare Worker for TeleStore File Upload
// Deploy this to your Cloudflare Workers account

// Configuration - only set BACKEND_URL, credentials will be fetched automatically
const CONFIG = {
  BACKEND_URL: 'https://full-stack-run.preview.emergentagent.com', // Your TeleStore backend
  MAX_FILE_SIZE: 2000 * 1024 * 1024, // 2GB limit for Telegram
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

// Helper to add CORS headers
function addCorsHeaders(response) {
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return response;
}

// Storage for chunked uploads (using KV would be better for production)
const chunkStorage = new Map();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return addCorsHeaders(new Response(null, { status: 204 }));
    }

    // Route requests based on path
    if (url.pathname === '/init-upload') {
      return handleInitUpload(request);
    } else if (url.pathname === '/upload-chunk') {
      return handleUploadChunk(request);
    } else if (url.pathname === '/complete-upload') {
      return handleCompleteUpload(request);
    } else if (url.pathname === '/' || url.pathname === '/upload') {
      return handleDirectUpload(request);
    }

    return addCorsHeaders(new Response('Not found', { status: 404 }));
  }
};

// Initialize chunked upload
async function handleInitUpload(request) {
  try {
    const data = await request.json();
    const { uploadId, fileName, totalChunks } = data;
    
    chunkStorage.set(uploadId, {
      fileName,
      totalChunks,
      chunks: new Map(),
      timestamp: Date.now()
    });
    
    return addCorsHeaders(new Response(JSON.stringify({
      success: true,
      uploadId
    }), {
      headers: { 'Content-Type': 'application/json' }
    }));
  } catch (error) {
    return addCorsHeaders(new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    }));
  }
}

// Upload a chunk
async function handleUploadChunk(request) {
  try {
    const formData = await request.formData();
    const uploadId = formData.get('uploadId');
    const chunkIndex = parseInt(formData.get('chunkIndex'));
    const chunk = formData.get('chunk');
    
    if (!chunk) {
      return addCorsHeaders(new Response(JSON.stringify({ error: 'No chunk provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      }));
    }
    
    const session = chunkStorage.get(uploadId);
    if (!session) {
      return addCorsHeaders(new Response(JSON.stringify({ error: 'Upload session not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      }));
    }
    
    // Store chunk
    const chunkData = await chunk.arrayBuffer();
    session.chunks.set(chunkIndex, chunkData);
    
    return addCorsHeaders(new Response(JSON.stringify({
      success: true,
      chunkIndex,
      uploadedChunks: session.chunks.size
    }), {
      headers: { 'Content-Type': 'application/json' }
    }));
  } catch (error) {
    return addCorsHeaders(new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    }));
  }
}

// Complete chunked upload
async function handleCompleteUpload(request) {
  try {
    const data = await request.json();
    const { uploadId, userId, authToken } = data;
    
    const session = chunkStorage.get(uploadId);
    if (!session) {
      return addCorsHeaders(new Response(JSON.stringify({ error: 'Upload session not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      }));
    }
    
    const { fileName, totalChunks, chunks } = session;
    
    // Check if all chunks are uploaded
    if (chunks.size !== totalChunks) {
      return addCorsHeaders(new Response(JSON.stringify({
        error: `Missing chunks. Expected ${totalChunks}, got ${chunks.size}`
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      }));
    }
    
    // Reassemble file
    const fileChunks = [];
    for (let i = 0; i < totalChunks; i++) {
      fileChunks.push(chunks.get(i));
    }
    const fileData = new Blob(fileChunks);
    
    // Fetch credentials
    const credentials = await getCredentials(userId, authToken);
    
    // Upload to Telegram
    const telegramFormData = new FormData();
    telegramFormData.append('chat_id', credentials.channel_id);
    telegramFormData.append('document', fileData, fileName);
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
    const result = telegramResult.result;
    const fileId = result.document?.file_id || 
                   result.video?.file_id || 
                   result.audio?.file_id || 
                   result.photo?.[0]?.file_id || null;
    
    if (!fileId) {
      throw new Error('Failed to get file_id from Telegram response');
    }
    
    // Clean up
    chunkStorage.delete(uploadId);
    
    // Notify backend
    await fetch(`${CONFIG.BACKEND_URL}/api/webhook/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        fileName,
        messageId,
        fileId,
        size: fileData.size,
        mimeType: 'application/octet-stream',
      })
    });
    
    return addCorsHeaders(new Response(JSON.stringify({
      success: true,
      messageId,
      fileId,
      fileName
    }), {
      headers: { 'Content-Type': 'application/json' }
    }));
  } catch (error) {
    return addCorsHeaders(new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    }));
  }
}

// Handle direct (non-chunked) upload
async function handleDirectUpload(request) {
  if (request.method !== 'POST') {
    return addCorsHeaders(new Response('Method not allowed', { status: 405 }));
  }

    try {
      const formData = await request.formData();
      const file = formData.get('file');
      const userId = formData.get('userId');
      const authToken = formData.get('authToken'); // User's auth token for fetching credentials
      const fileName = formData.get('fileName') || file.name;

      if (!file) {
        return addCorsHeaders(new Response(JSON.stringify({ error: 'No file provided' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }));
      }

      if (!authToken) {
        return addCorsHeaders(new Response(JSON.stringify({ error: 'Auth token required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }));
      }

      // Check file size
      if (file.size > CONFIG.MAX_FILE_SIZE) {
        return addCorsHeaders(new Response(JSON.stringify({ error: 'File too large (max 2GB)' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }));
      }

      // Fetch credentials from backend (or use cache)
      const credentials = await getCredentials(userId, authToken);

      // Convert file to buffer
      const arrayBuffer = await file.arrayBuffer();
      const buffer = new Uint8Array(arrayBuffer);

      // Upload to Telegram using bot API
      const telegramFormData = new FormData();
      telegramFormData.append('chat_id', credentials.channel_id);
      telegramFormData.append('document', new Blob([buffer]), fileName);
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

      // Note: File metadata is created by the frontend after upload
      // No need to notify backend here to avoid blocking the response

      return addCorsHeaders(new Response(
        JSON.stringify({
          success: true,
          messageId,
          fileId,
          fileName,
        }),
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      ));
    } catch (error) {
      return addCorsHeaders(new Response(
        JSON.stringify({ error: error.message }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
    }
  },
};
