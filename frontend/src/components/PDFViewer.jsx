import { useState, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { Button } from './ui/button';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Loader2, FileText } from 'lucide-react';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';

// Set up the worker
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

export default function PDFViewer({ pdfUrl, fileName, fileSize }) {
  const [numPages, setNumPages] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pdfData, setPdfData] = useState(null);

  useEffect(() => {
    const fetchPDF = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Fetch PDF as blob to bypass download headers
        const response = await fetch(pdfUrl);
        
        if (!response.ok) {
          throw new Error('Failed to fetch PDF');
        }
        
        const blob = await response.blob();
        
        // Convert blob to ArrayBuffer for react-pdf
        const arrayBuffer = await blob.arrayBuffer();
        setPdfData(arrayBuffer);
      } catch (err) {
        console.error('Error fetching PDF:', err);
        setError('Failed to load PDF. Please try again.');
        setLoading(false);
      }
    };

    if (pdfUrl) {
      fetchPDF();
    }
  }, [pdfUrl]);

  function onDocumentLoadSuccess({ numPages }) {
    setNumPages(numPages);
    setLoading(false);
    setError(null);
  }

  function onDocumentLoadError(error) {
    console.error('Error loading PDF:', error);
    setError('Failed to load PDF. The file may be corrupted or too large.');
    setLoading(false);
  }

  const goToPrevPage = () => {
    setPageNumber((prev) => Math.max(prev - 1, 1));
  };

  const goToNextPage = () => {
    setPageNumber((prev) => Math.min(prev + 1, numPages));
  };

  const zoomIn = () => {
    setScale((prev) => Math.min(prev + 0.2, 3.0));
  };

  const zoomOut = () => {
    setScale((prev) => Math.max(prev - 0.2, 0.5));
  };

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
