import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { API } from '../App';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card } from '../components/ui/card';
import { Checkbox } from '../components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { toast } from 'sonner';
import {
  Upload,
  Folder,
  File,
  MoreVertical,
  Trash2,
  Share2,
  Edit,
  Settings,
  LogOut,
  FolderPlus,
  Search,
  HardDrive,
  Download,
  Image as ImageIcon,
  FileText,
  Video,
  Music,
  Users,
} from 'lucide-react';
import * as faceapi from 'face-api.js';
import ImageGalleryModal from '../components/ImageGalleryModal';
import UploadQueue from '../components/UploadQueue';
import { ChunkedUploader, shouldUseChunkedUpload } from '../utils/chunkedUpload';

export default function Dashboard({ user, onLogout }) {
  const navigate = useNavigate();
  const [files, setFiles] = useState([]);
  const [folders, setFolders] = useState([]);
  const [currentFolder, setCurrentFolder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [newFolderDialog, setNewFolderDialog] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renameDialog, setRenameDialog] = useState(false);
  const [renameItem, setRenameItem] = useState(null);
  const [renameName, setRenameName] = useState('');
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [selectedItems, setSelectedItems] = useState([]);
  const [bulkShareDialog, setBulkShareDialog] = useState(false);
  const [shareLinks, setShareLinks] = useState([]);
  const fileInputRef = useRef(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryPhotos, setGalleryPhotos] = useState([]);
  const [galleryInitialIndex, setGalleryInitialIndex] = useState(0);
  
  // Upload queue state
  const [uploadQueue, setUploadQueue] = useState([]);
  const uploadersRef = useRef({});

  // Load face-api.js models on mount
  useEffect(() => {
    const loadModels = async () => {
      try {
        const MODEL_URL = '/models';
        await Promise.all([
          faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
        ]);
        setModelsLoaded(true);
        console.log('Face detection models loaded successfully (SsdMobilenetv1)');
      } catch (error) {
        console.error('Failed to load face detection models:', error);
      }
    };
    loadModels();
  }, []);

  useEffect(() => {
    loadData();
  }, [currentFolder]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [filesRes, foldersRes] = await Promise.all([
        axios.get(`${API}/files`, { params: { folder_id: currentFolder } }),
        axios.get(`${API}/folders`, { params: { parent_id: currentFolder } }),
      ]);
      setFiles(filesRes.data);
      setFolders(foldersRes.data);
    } catch (error) {
      toast.error('Failed to load files');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e) => {
    const selectedFiles = Array.from(e.target.files);
    if (selectedFiles.length === 0) return;

    if (!user?.telegram_session) {
      toast.error('Please connect Telegram first in Settings');
      return;
    }

    if (!user?.worker_url) {
      toast.error('Please configure Worker URL in Settings');
      return;
    }

    // Add all files to upload queue
    for (const file of selectedFiles) {
      addToUploadQueue(file);
    }
  };

  const addToUploadQueue = (file) => {
    const uploadId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const newUpload = {
      id: uploadId,
      name: file.name,
      size: file.size,
      progress: 0,
      uploadedSize: 0,
      speed: 0,
      eta: 0,
      status: 'uploading', // uploading, paused, completed, error
      error: null,
      phase: 'uploading', // uploading, telegram, completed
      phaseDescription: 'Uploading chunks',
      telegramProgress: 0,
    };

    setUploadQueue(prev => [...prev, newUpload]);

    // Start upload
    if (shouldUseChunkedUpload(file.size)) {
      startChunkedUpload(file, uploadId);
    } else {
      startNormalUpload(file, uploadId);
    }
  };

  const startChunkedUpload = async (file, uploadId) => {
    try {
      const uploader = new ChunkedUploader(file, user.worker_url, localStorage.getItem('token'), {
        onProgress: (progressData) => {
          updateUploadProgress(uploadId, {
            progress: progressData.progress,
            uploadedSize: progressData.uploadedSize,
            speed: progressData.speed,
            eta: progressData.eta,
            phase: progressData.phase,
            phaseDescription: progressData.phaseDescription,
            telegramProgress: progressData.telegramProgress || 0,
          });
        },
        onComplete: async (result) => {
          await handleUploadComplete(file, uploadId, result);
        },
        onError: (error) => {
          updateUploadProgress(uploadId, {
            status: 'error',
            error: error.message,
          });
          toast.error(`Failed to upload ${file.name}: ${error.message}`);
        },
        onPause: () => {
          updateUploadProgress(uploadId, { status: 'paused' });
        },
        onResume: () => {
          updateUploadProgress(uploadId, { status: 'uploading' });
        },
      });

      uploadersRef.current[uploadId] = uploader;
      await uploader.start();

    } catch (error) {
      console.error('Chunked upload error:', error);
      updateUploadProgress(uploadId, {
        status: 'error',
        error: error.message,
      });
    }
  };

  const startNormalUpload = async (file, uploadId) => {
    setUploading(true);
    try {
      // Check if worker URL is configured
      if (!user?.worker_url) {
        throw new Error('Please configure Worker URL in Settings');
      }

      // Generate thumbnail
      let thumbnailUrl = null;
      let thumbnailProvider = null;
      let imageElement = null;

      if (file.type.startsWith('image/')) {
        thumbnailUrl = await generateThumbnail(file);
        if (user.imgbb_api_key) {
          thumbnailUrl = await uploadToImgbb(thumbnailUrl);
          thumbnailProvider = 'imgbb';
        } else if (user.cloudinary_api_key) {
          thumbnailUrl = await uploadToCloudinary(thumbnailUrl);
          thumbnailProvider = 'cloudinary';
        }
        
        // Create image element for face detection
        imageElement = await loadImageFromFile(file);
      } else if (file.type.startsWith('video/')) {
        // Generate video thumbnail
        thumbnailUrl = await generateVideoThumbnail(file);
        if (user.imgbb_api_key && thumbnailUrl) {
          thumbnailUrl = await uploadToImgbb(thumbnailUrl);
          thumbnailProvider = 'imgbb';
        } else if (user.cloudinary_api_key && thumbnailUrl) {
          thumbnailUrl = await uploadToCloudinary(thumbnailUrl);
          thumbnailProvider = 'cloudinary';
        }
      }

      // Upload to Telegram via worker using legacy /upload endpoint
      const formData = new FormData();
      formData.append('file', file);
      formData.append('authToken', localStorage.getItem('token'));

      let workerData;
      const workerResponse = await axios.post(user.worker_url + '/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        validateStatus: () => true,
        onUploadProgress: (progressEvent) => {
          const progress = (progressEvent.loaded / progressEvent.total) * 100;
          updateUploadProgress(uploadId, {
            progress,
            uploadedSize: progressEvent.loaded,
          });
        },
      });

      workerData = workerResponse.data;
      
      if (!workerData || !workerData.success) {
        throw new Error(workerData?.error || 'Worker upload failed');
      }

      await handleUploadComplete(file, uploadId, workerData, thumbnailUrl, thumbnailProvider, imageElement);

    } catch (error) {
      console.error('Upload error:', error);
      updateUploadProgress(uploadId, {
        status: 'error',
        error: error.message,
      });
      toast.error(`Failed to upload ${file.name}: ${error.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleUploadComplete = async (file, uploadId, workerData, thumbnailUrl, thumbnailProvider, imageElement) => {
    try {
      // Create file metadata in backend
      const fileResponse = await axios.post(`${API}/files`, {
        name: file.name,
        size: file.size,
        mime_type: file.type,
        telegram_msg_id: workerData.messageId,
        telegram_file_id: workerData.fileId,
        thumbnail_url: thumbnailUrl,
        thumbnail_provider: thumbnailProvider,
        folder_id: currentFolder,
      });

      const fileId = fileResponse.data.id;

      // Detect faces if it's an image and models are loaded
      if (imageElement && modelsLoaded) {
        try {
          await detectAndStoreFaces(imageElement, fileId);
        } catch (faceError) {
          console.error('Face detection error:', faceError);
          // Don't fail the upload if face detection fails
        }
      }

      updateUploadProgress(uploadId, {
        status: 'completed',
        progress: 100,
      });
      
      toast.success(`${file.name} uploaded successfully!`);
      loadData();
    } catch (error) {
      throw error;
    }
  };

  const updateUploadProgress = (uploadId, updates) => {
    setUploadQueue(prev => 
      prev.map(upload => 
        upload.id === uploadId 
          ? { ...upload, ...updates }
          : upload
      )
    );
  };

  const handlePauseUpload = (uploadId) => {
    const uploader = uploadersRef.current[uploadId];
    if (uploader) {
      uploader.pause();
    }
  };

  const handleResumeUpload = (uploadId) => {
    const uploader = uploadersRef.current[uploadId];
    if (uploader) {
      uploader.resume();
    }
  };

  const handleCancelUpload = async (uploadId) => {
    const uploader = uploadersRef.current[uploadId];
    if (uploader) {
      await uploader.cancel();
      delete uploadersRef.current[uploadId];
    }
    
    setUploadQueue(prev => prev.filter(upload => upload.id !== uploadId));
    toast.info('Upload cancelled');
  };

  const handleClearCompletedUploads = () => {
    setUploadQueue(prev => prev.filter(upload => upload.status !== 'completed'));
  };

  const loadImageFromFile = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const detectAndStoreFaces = async (imageElement, fileId) => {
    try {
      // Detect faces with landmarks and descriptors using SSD MobileNet v1 (more accurate)
      // Adjusted settings for better detection of faces with glasses/accessories
      const detections = await faceapi
        .detectAllFaces(imageElement, new faceapi.SsdMobilenetv1Options({ 
          minConfidence: 0.5,  // Slightly lower to catch more faces with accessories
          maxResults: 10        // Allow detecting multiple faces
        }))
        .withFaceLandmarks()
        .withFaceDescriptors();

      if (detections.length === 0) {
        console.log('No faces detected in image');
        return;
      }

      console.log(`Detected ${detections.length} face(s) with SsdMobilenetv1`);

      // Filter and format detections for backend
      // More lenient confidence for faces with glasses
      const faceData = {
        file_id: fileId,
        detections: detections
          .filter(detection => detection.detection.score >= 0.55) // Slightly lower threshold
          .map(detection => ({
            box: {
              x: detection.detection.box.x,
              y: detection.detection.box.y,
              width: detection.detection.box.width,
              height: detection.detection.box.height,
            },
            descriptor: Array.from(detection.descriptor),
            confidence: detection.detection.score,
          })),
      };

      if (faceData.detections.length === 0) {
        console.log('No high-confidence faces to store');
        return;
      }

      console.log(`Storing ${faceData.detections.length} face detection(s) (confidence >= 0.55)`);

      // Send to backend
      await axios.post(`${API}/faces`, faceData);
      console.log(`Stored ${faceData.detections.length} face(s) successfully`);
    } catch (error) {
      console.error('Face detection/storage error:', error);
      throw error;
    }
  };

  const generateThumbnail = (file) => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          const maxSize = 200;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > maxSize) {
              height = (height * maxSize) / width;
              width = maxSize;
            }
          } else {
            if (height > maxSize) {
              width = (width * maxSize) / height;
              height = maxSize;
            }
          }

          canvas.width = width;
          canvas.height = height;
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  };

  const generateVideoThumbnail = (file) => {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      
      video.onloadedmetadata = () => {
        // Seek to 1 second or 10% of video duration, whichever is smaller
        video.currentTime = Math.min(1, video.duration * 0.1);
      };
      
      video.onseeked = () => {
        try {
          const maxSize = 200;
          let width = video.videoWidth;
          let height = video.videoHeight;

          if (width > height) {
            if (width > maxSize) {
              height = (height * maxSize) / width;
              width = maxSize;
            }
          } else {
            if (height > maxSize) {
              width = (width * maxSize) / height;
              height = maxSize;
            }
          }

          canvas.width = width;
          canvas.height = height;
          ctx.drawImage(video, 0, 0, width, height);
          
          const thumbnailUrl = canvas.toDataURL('image/jpeg', 0.7);
          
          // Clean up
          video.src = '';
          video.load();
          
          resolve(thumbnailUrl);
        } catch (error) {
          console.error('Error generating video thumbnail:', error);
          resolve(null);
        }
      };
      
      video.onerror = () => {
        console.error('Error loading video for thumbnail');
        resolve(null);
      };
      
      // Load video file
      video.src = URL.createObjectURL(file);
    });
  };

  const uploadToCloudinary = async (dataUrl) => {
    // Mock implementation - user needs to configure
    return dataUrl;
  };

  const uploadToImgbb = async (dataUrl) => {
    try {
      // Convert base64 data URL to blob
      const base64Data = dataUrl.split(',')[1];
      
      // Create form data for ImgBB
      const formData = new FormData();
      formData.append('image', base64Data);
      
      // Upload to ImgBB
      const response = await fetch(`https://api.imgbb.com/1/upload?key=${user.imgbb_api_key}`, {
        method: 'POST',
        body: formData,
      });
      
      const data = await response.json();
      
      if (!data.success) {
        throw new Error('ImgBB upload failed');
      }
      
      return data.data.url;
    } catch (error) {
      console.error('ImgBB upload error:', error);
      // Return original dataUrl as fallback
      return dataUrl;
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;

    try {
      await axios.post(`${API}/folders`, {
        name: newFolderName,
        parent_id: currentFolder,
      });
      toast.success('Folder created');
      setNewFolderDialog(false);
      setNewFolderName('');
      loadData();
    } catch (error) {
      toast.error('Failed to create folder');
    }
  };

  const handleRename = async () => {
    if (!renameName.trim()) return;

    try {
      if (renameItem.type === 'file') {
        await axios.put(`${API}/files/${renameItem.id}`, { name: renameName });
      } else {
        await axios.put(`${API}/folders/${renameItem.id}`, { name: renameName });
      }
      toast.success('Renamed successfully');
      setRenameDialog(false);
      loadData();
    } catch (error) {
      toast.error('Failed to rename');
    }
  };

  const handleDelete = async (id, type) => {
    try {
      if (type === 'file') {
        await axios.delete(`${API}/files/${id}`);
      } else {
        await axios.delete(`${API}/folders/${id}`);
      }
      toast.success('Moved to trash');
      loadData();
    } catch (error) {
      toast.error('Failed to delete');
    }
  };

  const handleShare = async (fileId) => {
    try {
      const response = await axios.post(`${API}/files/${fileId}/share`);
      const shareUrl = `${window.location.origin}/share/${response.data.share_token}`;
      await navigator.clipboard.writeText(shareUrl);
      toast.success('Share link copied to clipboard!');
    } catch (error) {
      toast.error('Failed to create share link');
    }
  };

  const handleDownload = async (fileId, fileName) => {
    try {
      const response = await axios.get(`${API}/files/${fileId}/download-url`);
      const downloadUrl = response.data.download_url;
      
      // Create a temporary link and trigger download
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = fileName;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      toast.success('Download started!');
    } catch (error) {
      console.error('Download error:', error);
      toast.error(error.response?.data?.detail || 'Failed to download file');
    }
  };

  const toggleSelectItem = (itemId) => {
    setSelectedItems(prev => 
      prev.includes(itemId) 
        ? prev.filter(id => id !== itemId)
        : [...prev, itemId]
    );
  };

  const selectAllItems = () => {
    const allFileIds = filteredFiles.map(f => f.id);
    setSelectedItems(allFileIds);
  };

  const deselectAll = () => {
    setSelectedItems([]);
  };

  const handleBulkDelete = async () => {
    if (selectedItems.length === 0) return;
    
    try {
      const response = await axios.post(`${API}/files/bulk-delete`, {
        file_ids: selectedItems
      });
      toast.success(`${response.data.deleted_count} items moved to trash`);
      setSelectedItems([]);
      loadData();
    } catch (error) {
      toast.error('Failed to delete items');
    }
  };

  const handleBulkShare = async () => {
    if (selectedItems.length === 0) return;
    
    try {
      const response = await axios.post(`${API}/files/bulk-share`, {
        file_ids: selectedItems
      });
      
      // Handle new response format
      if (response.data.share_type === 'collection') {
        // Multiple files - show single collection URL
        setShareLinks([{
          share_url: response.data.share_url,
          share_type: 'collection',
          file_count: response.data.file_count
        }]);
      } else {
        // Single file - show single file URL
        setShareLinks([{
          share_url: response.data.share_url,
          share_type: 'single'
        }]);
      }
      
      setBulkShareDialog(true);
    } catch (error) {
      toast.error('Failed to generate share links');
    }
  };

  const getFileIcon = (mimeType) => {
    if (mimeType.startsWith('image/')) return <ImageIcon className="w-4 h-4" />;
    if (mimeType.startsWith('video/')) return <Video className="w-4 h-4" />;
    if (mimeType.startsWith('audio/')) return <Music className="w-4 h-4" />;
    return <FileText className="w-4 h-4" />;
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  };

  const filteredFiles = files.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const filteredFolders = folders.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Filter image, video, audio, and PDF files for gallery
  const mediaFiles = filteredFiles.filter(f => 
    f.mime_type && (
      f.mime_type.startsWith('image/') || 
      f.mime_type.startsWith('video/') ||
      f.mime_type.startsWith('audio/') ||
      f.mime_type === 'application/pdf'
    )
  );

  const handleMediaClick = (file) => {
    // Find the index of this file in mediaFiles array
    const mediaIndex = mediaFiles.findIndex(f => f.id === file.id);
    if (mediaIndex !== -1) {
      setGalleryPhotos(mediaFiles);
      setGalleryInitialIndex(mediaIndex);
      setGalleryOpen(true);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-indigo-600 rounded-lg">
                <HardDrive className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-2xl font-bold text-indigo-600" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                TeleDrive
              </h1>
            </div>

            <div className="flex items-center space-x-4">
              <div className="relative hidden sm:block">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  data-testid="search-input"
                  type="text"
                  placeholder="Search files..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 w-64"
                />
              </div>

              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate('/trash')}
                title="Trash"
                data-testid="trash-button"
              >
                <Trash2 className="w-5 h-5" />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate('/people')}
                title="View People"
              >
                <Users className="w-5 h-5" />
              </Button>

              <Button
                data-testid="settings-button"
                variant="ghost"
                size="icon"
                onClick={() => navigate('/settings')}
              >
                <Settings className="w-5 h-5" />
              </Button>

              <Button
                data-testid="logout-button"
                variant="ghost"
                size="icon"
                onClick={onLogout}
              >
                <LogOut className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Actions Bar */}
        <div className="flex flex-wrap gap-3 mb-6">
          <Button
            data-testid="upload-button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="bg-indigo-600 hover:bg-indigo-700"
          >
            <Upload className="w-4 h-4 mr-2" />
            {uploading ? 'Uploading...' : 'Upload Files'}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileUpload}
            className="hidden"
            data-testid="file-input"
          />

          <Button
            data-testid="create-folder-button"
            variant="outline"
            onClick={() => setNewFolderDialog(true)}
          >
            <FolderPlus className="w-4 h-4 mr-2" />
            New Folder
          </Button>
        </div>

        {/* Bulk Actions Bar */}
        {selectedItems.length > 0 && (
          <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 mb-6 flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <span className="text-sm font-medium text-indigo-900">
                {selectedItems.length} {selectedItems.length === 1 ? 'item' : 'items'} selected
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={deselectAll}
                className="text-indigo-600"
              >
                Clear Selection
              </Button>
            </div>
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleBulkShare}
                data-testid="bulk-share-button"
              >
                <Share2 className="w-4 h-4 mr-2" />
                Share Selected
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleBulkDelete}
                data-testid="bulk-delete-button"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Selected
              </Button>
            </div>
          </div>
        )}

        {/* Files Grid */}
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Folders */}
            {filteredFolders.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-gray-600 mb-3">Folders</h2>
                <div className="file-grid">
                  {filteredFolders.map((folder) => (
                    <Card
                      key={folder.id}
                      className="p-4 cursor-pointer thumbnail-hover group"
                      data-testid={`folder-${folder.id}`}
                    >
                      <div className="flex items-start justify-between">
                        <div
                          className="flex-1"
                          onClick={() => setCurrentFolder(folder.id)}
                        >
                          <Folder className="w-12 h-12 text-indigo-500 mb-2" />
                          <p className="font-medium text-sm truncate">{folder.name}</p>
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="opacity-0 group-hover:opacity-100"
                              data-testid={`folder-menu-${folder.id}`}
                            >
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem
                              onClick={() => {
                                setRenameItem({ ...folder, type: 'folder' });
                                setRenameName(folder.name);
                                setRenameDialog(true);
                              }}
                            >
                              <Edit className="w-4 h-4 mr-2" />
                              Rename
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => handleDelete(folder.id, 'folder')}
                              className="text-red-600"
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Files */}
            {filteredFiles.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-gray-600 mb-3">Files</h2>
                <div className="file-grid">
                  {filteredFiles.map((file) => (
                    <Card
                      key={file.id}
                      className={`overflow-hidden thumbnail-hover group ${selectedItems.includes(file.id) ? 'ring-2 ring-indigo-500' : ''}`}
                      data-testid={`file-${file.id}`}
                    >
                      <div 
                        className="aspect-square bg-gray-100 flex items-center justify-center relative cursor-pointer"
                        onClick={() => {
                          // Open gallery for images, videos, audio, and PDFs
                          if (file.mime_type && (
                            file.mime_type.startsWith('image/') || 
                            file.mime_type.startsWith('video/') ||
                            file.mime_type.startsWith('audio/') ||
                            file.mime_type === 'application/pdf'
                          )) {
                            handleMediaClick(file);
                          }
                        }}
                      >
                        {file.thumbnail_url ? (
                          <>
                            <img
                              src={file.thumbnail_url}
                              alt={file.name}
                              className="w-full h-full object-cover"
                            />
                            {file.mime_type && file.mime_type.startsWith('video/') && (
                              <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-20 group-hover:bg-opacity-30 transition-all">
                                <div className="bg-white bg-opacity-90 rounded-full p-3 shadow-lg">
                                  <Video className="w-8 h-8 text-indigo-600" />
                                </div>
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="text-gray-400">{getFileIcon(file.mime_type)}</div>
                        )}
                        <div className="absolute top-2 left-2">
                          <Checkbox
                            checked={selectedItems.includes(file.id)}
                            onCheckedChange={() => toggleSelectItem(file.id)}
                            className="bg-white border-2"
                            data-testid={`file-checkbox-${file.id}`}
                          />
                        </div>
                        <div className="absolute top-2 right-2">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="secondary"
                                size="icon"
                                className="h-8 w-8 opacity-0 group-hover:opacity-100"
                                data-testid={`file-menu-${file.id}`}
                              >
                                <MoreVertical className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                              <DropdownMenuItem onClick={() => handleDownload(file.id, file.name)}>
                                <Download className="w-4 h-4 mr-2" />
                                Download
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleShare(file.id)}>
                                <Share2 className="w-4 h-4 mr-2" />
                                Share
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  setRenameItem({ ...file, type: 'file' });
                                  setRenameName(file.name);
                                  setRenameDialog(true);
                                }}
                              >
                                <Edit className="w-4 h-4 mr-2" />
                                Rename
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => handleDelete(file.id, 'file')}
                                className="text-red-600"
                              >
                                <Trash2 className="w-4 h-4 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                      <div className="p-3">
                        <p className="font-medium text-sm truncate" title={file.name}>
                          {file.name}
                        </p>
                        <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {filteredFiles.length === 0 && filteredFolders.length === 0 && (
              <div className="text-center py-12">
                <File className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">
                  {searchQuery ? 'No files found' : 'No files yet. Upload some files to get started!'}
                </p>
              </div>
            )}
          </div>
        )}
      </main>

      {/* New Folder Dialog */}
      <Dialog open={newFolderDialog} onOpenChange={setNewFolderDialog}>
        <DialogContent data-testid="new-folder-dialog">
          <DialogHeader>
            <DialogTitle>Create New Folder</DialogTitle>
            <DialogDescription>Enter a name for the new folder</DialogDescription>
          </DialogHeader>
          <Input
            data-testid="folder-name-input"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="Folder name"
            onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewFolderDialog(false)}>
              Cancel
            </Button>
            <Button
              data-testid="create-folder-confirm-button"
              onClick={handleCreateFolder}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={renameDialog} onOpenChange={setRenameDialog}>
        <DialogContent data-testid="rename-dialog">
          <DialogHeader>
            <DialogTitle>Rename {renameItem?.type}</DialogTitle>
            <DialogDescription>Enter a new name</DialogDescription>
          </DialogHeader>
          <Input
            data-testid="rename-input"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            placeholder="New name"
            onKeyDown={(e) => e.key === 'Enter' && handleRename()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDialog(false)}>
              Cancel
            </Button>
            <Button
              data-testid="rename-confirm-button"
              onClick={handleRename}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Share Dialog */}
      <Dialog open={bulkShareDialog} onOpenChange={setBulkShareDialog}>
        <DialogContent data-testid="bulk-share-dialog" className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {shareLinks.length > 0 && shareLinks[0].share_type === 'collection' 
                ? 'Collection Share Link Generated' 
                : 'Share Link Generated'}
            </DialogTitle>
            <DialogDescription>
              {shareLinks.length > 0 && shareLinks[0].share_type === 'collection'
                ? `${shareLinks[0].file_count} files are now publicly accessible via this single link`
                : 'File is now publicly accessible via this link'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {shareLinks.map((link, index) => (
              <div key={index} className="p-4 bg-indigo-50 border border-indigo-200 rounded-lg">
                {link.share_type === 'collection' && (
                  <p className="text-sm font-medium text-indigo-900 mb-2">
                    📦 Collection of {link.file_count} files
                  </p>
                )}
                <div className="flex items-center space-x-2">
                  <Input
                    value={`${window.location.origin}${link.share_url}`}
                    readOnly
                    className="text-sm font-mono"
                  />
                  <Button
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}${link.share_url}`);
                      toast.success('Link copied to clipboard!');
                    }}
                    className="bg-indigo-600 hover:bg-indigo-700"
                  >
                    Copy
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setBulkShareDialog(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Image Gallery Modal */}
      {galleryOpen && (
        <ImageGalleryModal
          photos={galleryPhotos}
          initialIndex={galleryInitialIndex}
          onClose={() => setGalleryOpen(false)}
        />
      )}

      {/* Upload Queue */}
      <UploadQueue
        uploads={uploadQueue}
        onPause={handlePauseUpload}
        onResume={handleResumeUpload}
        onCancel={handleCancelUpload}
        onClear={handleClearCompletedUploads}
      />
    </div>
  );
}
