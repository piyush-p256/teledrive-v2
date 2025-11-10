// Cloudflare Worker for TeleStore File Upload with Chunked Upload Support
// Deploy this to your Cloudflare Workers account with Durable Objects enabled
// Supports large files up to 2GB with 50MB chunks

// Configuration - only set BACKEND_URL, credentials will be fetched automatically
const CONFIG = {
  BACKEND_URL: 'https://your-telestore-backend.com', // Your TeleStore backend
  MAX_FILE_SIZE: 2000 * 1024 * 1024, // 2GB limit for Telegram
  CHUNK_SIZE: 50 * 1024 * 1024, // 50MB chunks
  CACHE_DURATION: 3600000, // 1 hour in milliseconds
};

// In-memory cache for credentials
let credentialsCache = {
  data: null,
  timestamp: 0,
  userId: null
};

// In-memory storage for upload chunks (per-worker instance)
// Note: In production, you'd want to use Durable Objects or R2 for persistence
let uploadSessions = new Map();

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

// Handle chunk upload
async function handleChunkUpload(request) {
  const formData = await request.formData();
  
  const chunk = formData.get('chunk');
  const uploadId = formData.get('uploadId');
  const chunkIndex = parseInt(formData.get('chunkIndex'));
  const totalChunks = parseInt(formData.get('totalChunks'));
  const fileName = formData.get('fileName');
  const fileSize = parseInt(formData.get('fileSize'));
  const authToken = formData.get('authToken');
  const userId = formData.get('userId');

  if (!chunk || !uploadId || !fileName || !authToken) {
    return new Response(JSON.stringify({ error: 'Missing required parameters' }), {
      status: 400,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  // Get or create upload session
  if (!uploadSessions.has(uploadId)) {
    uploadSessions.set(uploadId, {
      uploadId,
      fileName,
      fileSize,
      totalChunks,
      receivedChunks: new Map(),
      userId,
      authToken,
      createdAt: Date.now(),
    });
  }

  const session = uploadSessions.get(uploadId);
  
  // Store chunk data
  const chunkBuffer = await chunk.arrayBuffer();
  session.receivedChunks.set(chunkIndex, new Uint8Array(chunkBuffer));

  const allReceived = session.receivedChunks.size === totalChunks;

  return new Response(JSON.stringify({
    success: true,
    chunk_index: chunkIndex,
    received_chunks: session.receivedChunks.size,
    total_chunks: totalChunks,
    complete: allReceived,
  }), {
    headers: { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// Handle complete upload - merge chunks and upload to Telegram
async function handleCompleteUpload(request) {
  const { uploadId } = await request.json();

  if (!uploadId) {
    return new Response(JSON.stringify({ error: 'Missing upload ID' }), {
      status: 400,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  const session = uploadSessions.get(uploadId);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Upload session not found' }), {
      status: 404,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  // Verify all chunks received
  if (session.receivedChunks.size !== session.totalChunks) {
    return new Response(JSON.stringify({
      error: 'Not all chunks received',
      received: session.receivedChunks.size,
      total: session.totalChunks,
    }), {
      status: 400,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  try {
    // Merge chunks in order
    const chunks = [];
    for (let i = 0; i < session.totalChunks; i++) {
      const chunk = session.receivedChunks.get(i);
      if (!chunk) {
        throw new Error(`Missing chunk ${i}`);
      }
      chunks.push(chunk);
    }

    // Concatenate all chunks
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const mergedFile = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      mergedFile.set(chunk, offset);
      offset += chunk.length;
    }

    // Get credentials
    const credentials = await getCredentials(session.userId, session.authToken);

    // Create FormData for Telegram upload
    const telegramFormData = new FormData();
    const fileBlob = new Blob([mergedFile], { type: 'application/octet-stream' });
    telegramFormData.append('document', fileBlob, session.fileName);
    telegramFormData.append('chat_id', credentials.channel_id);
    telegramFormData.append('caption', `Uploaded: ${session.fileName}`);

    // Upload to Telegram
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
    
    // Extract file_id from different file types
    const result = telegramResult.result;
    const fileId = 
      result.document?.file_id ||
      result.video?.file_id ||
      result.audio?.file_id ||
      (result.photo && result.photo[0]?.file_id) ||
      null;

    if (!fileId) {
      throw new Error('Failed to get file_id from Telegram response');
    }

    // Notify backend
    await fetch(`${CONFIG.BACKEND_URL}/api/webhook/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: session.userId,
        fileName: session.fileName,
        messageId: messageId,
        fileId: fileId,
        size: session.fileSize,
        mimeType: 'application/octet-stream',
      }),
    });

    // Clean up session
    uploadSessions.delete(uploadId);

    return new Response(JSON.stringify({
      success: true,
      messageId: messageId,
      fileId: fileId,
      fileName: session.fileName,
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });

  } catch (error) {
    // Clean up on error
    uploadSessions.delete(uploadId);

    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}

// Handle upload status query
async function handleUploadStatus(uploadId) {
  const session = uploadSessions.get(uploadId);
  
  if (!session) {
    return new Response(JSON.stringify({ error: 'Upload session not found' }), {
      status: 404,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  const receivedChunkIndices = Array.from(session.receivedChunks.keys());

  return new Response(JSON.stringify({
    upload_id: uploadId,
    file_name: session.fileName,
    total_chunks: session.totalChunks,
    received_chunks: session.receivedChunks.size,
    received_chunk_indices: receivedChunkIndices,
    complete: session.receivedChunks.size === session.totalChunks,
  }), {
    headers: { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// Handle cancel upload
async function handleCancelUpload(request) {
  const { uploadId } = await request.json();

  if (!uploadId) {
    return new Response(JSON.stringify({ error: 'Missing upload ID' }), {
      status: 400,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  uploadSessions.delete(uploadId);

  return new Response(JSON.stringify({ success: true, message: 'Upload cancelled' }), {
    headers: { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// Legacy single upload endpoint for backwards compatibility
async function handleLegacyUpload(request) {
  const formData = await request.formData();
  const file = formData.get('file');
  const authToken = formData.get('authToken');
  const fileName = formData.get('fileName') || file.name;

  if (!file) {
    return new Response(JSON.stringify({ error: 'No file provided' }), {
      status: 400,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  if (!authToken) {
    return new Response(JSON.stringify({ error: 'Auth token required' }), {
      status: 400,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  if (file.size > CONFIG.MAX_FILE_SIZE) {
    return new Response(JSON.stringify({ error: 'File too large (max 2GB)' }), {
      status: 400,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  try {
    // Fetch credentials
    const credentials = await getCredentials(null, authToken);

    // Upload to Telegram
    const telegramFormData = new FormData();
    telegramFormData.append('document', file, fileName);
    telegramFormData.append('chat_id', credentials.channel_id);
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
    const fileId = 
      result.document?.file_id ||
      result.video?.file_id ||
      result.audio?.file_id ||
      (result.photo && result.photo[0]?.file_id) ||
      null;

    if (!fileId) {
      throw new Error('Failed to get file_id from Telegram response');
    }

    // Notify backend
    await fetch(`${CONFIG.BACKEND_URL}/api/webhook/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: fileName,
        messageId: messageId,
        fileId: fileId,
        size: file.size,
        mimeType: file.type,
      }),
    });

    return new Response(JSON.stringify({
      success: true,
      messageId: messageId,
      fileId: fileId,
      fileName: fileName,
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}

// Main request handler
export default {
  async fetch(request, env) {
    // Handle CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    const url = new URL(request.url);
    
    try {
      // Route requests
      if (url.pathname === '/upload-chunk' && request.method === 'POST') {
        return await handleChunkUpload(request);
      }
      
      if (url.pathname === '/complete-upload' && request.method === 'POST') {
        return await handleCompleteUpload(request);
      }
      
      if (url.pathname.startsWith('/upload-status/') && request.method === 'GET') {
        const uploadId = url.pathname.split('/').pop();
        return await handleUploadStatus(uploadId);
      }
      
      if (url.pathname === '/cancel-upload' && request.method === 'POST') {
        return await handleCancelUpload(request);
      }
      
      // Legacy /upload endpoint for backwards compatibility
      if (url.pathname === '/upload' && request.method === 'POST') {
        return await handleLegacyUpload(request);
      }
      
      // Default/root endpoint also handles legacy uploads
      if (url.pathname === '/' && request.method === 'POST') {
        return await handleLegacyUpload(request);
      }

      return new Response('Not found', { status: 404 });

    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
  },
};
