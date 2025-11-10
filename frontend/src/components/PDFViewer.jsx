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
      </div>

      {/* PDF Content - Preview Not Available */}
      <div className="flex-1 overflow-auto bg-gray-900 flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <div className="mb-6 inline-flex items-center justify-center w-24 h-24 rounded-full bg-indigo-600/20">
            <FileText className="w-12 h-12 text-indigo-400" />
          </div>
          
          <h3 className="text-xl font-semibold text-white mb-3">
            PDF Preview Not Available
          </h3>
          
          <p className="text-gray-400 mb-6">
            PDF preview is not supported due to security restrictions. 
            Click the button below to download and view the file.
          </p>
          
          <Button
            onClick={handleDownload}
            className="bg-indigo-600 hover:bg-indigo-700 text-white"
            size="lg"
          >
            <Download className="w-5 h-5 mr-2" />
            Download PDF
          </Button>
          
          <p className="text-gray-500 text-sm mt-4">
            {fileName} • {formatFileSize(fileSize)}
          </p>
        </div>
      </div>
    </div>
  );
}
