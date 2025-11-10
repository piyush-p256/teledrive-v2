import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { API } from '../App';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { toast } from 'sonner';
import { Download, File, HardDrive, Loader2 } from 'lucide-react';

export default function SharedFile() {
  const { token } = useParams();
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    loadFile();
  }, [token]);

  const loadFile = async () => {
    try {
      const response = await axios.get(`${API}/share/${token}`);
      setFile(response.data);
    } catch (error) {
      setError('File not found or link expired');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    setDownloading(true);
    
    try {
      // Get download URL from backend
      const response = await axios.get(`${API}/share/${token}/download-url`);
      const { download_url, type, size } = response.data;
      
      // Use the download URL directly - browser handles both Bot API URLs and worker streaming URLs
      // No need for chunked downloads - the worker handles streaming for large files
      const link = document.createElement('a');
      link.href = download_url;
      link.download = file.name;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      toast.success(`Downloading ${file.name}...`);
    } catch (error) {
      console.error('Download error:', error);
      toast.error(error.response?.data?.detail || 'Failed to download file');
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center">
        <Card className="p-8 text-center space-y-4">
          <File className="w-16 h-16 text-gray-400 mx-auto" />
          <h1 className="text-2xl font-bold text-gray-800">File Not Found</h1>
          <p className="text-gray-600">{error}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center h-16 space-x-3">
            <div className="p-2 bg-indigo-600 rounded-lg">
              <HardDrive className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-indigo-600" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
              TeleStore
            </h1>
          </div>
        </div>
      </header>

      {/* File Preview */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Card className="overflow-hidden">
          {file.thumbnail_url && (
            <div className="aspect-video bg-gray-100 flex items-center justify-center">
              <img
                src={file.thumbnail_url}
                alt={file.name}
                className="max-w-full max-h-full object-contain"
              />
            </div>
          )}
          <div className="p-6 space-y-4">
            <div>
              <h2 className="text-2xl font-bold mb-2">{file.name}</h2>
              <p className="text-gray-600">
                Size: {(file.size / (1024 * 1024)).toFixed(2)} MB
              </p>
            </div>
            <Button
              onClick={handleDownload}
              disabled={downloading}
              className="w-full bg-indigo-600 hover:bg-indigo-700"
              data-testid="download-button"
            >
              {downloading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Starting download...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 mr-2" />
                  Download
                </>
              )}
            </Button>
          </div>
        </Card>
      </main>
    </div>
  );
}
