import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { API } from '../App';
import { Button } from './ui/button';
import { X, ChevronLeft, ChevronRight, Loader2, Play, Pause, SkipForward, SkipBack, Download, Maximize, Minimize, Gauge, FileText } from 'lucide-react';
import { toast } from 'sonner';
import PDFViewer from './PDFViewer';

// Cache manager for Telegram image URLs
const IMAGE_CACHE_KEY = 'telegram_image_cache';
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour in milliseconds

const ImageCache = {
  // Get cached URL if not expired
  get(photoId) {
    try {
      const cache = JSON.parse(localStorage.getItem(IMAGE_CACHE_KEY) || '{}');
      const cached = cache[photoId];
      
      if (!cached) return null;
      
      const now = Date.now();
      if (now - cached.timestamp > CACHE_DURATION) {
        // Cache expired, remove it
        this.remove(photoId);
        return null;
      }
      
      console.log(`✅ Using cached URL for image ${photoId}`);
      return cached.url;
    } catch (error) {
      console.error('Cache read error:', error);
      return null;
    }
  },

  // Store URL in cache with timestamp
  set(photoId, url) {
    try {
      const cache = JSON.parse(localStorage.getItem(IMAGE_CACHE_KEY) || '{}');
      cache[photoId] = {
        url: url,
        timestamp: Date.now()
      };
      localStorage.setItem(IMAGE_CACHE_KEY, JSON.stringify(cache));
      console.log(`💾 Cached URL for image ${photoId}`);
    } catch (error) {
      console.error('Cache write error:', error);
    }
  },

  // Remove specific cached entry
  remove(photoId) {
    try {
      const cache = JSON.parse(localStorage.getItem(IMAGE_CACHE_KEY) || '{}');
      delete cache[photoId];
      localStorage.setItem(IMAGE_CACHE_KEY, JSON.stringify(cache));
    } catch (error) {
      console.error('Cache remove error:', error);
    }
  },

  // Clean up expired entries
  cleanup() {
    try {
      const cache = JSON.parse(localStorage.getItem(IMAGE_CACHE_KEY) || '{}');
      const now = Date.now();
      let cleaned = false;

      Object.keys(cache).forEach(photoId => {
        if (now - cache[photoId].timestamp > CACHE_DURATION) {
          delete cache[photoId];
          cleaned = true;
        }
      });

      if (cleaned) {
        localStorage.setItem(IMAGE_CACHE_KEY, JSON.stringify(cache));
        console.log('🧹 Cleaned expired cache entries');
      }
    } catch (error) {
      console.error('Cache cleanup error:', error);
    }
  }
};

export default function ImageGalleryModal({ photos, initialIndex = 0, onClose }) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [imageUrl, setImageUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // Video/Audio player state
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const containerRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const controlsTimeoutRef = useRef(null);
  const [downloading, setDownloading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [volume, setVolume] = useState(1);

  // Clean up expired cache on mount
  useEffect(() => {
    ImageCache.cleanup();
  }, []);

  // Load image from cache or Telegram
  const loadImage = useCallback(async (photoId) => {
    if (!photoId) return;
    
    setLoading(true);
    setError(null);
    setImageUrl(null);

    const currentPhoto = photos[currentIndex];
    const fileSize = currentPhoto?.size || 0;
    const isVideo = currentPhoto?.mime_type?.startsWith('video/');
    const isAudio = currentPhoto?.mime_type?.startsWith('audio/');
    const BOT_API_LIMIT = 20 * 1024 * 1024; // 20 MB
    
    // Only use cache for small files (<20MB)
    // Large files use worker streaming with JWT tokens that expire
    if (fileSize < BOT_API_LIMIT && !isAudio) {
      const cachedUrl = ImageCache.get(photoId);
      if (cachedUrl) {
        setImageUrl(cachedUrl);
        setLoading(false);
        return;
      }
    }

    // Fetch from Telegram if not cached or large file
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`${API}/files/${photoId}/download-url`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const url = response.data.download_url;
      const type = response.data.type;
      
      // Use streaming URL directly - browser handles progressive loading via Range requests
      // This works for both small and large files, videos/audio will start playing immediately
      console.log(`Loading ${type === 'stream' ? 'streaming' : 'direct'} URL for: ${currentPhoto.name} (${(fileSize / (1024 * 1024)).toFixed(2)} MB)`);
      
      // Only cache direct Bot API URLs (small files), not worker streaming URLs (large files)
      if (type === 'direct' && fileSize < BOT_API_LIMIT && !isAudio) {
        ImageCache.set(photoId, url);
      }
      
      setImageUrl(url);
    } catch (err) {
      console.error('Failed to load media:', err);
      setError(err.message || 'Failed to load media from Telegram');
      toast.error(err.message || 'Failed to load media');
    } finally {
      setLoading(false);
    }
  }, [photos, currentIndex]);

  // Load current media when index changes
  useEffect(() => {
    if (photos && photos[currentIndex]) {
      loadImage(photos[currentIndex].id);
      // Reset video state when switching files
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
    }
  }, [currentIndex, photos, loadImage]);

  // Navigation handlers
  const goToPrevious = useCallback(() => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : photos.length - 1));
  }, [photos.length]);

  const goToNext = useCallback(() => {
    setCurrentIndex((prev) => (prev < photos.length - 1 ? prev + 1 : 0));
  }, [photos.length]);

  // Keyboard navigation and controls
  useEffect(() => {
    const currentPhoto = photos[currentIndex];
    const isVideo = currentPhoto?.mime_type?.startsWith('video/');
    const isAudio = currentPhoto?.mime_type?.startsWith('audio/');
    const mediaRef = isAudio ? audioRef : videoRef;
    
    const handleKeyDown = (e) => {
      // Global keys (work everywhere)
      if (e.key === 'Escape') {
        if (isFullscreen) {
          exitFullscreen();
        } else {
          onClose();
        }
        return;
      }
      
      // Navigation keys - only work when not playing media
      if (!isVideo && !isAudio) {
        if (e.key === 'ArrowLeft') {
          goToPrevious();
          return;
        } else if (e.key === 'ArrowRight') {
          goToNext();
          return;
        }
      }
      
      // Media player controls
      if ((isVideo || isAudio) && mediaRef.current) {
        if (e.key === ' ') {
          // Space bar to play/pause
          e.preventDefault();
          togglePlayPause();
        } else if (e.key === 'ArrowRight') {
          // Right arrow: skip forward 5 seconds
          e.preventDefault();
          mediaRef.current.currentTime = Math.min(
            mediaRef.current.currentTime + 5,
            mediaRef.current.duration
          );
        } else if (e.key === 'ArrowLeft') {
          // Left arrow: skip backward 5 seconds
          e.preventDefault();
          mediaRef.current.currentTime = Math.max(
            mediaRef.current.currentTime - 5,
            0
          );
        } else if (e.key === 'ArrowUp') {
          // Up arrow: increase volume
          e.preventDefault();
          const newVolume = Math.min(volume + 0.1, 1);
          setVolume(newVolume);
          mediaRef.current.volume = newVolume;
        } else if (e.key === 'ArrowDown') {
          // Down arrow: decrease volume
          e.preventDefault();
          const newVolume = Math.max(volume - 0.1, 0);
          setVolume(newVolume);
          mediaRef.current.volume = newVolume;
        } else if (e.key === 'f' || e.key === 'F') {
          // F key: toggle fullscreen
          e.preventDefault();
          toggleFullscreen();
        } else if (e.key === 'm' || e.key === 'M') {
          // M key: mute/unmute
          e.preventDefault();
          mediaRef.current.muted = !mediaRef.current.muted;
        } else if (e.key === 'k' || e.key === 'K') {
          // K key: play/pause (YouTube style)
          e.preventDefault();
          togglePlayPause();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, goToPrevious, goToNext, photos, currentIndex, isFullscreen, volume]);

  // Media player functions
  const togglePlayPause = () => {
    const currentPhoto = photos[currentIndex];
    const isAudio = currentPhoto?.mime_type?.startsWith('audio/');
    const mediaRef = isAudio ? audioRef : videoRef;
    
    if (mediaRef.current) {
      if (isPlaying) {
        mediaRef.current.pause();
      } else {
        mediaRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const skipForward = () => {
    const currentPhoto = photos[currentIndex];
    const isAudio = currentPhoto?.mime_type?.startsWith('audio/');
    const mediaRef = isAudio ? audioRef : videoRef;
    
    if (mediaRef.current) {
      mediaRef.current.currentTime = Math.min(
        mediaRef.current.currentTime + 5,
        mediaRef.current.duration
      );
    }
  };

  const skipBackward = () => {
    const currentPhoto = photos[currentIndex];
    const isAudio = currentPhoto?.mime_type?.startsWith('audio/');
    const mediaRef = isAudio ? audioRef : videoRef;
    
    if (mediaRef.current) {
      mediaRef.current.currentTime = Math.max(
        mediaRef.current.currentTime - 5,
        0
      );
    }
  };

  // Fullscreen functions - fullscreen the video container with custom controls
  const videoContainerRef = useRef(null);
  
  const toggleFullscreen = async () => {
    if (!videoContainerRef.current) return;
    
    if (!document.fullscreenElement) {
      try {
        // Fullscreen the container (not just the video element) so our custom controls show
        if (videoContainerRef.current.requestFullscreen) {
          await videoContainerRef.current.requestFullscreen();
        } else if (videoContainerRef.current.webkitRequestFullscreen) {
          await videoContainerRef.current.webkitRequestFullscreen();
        } else if (videoContainerRef.current.mozRequestFullScreen) {
          await videoContainerRef.current.mozRequestFullScreen();
        } else if (videoContainerRef.current.msRequestFullscreen) {
          await videoContainerRef.current.msRequestFullscreen();
        }
        setIsFullscreen(true);
      } catch (err) {
        console.error('Error entering fullscreen:', err);
        toast.error('Failed to enter fullscreen mode');
      }
    } else {
      exitFullscreen();
    }
  };

  const exitFullscreen = async () => {
    if (document.fullscreenElement) {
      try {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          await document.webkitExitFullscreen();
        } else if (document.mozCancelFullScreen) {
          await document.mozCancelFullScreen();
        } else if (document.msExitFullscreen) {
          await document.msExitFullscreen();
        }
        setIsFullscreen(false);
      } catch (err) {
        console.error('Error exiting fullscreen:', err);
      }
    }
  };

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Change playback speed
  const changePlaybackSpeed = (speed) => {
    const currentPhoto = photos[currentIndex];
    const isAudio = currentPhoto?.mime_type?.startsWith('audio/');
    const mediaRef = isAudio ? audioRef : videoRef;
    
    if (mediaRef.current) {
      mediaRef.current.playbackRate = speed;
      setPlaybackSpeed(speed);
      setShowSpeedMenu(false);
      toast.success(`Playback speed: ${speed}x`);
    }
  };

  // Download file handler
  const handleDownload = async () => {
    if (!currentPhoto) return;
    
    setDownloading(true);
    
    try {
      const token = localStorage.getItem('token');
      
      // Get download URL from backend
      const response = await axios.get(`${API}/files/${currentPhoto.id}/download-url`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      const { download_url, type } = response.data;
      
      // Use download URL directly - browser handles both Bot API URLs and worker streaming URLs
      // No need for chunked downloads - the worker handles streaming for large files
      const link = document.createElement('a');
      link.href = download_url;
      link.download = currentPhoto.name;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      toast.success(`Downloading ${currentPhoto.name}...`);
    } catch (error) {
      console.error('Download failed:', error);
      toast.error('Download failed: ' + (error.message || 'Unknown error'));
    } finally {
      setDownloading(false);
    }
  };

  const handleTimeUpdate = (e) => {
    const target = e.target;
    if (target) {
      setCurrentTime(target.currentTime);
    }
  };

  const handleLoadedMetadata = (e) => {
    const target = e.target;
    if (target) {
      setDuration(target.duration);
      target.volume = volume;
      target.playbackRate = playbackSpeed;
    }
  };

  const handleProgressClick = (e) => {
    const currentPhoto = photos[currentIndex];
    const isAudio = currentPhoto?.mime_type?.startsWith('audio/');
    const mediaRef = isAudio ? audioRef : videoRef;
    
    if (mediaRef.current) {
      const rect = e.currentTarget.getBoundingClientRect();
      const pos = (e.clientX - rect.left) / rect.width;
      mediaRef.current.currentTime = pos * mediaRef.current.duration;
    }
  };

  const formatTime = (seconds) => {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
      }
    }, 3000);
  };

  if (!photos || photos.length === 0) {
    return null;
  }

  const currentPhoto = photos[currentIndex];
  const isVideo = currentPhoto?.mime_type?.startsWith('video/');
  const isAudio = currentPhoto?.mime_type?.startsWith('audio/');
  const isPDF = currentPhoto?.mime_type === 'application/pdf';
  const isMedia = isVideo || isAudio;

  const speedOptions = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 bg-black bg-opacity-95 flex items-center justify-center"
      onClick={(e) => {
        // Close when clicking on backdrop
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      {/* Download Button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={handleDownload}
        disabled={downloading}
        className="absolute top-4 right-16 text-white hover:bg-white/20 z-10"
        title={downloading ? "Starting download..." : "Download"}
      >
        {downloading ? (
          <Loader2 className="w-6 h-6 animate-spin" />
        ) : (
          <Download className="w-6 h-6" />
        )}
      </Button>

      {/* Close Button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onClose}
        className="absolute top-4 right-4 text-white hover:bg-white/20 z-10"
        title="Close (Esc)"
      >
        <X className="w-6 h-6" />
      </Button>

      {/* Image Counter */}
      <div className="absolute top-4 left-1/2 transform -translate-x-1/2 text-white text-sm font-medium bg-black/50 px-4 py-2 rounded-full">
        {currentIndex + 1} / {photos.length}
      </div>

      {/* Previous Button */}
      {photos.length > 1 && (
        <Button
          variant="ghost"
          size="icon"
          onClick={goToPrevious}
          className="absolute left-4 top-1/2 transform -translate-y-1/2 text-white hover:bg-white/20 w-12 h-12"
          title="Previous (←)"
        >
          <ChevronLeft className="w-8 h-8" />
        </Button>
      )}

      {/* Next Button */}
      {photos.length > 1 && (
        <Button
          variant="ghost"
          size="icon"
          onClick={goToNext}
          className="absolute right-4 top-1/2 transform -translate-y-1/2 text-white hover:bg-white/20 w-12 h-12"
          title="Next (→)"
        >
          <ChevronRight className="w-8 h-8" />
        </Button>
      )}

      {/* Media Container */}
      <div 
        className="max-w-7xl max-h-[90vh] w-full h-full flex items-center justify-center p-8"
        onMouseMove={isMedia ? handleMouseMove : undefined}
      >
        {loading && (
          <div className="flex flex-col items-center space-y-4">
            <Loader2 className="w-12 h-12 text-white animate-spin" />
            <p className="text-white text-sm">
              Loading {isVideo ? 'video' : isAudio ? 'audio' : isPDF ? 'PDF' : 'image'} from Telegram...
            </p>
          </div>
        )}

        {error && (
          <div className="text-center">
            <p className="text-red-400 text-lg mb-4">{error}</p>
            <Button
              onClick={() => loadImage(currentPhoto.id)}
              className="bg-white text-black hover:bg-gray-200"
            >
              Retry
            </Button>
          </div>
        )}

        {!loading && !error && imageUrl && (
          <div className="relative w-full h-full flex items-center justify-center">
            {isPDF ? (
              /* PDF Viewer using react-pdf */
              <div className="relative w-full h-full">
                <PDFViewer 
                  pdfUrl={imageUrl} 
                  fileName={currentPhoto.name}
                  fileSize={currentPhoto.size}
                />
              </div>
            ) : isAudio ? (
              /* Audio Player */
              <div className="relative w-full max-w-2xl flex items-center justify-center">
                <div className="w-full bg-gradient-to-br from-indigo-600 to-purple-700 rounded-2xl shadow-2xl p-8">
                  {/* Album Art / Waveform Visual */}
                  <div className="flex items-center justify-center mb-8">
                    <div className="w-48 h-48 bg-white/10 rounded-full flex items-center justify-center backdrop-blur-sm">
                      <div className={`w-32 h-32 bg-white/20 rounded-full flex items-center justify-center ${isPlaying ? 'animate-pulse' : ''}`}>
                        <Play className="w-16 h-16 text-white" fill="white" />
                      </div>
                    </div>
                  </div>

                  {/* Audio Element (hidden) */}
                  <audio
                    ref={audioRef}
                    src={imageUrl}
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={handleLoadedMetadata}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onEnded={() => setIsPlaying(false)}
                    onError={() => setError('Failed to load audio')}
                  />

                  {/* Song Info */}
                  <div className="text-center mb-6">
                    <h3 className="text-white text-xl font-bold truncate" title={currentPhoto.name}>
                      {currentPhoto.name.replace(/\.(mp3|m4a|wav|ogg)$/i, '')}
                    </h3>
                    {currentPhoto.size && (
                      <p className="text-white/70 text-sm mt-1">
                        {formatFileSize(currentPhoto.size)}
                      </p>
                    )}
                  </div>

                  {/* Progress Bar */}
                  <div 
                    className="w-full h-2 bg-white/20 rounded-full cursor-pointer mb-2 group"
                    onClick={handleProgressClick}
                  >
                    <div 
                      className="h-full bg-white rounded-full transition-all group-hover:h-3"
                      style={{ width: `${(currentTime / duration) * 100}%` }}
                    />
                  </div>

                  {/* Time Display */}
                  <div className="flex justify-between text-white/80 text-sm mb-6">
                    <span>{formatTime(currentTime)}</span>
                    <span>{formatTime(duration)}</span>
                  </div>

                  {/* Control Buttons */}
                  <div className="flex items-center justify-center space-x-4">
                    {/* Skip Backward */}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={skipBackward}
                      className="text-white hover:bg-white/20 w-12 h-12"
                      title="Back 5 seconds (←)"
                    >
                      <SkipBack className="w-6 h-6" />
                    </Button>

                    {/* Play/Pause Button */}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={togglePlayPause}
                      className="text-white hover:bg-white/20 w-16 h-16 rounded-full bg-white/10"
                    >
                      {isPlaying ? (
                        <Pause className="w-8 h-8" fill="white" />
                      ) : (
                        <Play className="w-8 h-8 ml-1" fill="white" />
                      )}
                    </Button>

                    {/* Skip Forward */}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={skipForward}
                      className="text-white hover:bg-white/20 w-12 h-12"
                      title="Forward 5 seconds (→)"
                    >
                      <SkipForward className="w-6 h-6" />
                    </Button>
                  </div>

                  {/* Speed Control */}
                  <div className="flex items-center justify-center mt-6 relative">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                      className="text-white hover:bg-white/20 text-sm"
                    >
                      <Gauge className="w-4 h-4 mr-2" />
                      {playbackSpeed}x
                    </Button>

                    {showSpeedMenu && (
                      <div className="absolute bottom-full mb-2 bg-black/90 rounded-lg py-2 shadow-xl">
                        {speedOptions.map((speed) => (
                          <button
                            key={speed}
                            onClick={() => changePlaybackSpeed(speed)}
                            className={`block w-full px-4 py-2 text-sm text-left hover:bg-white/10 ${
                              playbackSpeed === speed ? 'text-indigo-400 font-bold' : 'text-white'
                            }`}
                          >
                            {speed}x
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : isVideo ? (
              <div ref={videoContainerRef} className="relative w-full h-full flex items-center justify-center bg-black">
                {/* Video Player - No native controls */}
                <video
                  ref={videoRef}
                  src={imageUrl}
                  className={`${isFullscreen ? 'w-full h-full' : 'max-w-full max-h-full'} object-contain cursor-pointer`}
                  onTimeUpdate={handleTimeUpdate}
                  onLoadedMetadata={handleLoadedMetadata}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onError={() => setError('Failed to load video')}
                  onClick={togglePlayPause}
                  playsInline
                />

                {/* Video Controls Overlay - Always show in fullscreen */}
                <div 
                  className={`absolute inset-0 flex items-end transition-opacity duration-300 ${
                    showControls || isFullscreen ? 'opacity-100' : 'opacity-0'
                  }`}
                >
                  <div className="w-full bg-gradient-to-t from-black/90 via-black/60 to-transparent p-6 rounded-b-lg">
                    {/* Progress Bar */}
                    <div 
                      className="w-full h-2 bg-white/30 rounded-full cursor-pointer mb-4 group"
                      onClick={handleProgressClick}
                    >
                      <div 
                        className="h-full bg-indigo-500 rounded-full transition-all group-hover:bg-indigo-400"
                        style={{ width: `${(currentTime / duration) * 100}%` }}
                      />
                    </div>

                    {/* Control Buttons */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        {/* Play/Pause Button */}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={togglePlayPause}
                          className="text-white hover:bg-white/20 w-10 h-10"
                          title="Play/Pause (Space or K)"
                        >
                          {isPlaying ? (
                            <Pause className="w-6 h-6" fill="white" />
                          ) : (
                            <Play className="w-6 h-6" fill="white" />
                          )}
                        </Button>

                        {/* Skip Backward */}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={skipBackward}
                          className="text-white hover:bg-white/20 w-10 h-10"
                          title="Back 5 seconds (←)"
                        >
                          <SkipBack className="w-5 h-5" />
                        </Button>

                        {/* Skip Forward */}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={skipForward}
                          className="text-white hover:bg-white/20 w-10 h-10"
                          title="Forward 5 seconds (→)"
                        >
                          <SkipForward className="w-5 h-5" />
                        </Button>

                        {/* Speed Control */}
                        <div className="relative">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                            className="text-white hover:bg-white/20 text-xs h-10"
                          >
                            <Gauge className="w-4 h-4 mr-1" />
                            {playbackSpeed}x
                          </Button>

                          {showSpeedMenu && (
                            <div className="absolute bottom-full left-0 mb-2 bg-black/90 rounded-lg py-2 shadow-xl z-10">
                              {speedOptions.map((speed) => (
                                <button
                                  key={speed}
                                  onClick={() => changePlaybackSpeed(speed)}
                                  className={`block w-full px-4 py-2 text-sm text-left hover:bg-white/10 whitespace-nowrap ${
                                    playbackSpeed === speed ? 'text-indigo-400 font-bold' : 'text-white'
                                  }`}
                                >
                                  {speed}x
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Time Display */}
                        <span className="text-white text-sm font-medium ml-2">
                          {formatTime(currentTime)} / {formatTime(duration)}
                        </span>
                      </div>

                      <div className="flex items-center space-x-2">
                        {/* Fullscreen Button */}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={toggleFullscreen}
                          className="text-white hover:bg-white/20 w-10 h-10"
                          title="Fullscreen (F)"
                        >
                          {isFullscreen ? (
                            <Minimize className="w-5 h-5" />
                          ) : (
                            <Maximize className="w-5 h-5" />
                          )}
                        </Button>

                        {/* File Info */}
                        <div className="text-right ml-4">
                          <p className="text-white text-sm font-medium truncate max-w-xs" title={currentPhoto.name}>
                            {currentPhoto.name}
                          </p>
                          {currentPhoto.size && (
                            <p className="text-gray-300 text-xs">
                              {formatFileSize(currentPhoto.size)}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="relative w-full h-full flex items-center justify-center">
                <img
                  src={imageUrl}
                  alt={currentPhoto.name}
                  className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
                  onError={() => {
                    setError('Failed to load image');
                  }}
                />
                
                {/* Image Info */}
                <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-black/70 text-white px-4 py-2 rounded-lg max-w-md">
                  <p className="text-sm font-medium truncate" title={currentPhoto.name}>
                    {currentPhoto.name}
                  </p>
                  {currentPhoto.size && (
                    <p className="text-xs text-gray-300">
                      {formatFileSize(currentPhoto.size)}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      
      {/* Keyboard Shortcuts Helper */}
      {isMedia && (
        <div className="absolute bottom-4 left-4 bg-black/70 text-white px-4 py-2 rounded-lg text-xs max-w-xs">
          <p className="font-semibold mb-1">Keyboard Shortcuts:</p>
          <p>Space/K: Play/Pause | ←/→: Seek 5s | ↑/↓: Volume | F: Fullscreen | M: Mute</p>
        </div>
      )}
    </div>
  );
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}
