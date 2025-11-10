/**
 * Chunked File Upload Utility
 * Handles large file uploads with chunking, progress tracking, pause/resume
 */

const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks (safe for Render free tier)
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds

/**
 * Generate unique upload ID
 */
export function generateUploadId() {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * ChunkedUploader class for handling file uploads
 */
export class ChunkedUploader {
  constructor(file, workerUrl, authToken, options = {}) {
    this.file = file;
    this.workerUrl = workerUrl;
    this.authToken = authToken;
    this.uploadId = generateUploadId();
    this.chunkSize = options.chunkSize || CHUNK_SIZE;
    this.maxRetries = options.maxRetries || MAX_RETRIES;
    
    this.totalChunks = Math.ceil(file.size / this.chunkSize);
    this.uploadedChunks = new Set();
    this.paused = false;
    this.cancelled = false;
    this.currentChunkIndex = 0;
    
    // Progress tracking
    this.uploadedSize = 0;
    this.startTime = null;
    this.lastProgressTime = null;
    this.lastUploadedSize = 0;
    
    // Callbacks
    this.onProgress = options.onProgress || (() => {});
    this.onComplete = options.onComplete || (() => {});
    this.onError = options.onError || (() => {});
    this.onPause = options.onPause || (() => {});
    this.onResume = options.onResume || (() => {});
    
    // Load saved progress from localStorage
    this.loadProgress();
  }

  /**
   * Load progress from localStorage for resume capability
   */
  loadProgress() {
    try {
      const savedKey = `upload_${this.file.name}_${this.file.size}`;
      const savedData = localStorage.getItem(savedKey);
      if (savedData) {
        const { uploadId, uploadedChunks } = JSON.parse(savedData);
        this.uploadId = uploadId;
        this.uploadedChunks = new Set(uploadedChunks);
        this.uploadedSize = this.uploadedChunks.size * this.chunkSize;
        this.currentChunkIndex = this.uploadedChunks.size;
      }
    } catch (error) {
      console.error('Failed to load upload progress:', error);
    }
  }

  /**
   * Save progress to localStorage
   */
  saveProgress() {
    try {
      const savedKey = `upload_${this.file.name}_${this.file.size}`;
      const data = {
        uploadId: this.uploadId,
        uploadedChunks: Array.from(this.uploadedChunks),
        timestamp: Date.now()
      };
      localStorage.setItem(savedKey, JSON.stringify(data));
    } catch (error) {
      console.error('Failed to save upload progress:', error);
    }
  }

  /**
   * Clear saved progress
   */
  clearProgress() {
    try {
      const savedKey = `upload_${this.file.name}_${this.file.size}`;
      localStorage.removeItem(savedKey);
    } catch (error) {
      console.error('Failed to clear upload progress:', error);
    }
  }

  /**
   * Calculate upload speed and ETA
   */
  calculateStats() {
    const now = Date.now();
    
    if (!this.startTime) {
      this.startTime = now;
      this.lastProgressTime = now;
      this.lastUploadedSize = this.uploadedSize;
    }

    // Calculate speed (bytes per second) using recent progress
    const timeDiff = (now - this.lastProgressTime) / 1000; // seconds
    const sizeDiff = this.uploadedSize - this.lastUploadedSize;
    const speed = timeDiff > 0 ? sizeDiff / timeDiff : 0;

    // Calculate ETA
    const remainingSize = this.file.size - this.uploadedSize;
    const eta = speed > 0 ? remainingSize / speed : 0;

    // Update for next calculation
    this.lastProgressTime = now;
    this.lastUploadedSize = this.uploadedSize;

    return { speed, eta };
  }

  /**
   * Upload a single chunk with retry logic
   */
  async uploadChunk(chunkIndex, retryCount = 0) {
    if (this.cancelled) {
      throw new Error('Upload cancelled');
    }

    if (this.paused) {
      return false; // Signal to pause
    }

    // Skip if already uploaded
    if (this.uploadedChunks.has(chunkIndex)) {
      return true;
    }

    try {
      const start = chunkIndex * this.chunkSize;
      const end = Math.min(start + this.chunkSize, this.file.size);
      const chunk = this.file.slice(start, end);

      const formData = new FormData();
      formData.append('chunk', chunk);
      formData.append('uploadId', this.uploadId);
      formData.append('chunkIndex', chunkIndex);
      formData.append('totalChunks', this.totalChunks);
      formData.append('fileName', this.file.name);
      formData.append('fileSize', this.file.size);
      formData.append('authToken', this.authToken);

      const response = await fetch(`${this.workerUrl}/upload-chunk`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Chunk upload failed');
      }

      const result = await response.json();

      // Mark chunk as uploaded
      this.uploadedChunks.add(chunkIndex);
      this.uploadedSize = this.uploadedChunks.size * this.chunkSize;
      
      // Save progress
      this.saveProgress();

      // Calculate and report progress (0-100% for uploading to render)
      const chunkProgress = (this.uploadedChunks.size / this.totalChunks) * 100;
      const { speed, eta } = this.calculateStats();
      
      this.onProgress({
        progress: chunkProgress,
        uploadedSize: this.uploadedSize,
        totalSize: this.file.size,
        uploadedChunks: this.uploadedChunks.size,
        totalChunks: this.totalChunks,
        speed,
        eta,
        chunkIndex,
        phase: 'uploading', // Phase 1: Uploading to render
        phaseDescription: 'Uploading to server'
      });

      return true;

    } catch (error) {
      console.error(`Error uploading chunk ${chunkIndex}:`, error);

      // Retry logic
      if (retryCount < this.maxRetries) {
        console.log(`Retrying chunk ${chunkIndex} (attempt ${retryCount + 1}/${this.maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        return this.uploadChunk(chunkIndex, retryCount + 1);
      }

      throw error;
    }
  }

  /**
   * Complete the upload after all chunks are uploaded
   */
  async completeUpload() {
    try {
      // Step 1: Tell worker to merge chunks and start background upload
      const response = await fetch(`${this.workerUrl}/complete-upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          uploadId: this.uploadId,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to complete upload');
      }

      const result = await response.json();
      const { uploadId } = result;
      
      console.log('Upload started in background, polling for progress...');
      
      // Step 2: Poll for upload progress
      const finalResult = await this.pollUploadProgress(uploadId);
      
      // Clear saved progress
      this.clearProgress();
      
      return finalResult;

    } catch (error) {
      console.error('Error completing upload:', error);
      throw error;
    }
  }

  /**
   * Poll for background upload progress
   */
  async pollUploadProgress(uploadId, maxAttempts = 600) {
    let attempts = 0;
    
    // Reset timing for telegram upload phase
    this.startTime = null;
    this.lastProgressTime = null;
    this.lastUploadedSize = 0;
    
    while (attempts < maxAttempts) {
      try {
        const response = await fetch(`${this.workerUrl}/upload-progress/${uploadId}`);
        
        if (!response.ok) {
          // If upload hasn't started yet, wait and retry
          if (response.status === 404 && attempts < 10) {
            console.log('Upload not started yet, waiting...');
            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts++;
            continue;
          }
          throw new Error('Failed to fetch upload progress');
        }
        
        const data = await response.json();
        
        // Telegram upload progress: 0-100% (separate from chunk upload)
        const telegramProgress = data.progress || 0;
        
        // Keep uploadedSize at full file size during telegram upload
        // (we're not measuring bytes, just progress percentage)
        const uploadedSize = this.file.size;
        
        // Calculate speed and ETA for telegram upload phase
        const { speed, eta } = this.calculateStats();
        
        // Call onProgress with Phase 2 information
        this.onProgress({ 
          progress: telegramProgress,
          uploadedSize: uploadedSize,
          totalSize: this.file.size,
          uploadedChunks: this.totalChunks, // All chunks uploaded
          totalChunks: this.totalChunks,
          speed: speed,
          eta: eta,
          phase: 'telegram', // Phase 2: Uploading to Telegram
          phaseDescription: 'Uploading to Telegram',
          telegramProgress: telegramProgress // Track telegram-specific progress
        });
        
        console.log(`Telegram upload progress: ${data.progress}% (status: ${data.status})`);
        
        if (data.status === 'completed') {
          console.log('Upload completed successfully!');
          
          // Final progress update at 100%
          this.onProgress({ 
            progress: 100,
            uploadedSize: this.file.size,
            totalSize: this.file.size,
            uploadedChunks: this.totalChunks,
            totalChunks: this.totalChunks,
            speed: 0,
            eta: 0,
            phase: 'completed',
            phaseDescription: 'Upload complete',
            telegramProgress: 100
          });
          
          return {
            success: true,
            messageId: data.messageId,
            fileId: data.fileId,
            fileName: this.file.name
          };
        }
        
        if (data.status === 'failed') {
          throw new Error(data.error || 'Upload failed');
        }
        
        // Wait 1 second before next poll
        await new Promise(resolve => setTimeout(resolve, 1000));
        attempts++;
        
      } catch (error) {
        console.error('Error polling progress:', error);
        
        // Retry polling on network errors (but not on permanent errors)
        if (attempts < maxAttempts && !error.message.includes('Upload failed')) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          attempts++;
          continue;
        }
        
        throw error;
      }
    }
    
    throw new Error('Upload timeout - took longer than expected');
  }

  /**
   * Start or resume upload
   */
  async start() {
    try {
      this.cancelled = false;
      this.paused = false;

      // Upload chunks sequentially
      for (let i = 0; i < this.totalChunks; i++) {
        if (this.cancelled) {
          throw new Error('Upload cancelled');
        }

        if (this.paused) {
          this.onPause();
          return; // Exit early if paused
        }

        this.currentChunkIndex = i;
        await this.uploadChunk(i);
      }

      // All chunks uploaded, complete the upload
      const result = await this.completeUpload();
      this.onComplete(result);
      
      return result;

    } catch (error) {
      console.error('Upload error:', error);
      this.onError(error);
      throw error;
    }
  }

  /**
   * Pause upload
   */
  pause() {
    if (!this.paused && !this.cancelled) {
      this.paused = true;
      this.onPause();
    }
  }

  /**
   * Resume upload
   */
  resume() {
    if (this.paused && !this.cancelled) {
      this.paused = false;
      this.onResume();
      // Continue from current chunk
      this.start();
    }
  }

  /**
   * Cancel upload and clean up
   */
  async cancel() {
    this.cancelled = true;
    this.paused = false;

    try {
      // Notify server to clean up chunks
      await fetch(`${this.workerUrl}/cancel-upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          uploadId: this.uploadId,
        }),
      });
    } catch (error) {
      console.error('Error cancelling upload:', error);
    }

    // Clear saved progress
    this.clearProgress();
  }

  /**
   * Get upload status from server (for resume)
   */
  async getStatus() {
    try {
      const response = await fetch(`${this.workerUrl}/upload-status/${this.uploadId}`);
      
      if (!response.ok) {
        return null;
      }

      return await response.json();
    } catch (error) {
      console.error('Error getting upload status:', error);
      return null;
    }
  }
}

/**
 * Helper function to check if file should use chunked upload
 */
export function shouldUseChunkedUpload(fileSize) {
  const CHUNKED_THRESHOLD = 8 * 1024 * 1024; // 8MB (safe for Render free tier)
  return fileSize > CHUNKED_THRESHOLD;
}
