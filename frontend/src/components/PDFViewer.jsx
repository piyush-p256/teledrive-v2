import { Button } from './ui/button';
import { Download, FileText } from 'lucide-react';

export default function PDFViewer({ pdfUrl, fileName, fileSize }) {
  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = pdfUrl;
    link.download = fileName;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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

        {/* Zoom Controls */}
        {!loading && !error && (
          <div className="flex items-center gap-2">
            <Button
              onClick={zoomOut}
              variant="ghost"
              size="sm"
              className="text-white hover:bg-gray-700"
              disabled={scale <= 0.5}
            >
              <ZoomOut className="w-4 h-4" />
            </Button>
            <span className="text-sm text-gray-300 min-w-[60px] text-center">
              {Math.round(scale * 100)}%
            </span>
            <Button
              onClick={zoomIn}
              variant="ghost"
              size="sm"
              className="text-white hover:bg-gray-700"
              disabled={scale >= 3.0}
            >
              <ZoomIn className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>

      {/* PDF Content */}
      <div className="flex-1 overflow-auto bg-gray-900 flex items-center justify-center p-4">
        {loading && (
          <div className="flex flex-col items-center space-y-4">
            <Loader2 className="w-12 h-12 text-indigo-500 animate-spin" />
            <p className="text-white text-sm">Loading PDF...</p>
          </div>
        )}

        {error && (
          <div className="text-center">
            <p className="text-red-400 text-lg mb-4">{error}</p>
            <Button
              onClick={() => window.open(pdfUrl, '_blank')}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              Try Opening in New Tab
            </Button>
          </div>
        )}

        {!loading && !error && pdfData && (
          <div className="bg-white shadow-2xl">
            <Document
              file={{ data: pdfData }}
              onLoadSuccess={onDocumentLoadSuccess}
              onLoadError={onDocumentLoadError}
              loading={
                <div className="flex items-center justify-center p-8">
                  <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                </div>
              }
              options={{
                cMapUrl: `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/cmaps/`,
                cMapPacked: true,
                standardFontDataUrl: `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/standard_fonts/`,
              }}
            >
              <Page
                pageNumber={pageNumber}
                scale={scale}
                renderTextLayer={true}
                renderAnnotationLayer={true}
              />
            </Document>
          </div>
        )}
      </div>

      {/* PDF Navigation Footer */}
      {!loading && !error && numPages && (
        <div className="bg-gray-800 text-white px-6 py-3 flex items-center justify-between border-t border-gray-700">
          <Button
            onClick={goToPrevPage}
            variant="ghost"
            size="sm"
            disabled={pageNumber <= 1}
            className="text-white hover:bg-gray-700"
          >
            <ChevronLeft className="w-5 h-5 mr-1" />
            Previous
          </Button>

          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-300">
              Page {pageNumber} of {numPages}
            </span>
            <div className="flex gap-2">
              <input
                type="number"
                min="1"
                max={numPages}
                value={pageNumber}
                onChange={(e) => {
                  const page = parseInt(e.target.value);
                  if (page >= 1 && page <= numPages) {
                    setPageNumber(page);
                  }
                }}
                className="w-16 px-2 py-1 bg-gray-700 text-white text-sm rounded border border-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <Button
            onClick={goToNextPage}
            variant="ghost"
            size="sm"
            disabled={pageNumber >= numPages}
            className="text-white hover:bg-gray-700"
          >
            Next
            <ChevronRight className="w-5 h-5 ml-1" />
          </Button>
        </div>
      )}
    </div>
  );
}
