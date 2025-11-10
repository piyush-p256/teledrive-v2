import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { API } from '../App';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
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
  Trash2,
  MoreVertical,
  Settings,
  LogOut,
  HardDrive,
  ArrowLeft,
  RotateCcw,
  Trash,
  Image as ImageIcon,
  FileText,
  Video,
  Music,
  AlertTriangle,
} from 'lucide-react';

export default function TrashPage({ user, onLogout }) {
  const navigate = useNavigate();
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [clearTrashDialog, setClearTrashDialog] = useState(false);

  useEffect(() => {
    loadTrashFiles();
  }, []);

  const loadTrashFiles = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API}/files/trash/list`);
      setFiles(response.data);
    } catch (error) {
      toast.error('Failed to load trash');
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async (fileId) => {
    try {
      await axios.post(`${API}/files/${fileId}/restore`);
      toast.success('File restored successfully');
      loadTrashFiles();
    } catch (error) {
      toast.error('Failed to restore file');
    }
  };

  const handlePermanentDelete = async (fileId) => {
    try {
      await axios.delete(`${API}/files/${fileId}?permanent=true`);
      toast.success('File permanently deleted');
      loadTrashFiles();
    } catch (error) {
      toast.error('Failed to delete file');
    }
  };

  const handleClearAllTrash = async () => {
    try {
      console.log('Clearing trash...');
      const response = await axios.post(`${API}/files/trash/clear-all`);
      console.log('Clear trash response:', response.data);
      toast.success(`${response.data.deleted_count} files permanently deleted`);
      setClearTrashDialog(false);
      loadTrashFiles();
    } catch (error) {
      console.error('Clear trash error:', error);
      const errorMsg = error.response?.data?.detail || error.message || 'Failed to clear trash';
      toast.error(errorMsg);
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

  const getDaysRemaining = (trashedAt) => {
    if (!trashedAt) return null;
    const trashed = new Date(trashedAt);
    const now = new Date();
    const diffTime = 10 * 24 * 60 * 60 * 1000 - (now - trashed); // 10 days in ms
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : 0;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate('/dashboard')}
                data-testid="back-to-dashboard-button"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div className="p-2 bg-indigo-600 rounded-lg">
                <Trash2 className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-2xl font-bold text-indigo-600" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                Trash
              </h1>
            </div>

            <div className="flex items-center space-x-4">
              {files.length > 0 && (
                <Button
                  variant="destructive"
                  onClick={() => setClearTrashDialog(true)}
                  data-testid="clear-trash-button"
                >
                  <Trash className="w-4 h-4 mr-2" />
                  Clear Trash
                </Button>
              )}

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
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
          </div>
        ) : files.length === 0 ? (
          <div className="text-center py-12">
            <Trash2 className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 text-lg">Trash is empty</p>
            <p className="text-gray-400 text-sm mt-2">
              Deleted files will appear here and be permanently deleted after 10 days
            </p>
          </div>
        ) : (
          <div>
            <div className="mb-4">
              <p className="text-sm text-gray-600">
                {files.length} {files.length === 1 ? 'item' : 'items'} in trash. Files will be permanently deleted after 10 days.
              </p>
            </div>
            <div className="file-grid">
              {files.map((file) => {
                const daysRemaining = getDaysRemaining(file.trashed_at);
                return (
                  <Card
                    key={file.id}
                    className="overflow-hidden thumbnail-hover group"
                    data-testid={`trash-file-${file.id}`}
                  >
                    <div className="aspect-square bg-gray-100 flex items-center justify-center relative">
                      {file.thumbnail_url ? (
                        <img
                          src={file.thumbnail_url}
                          alt={file.name}
                          className="w-full h-full object-cover opacity-75"
                        />
                      ) : (
                        <div className="text-gray-400">{getFileIcon(file.mime_type)}</div>
                      )}
                      {daysRemaining !== null && (
                        <div className="absolute top-2 left-2 bg-red-500 text-white text-xs px-2 py-1 rounded">
                          {daysRemaining === 0 ? 'Deleting soon' : `${daysRemaining}d left`}
                        </div>
                      )}
                      <div className="absolute top-2 right-2">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="secondary"
                              size="icon"
                              className="h-8 w-8 opacity-0 group-hover:opacity-100"
                              data-testid={`trash-file-menu-${file.id}`}
                            >
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem onClick={() => handleRestore(file.id)}>
                              <RotateCcw className="w-4 h-4 mr-2" />
                              Restore
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => handlePermanentDelete(file.id)}
                              className="text-red-600"
                            >
                              <Trash className="w-4 h-4 mr-2" />
                              Delete Forever
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
                );
              })}
            </div>
          </div>
        )}
      </main>

      {/* Clear Trash Confirmation Dialog */}
      <Dialog open={clearTrashDialog} onOpenChange={setClearTrashDialog}>
        <DialogContent data-testid="clear-trash-dialog">
          <DialogHeader>
            <div className="flex items-center space-x-2 text-red-600">
              <AlertTriangle className="w-6 h-6" />
              <DialogTitle>Clear Trash?</DialogTitle>
            </div>
          </DialogHeader>
          <div className="pt-4 space-y-2">
            <div className="text-sm text-gray-600">
              This will <strong>permanently delete all {files.length} files</strong> in trash.
            </div>
            <div className="text-sm text-red-600 font-semibold">
              Files will be deleted from Telegram too! This action cannot be undone.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearTrashDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleClearAllTrash}
              data-testid="confirm-clear-trash-button"
            >
              <Trash className="w-4 h-4 mr-2" />
              Delete Forever
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
