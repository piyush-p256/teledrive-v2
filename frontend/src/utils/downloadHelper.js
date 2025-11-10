/**
 * Chunked Download Helper
 * Downloads large files in chunks to avoid timeout issues on free-tier hosting
 */

const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks
const MAX_RETRIES = 3;

/**
 * Download a file in chunks with progress tracking
 * @param {string} downloadUrl - The base download URL
 * @param {string} fileName - Name of the file to download
 * @param {number} fileSize - Total size of the file in bytes
 * @param {Function} onProgress - Progress callback (percent, downloaded, total)
 * @returns {Promise<void>}
 */
export async function downloadFileInChunks(downloadUrl, fileName, fileSize, onProgress) {
  try {
    // For small files (<20MB), just download directly
    if (fileSize < 20 * 1024 * 1024) {
      return await downloadDirectly(downloadUrl, fileName, onProgress);
    }

    console.log(`Starting chunked download: ${fileName} (${formatBytes(fileSize)})`);

    const chunks = [];
    const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);
    let downloadedBytes = 0;

    // Download each chunk
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE - 1, fileSize - 1);
      
      let chunk = null;
      let retries = 0;

      // Retry failed chunks
      while (retries < MAX_RETRIES) {
        try {
          chunk = await downloadChunk(downloadUrl, start, end);
          break;
        } catch (error) {
          retries++;
          console.warn(`Chunk ${i + 1}/${totalChunks} failed, retry ${retries}/${MAX_RETRIES}`, error);
          
          if (retries >= MAX_RETRIES) {
            throw new Error(`Failed to download chunk ${i + 1} after ${MAX_RETRIES} retries`);
          }
          
          // Wait before retry (exponential backoff)
          await sleep(1000 * Math.pow(2, retries - 1));
        }
      }

      chunks.push(chunk);
      downloadedBytes += chunk.byteLength;

      // Update progress
      const percent = Math.round((downloadedBytes / fileSize) * 100);
      if (onProgress) {
        onProgress(percent, downloadedBytes, fileSize);
      }

      console.log(`Downloaded chunk ${i + 1}/${totalChunks} (${percent}%)`);
    }

    // Combine chunks into a single Blob
    console.log('Combining chunks...');
    const blob = new Blob(chunks);

    // Trigger download
    triggerBrowserDownload(blob, fileName);

    console.log('Download complete!');
  } catch (error) {
    console.error('Chunked download failed:', error);
    throw error;
  }
}

/**
 * Download a single chunk using Range request
 */
async function downloadChunk(url, start, end) {
  const response = await fetch(url, {
    headers: {
      'Range': `bytes=${start}-${end}`
    }
  });

  if (!response.ok && response.status !== 206) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return await response.arrayBuffer();
}

/**
 * Download small files directly without chunking
 */
async function downloadDirectly(url, fileName, onProgress) {
  console.log(`Downloading directly: ${fileName}`);

  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  // Get total size from Content-Length header
  const contentLength = response.headers.get('Content-Length');
  const total = contentLength ? parseInt(contentLength, 10) : 0;

  // Read response as stream if supported, otherwise as blob
  if (response.body && response.body.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      
      if (done) break;
      
      chunks.push(value);
      received += value.length;

      if (onProgress && total) {
        const percent = Math.round((received / total) * 100);
        onProgress(percent, received, total);
      }
    }

    const blob = new Blob(chunks);
    triggerBrowserDownload(blob, fileName);
  } else {
    // Fallback: download as blob
    const blob = await response.blob();
    
    if (onProgress) {
      onProgress(100, blob.size, blob.size);
    }
    
    triggerBrowserDownload(blob, fileName);
  }

  console.log('Direct download complete!');
}

/**
 * Trigger browser download using <a> tag
 */
function triggerBrowserDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  
  // Clean up object URL after a delay
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Sleep utility
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Download file from API endpoint (handles auth and URL fetching)
 */
export async function downloadFile(fileId, fileName, fileSize, token, onProgress) {
  try {
    // Get download URL from backend
    const response = await fetch(
      `${process.env.REACT_APP_BACKEND_URL || import.meta.env.REACT_APP_BACKEND_URL}/api/files/${fileId}/download-url`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );

    if (!response.ok) {
      throw new Error('Failed to get download URL');
    }

    const data = await response.json();
    
    // Download the file in chunks
    await downloadFileInChunks(
      data.download_url,
      fileName,
      fileSize || data.size,
      onProgress
    );
  } catch (error) {
    console.error('Download failed:', error);
    throw error;
  }
}

/**
 * Download shared file (no auth required)
 */
export async function downloadSharedFile(shareToken, fileName, fileSize, onProgress) {
  try {
    // Get download URL from backend
    const response = await fetch(
      `${process.env.REACT_APP_BACKEND_URL || import.meta.env.REACT_APP_BACKEND_URL}/api/share/${shareToken}/download-url`
    );

    if (!response.ok) {
      throw new Error('Failed to get download URL');
    }

    const data = await response.json();
    
    // Download the file in chunks
    await downloadFileInChunks(
      data.download_url,
      fileName,
      fileSize || data.size,
      onProgress
    );
  } catch (error) {
    console.error('Shared file download failed:', error);
    throw error;
  }
}
