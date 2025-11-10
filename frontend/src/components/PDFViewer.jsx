import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Loader2, FileText, ExternalLink } from 'lucide-react';

export default function PDFViewer({ pdfUrl, fileName, fileSize }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [blobUrl, setBlobUrl] = useState(null);

  useEffect(() => {
    let objectUrl = null;

    const fetchAndDisplayPDF = async () => {
      try {
        setLoading(true);
        setError(false);
        
        // Fetch the PDF as a blob to bypass download headers
        const response = await fetch(pdfUrl);
        
        if (!response.ok) {
          throw new Error('Failed to fetch PDF');
        }
        
        const blob = await response.blob();
        
        // Create a blob URL
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
        setLoading(false);
      } catch (err) {
        console.error('Error loading PDF:', err);
        setError(true);
        setLoading(false);
      }
    };

    if (pdfUrl) {
      fetchAndDisplayPDF();
    }

    // Cleanup function to revoke the object URL
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [pdfUrl]);

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  };

  return (
    <div className="w-full h-full flex flex-col bg-gray-900">
      {/* PDF Header */}
      <div className="bg-gray-800 text-white px-6 py-4 flex items-center justify-between border-b border-gray-700">
        <div className="flex items-center gap-3">
          <FileText className="w-6 h-6 text-indigo-400" />
          <div>
            <p className="font-semibold truncate max-w-md" title={fileName}>
              {fileName}
            </p>
            {fileSize && (
              <p className="text-sm text-gray-400">
                {formatFileSize(fileSize)}
              </p>
            )}
          </div>
        </div>

        {/* Open in New Tab Button */}
        {blobUrl && (
          <Button
            onClick={() => window.open(blobUrl, '_blank')}
            variant="ghost"
            size="sm"
            className="text-white hover:bg-gray-700"
          >
            <ExternalLink className="w-4 h-4 mr-2" />
            Open in New Tab
          </Button>
        )}
      </div>

      {/* PDF Content */}
      <div className="flex-1 overflow-hidden bg-gray-900 flex items-center justify-center relative">
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
            <Loader2 className="w-12 h-12 text-indigo-500 animate-spin" />
            <p className="text-white text-sm mt-4">Loading PDF...</p>
          </div>
        )}

        {error && (
          <div className="text-center">
            <p className="text-red-400 text-lg mb-4">Failed to load PDF preview</p>
            <Button
              onClick={() => window.open(pdfUrl, '_blank')}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              Try Opening Original
            </Button>
          </div>
        )}

        {/* PDF iframe using blob URL to bypass download headers */}
        {!loading && !error && blobUrl && (
          <iframe
            src={blobUrl}
            className="w-full h-full border-0"
            title={fileName}
            style={{ display: 'block' }}
          />
        )}
      </div>
    </div>
  );
}
