import React from 'react';
import { X, Pause, Play, CheckCircle, AlertCircle, Upload } from 'lucide-react';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Progress } from './ui/progress';

export default function UploadQueue({ uploads, onPause, onResume, onCancel, onClear }) {
  if (!uploads || uploads.length === 0) {
    return null;
  }

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  };

  const formatSpeed = (bytesPerSecond) => {
    if (!bytesPerSecond || bytesPerSecond === 0) return '0 B/s';
    return `${formatFileSize(bytesPerSecond)}/s`;
  };

  const formatETA = (seconds) => {
    if (!seconds || seconds <= 0 || !isFinite(seconds)) return '--';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'error':
        return <AlertCircle className="w-5 h-5 text-red-600" />;
      case 'paused':
        return <Pause className="w-5 h-5 text-yellow-600" />;
      case 'uploading':
        return <Upload className="w-5 h-5 text-blue-600 animate-pulse" />;
      default:
        return <Upload className="w-5 h-5 text-gray-400" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return 'bg-green-500';
      case 'error':
        return 'bg-red-500';
      case 'paused':
        return 'bg-yellow-500';
      case 'uploading':
        return 'bg-blue-500';
      default:
        return 'bg-gray-400';
    }
  };

  const activeUploads = uploads.filter(u => u.status !== 'completed');
  const completedUploads = uploads.filter(u => u.status === 'completed');

  return (
    <div className="fixed bottom-6 right-6 w-[400px] max-h-[600px] z-50">
      <Card className="shadow-2xl border-2 border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Upload className="w-5 h-5" />
              <div>
                <h3 className="font-semibold text-sm">
                  {activeUploads.length > 0 ? `Uploading ${activeUploads.length} ${activeUploads.length === 1 ? 'file' : 'files'}` : 'Uploads Complete'}
                </h3>
                {completedUploads.length > 0 && (
                  <p className="text-xs opacity-90">
                    {completedUploads.length} completed
                  </p>
                )}
              </div>
            </div>
            {completedUploads.length > 0 && activeUploads.length === 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onClear}
                className="text-white hover:bg-white/20 h-7 px-2"
              >
                Clear
              </Button>
            )}
          </div>
        </div>

        {/* Upload List */}
        <div className="max-h-[500px] overflow-y-auto bg-gray-50">
          {uploads.map((upload) => (
            <div
              key={upload.id}
              className={`p-4 border-b border-gray-200 bg-white hover:bg-gray-50 transition-colors ${
                upload.status === 'completed' ? 'opacity-75' : ''
              }`}
            >
              <div className="flex items-start space-x-3">
                {/* Status Icon */}
                <div className="flex-shrink-0 mt-1">
                  {getStatusIcon(upload.status)}
                </div>

                {/* File Info */}
                <div className="flex-1 min-w-0">
                  {/* File Name */}
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-gray-900 truncate pr-2" title={upload.name}>
                      {upload.name}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onCancel(upload.id)}
                      className="h-6 w-6 p-0 hover:bg-red-50 hover:text-red-600 flex-shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>

                  {/* Progress Bars - Two Phases */}
                  {upload.status !== 'completed' && (
                    <div className="mb-2 space-y-2">
                      {/* Phase 1: Upload to Server */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-gray-600">
                            📤 Uploading to server
                          </span>
                          <span className="text-xs font-semibold text-gray-700">
                            {upload.phase === 'uploading' ? `${upload.progress.toFixed(0)}%` : '100%'}
                          </span>
                        </div>
                        <Progress 
                          value={upload.phase === 'uploading' ? upload.progress : 100} 
                          className="h-2"
                          indicatorClassName={upload.phase === 'uploading' ? 'bg-blue-500' : 'bg-green-500'}
                        />
                      </div>

                      {/* Phase 2: Upload to Telegram (shows after phase 1 completes) */}
                      {(upload.phase === 'telegram' || upload.phase === 'completed') && (
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium text-gray-600">
                              📨 Uploading to Telegram
                            </span>
                            <span className="text-xs font-semibold text-purple-600">
                              {upload.telegramProgress !== undefined ? `${upload.telegramProgress.toFixed(0)}%` : '0%'}
                            </span>
                          </div>
                          <Progress 
                            value={upload.telegramProgress || 0} 
                            className="h-2"
                            indicatorClassName={upload.phase === 'completed' ? 'bg-green-500' : 'bg-purple-500'}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Stats Row */}
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <div className="flex items-center space-x-3">
                      {/* Phase Description */}
                      {upload.phase === 'uploading' && (
                        <>
                          <span className="font-medium text-blue-600">
                            Uploading chunks
                          </span>
                          <span>
                            {formatFileSize(upload.uploadedSize || 0)} / {formatFileSize(upload.size)}
                          </span>
                        </>
                      )}
                      
                      {upload.phase === 'telegram' && (
                        <>
                          <span className="font-medium text-purple-600">
                            Uploading to Telegram
                          </span>
                          <span>
                            {formatFileSize(upload.size)}
                          </span>
                        </>
                      )}

                      {/* Speed */}
                      {upload.status === 'uploading' && upload.speed > 0 && (
                        <span className="text-blue-600">
                          {formatSpeed(upload.speed)}
                        </span>
                      )}
                    </div>

                    {/* ETA */}
                    {upload.status === 'uploading' && upload.eta > 0 && (
                      <span className="text-gray-600">
                        ETA: {formatETA(upload.eta)}
                      </span>
                    )}
                  </div>

                  {/* Status Messages */}
                  {upload.status === 'error' && upload.error && (
                    <p className="text-xs text-red-600 mt-2">
                      Error: {upload.error}
                    </p>
                  )}

                  {upload.status === 'paused' && (
                    <p className="text-xs text-yellow-600 mt-2">
                      Upload paused
                    </p>
                  )}

                  {upload.status === 'completed' && (
                    <p className="text-xs text-green-600 mt-2">
                      Upload complete!
                    </p>
                  )}

                  {/* Action Buttons */}
                  {(upload.status === 'uploading' || upload.status === 'paused') && (
                    <div className="flex items-center space-x-2 mt-3">
                      {upload.status === 'uploading' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onPause(upload.id)}
                          className="h-7 text-xs"
                        >
                          <Pause className="w-3 h-3 mr-1" />
                          Pause
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onResume(upload.id)}
                          className="h-7 text-xs"
                        >
                          <Play className="w-3 h-3 mr-1" />
                          Resume
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
