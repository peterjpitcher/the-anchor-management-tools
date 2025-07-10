'use client';

import { useState, useRef, useEffect } from 'react';
import { XMarkIcon, BugAntIcon, CameraIcon } from '@heroicons/react/24/outline';
import { ConsoleLogger } from '@/lib/bug-reporter/console-logger';
import { NetworkLogger } from '@/lib/bug-reporter/network-logger';
import { captureScreenshot, loadHtml2Canvas } from '@/lib/bug-reporter/screenshot-capture';

interface BugReporterProps {
  isOpen: boolean;
  onClose: () => void;
}

export function BugReporter({ isOpen, onClose }: BugReporterProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [includeScreenshot, setIncludeScreenshot] = useState(true);
  const [includeLogs, setIncludeLogs] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [screenshotDataUrl, setScreenshotDataUrl] = useState<string | null>(null);
  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false);
  
  const consoleLogger = useRef<ConsoleLogger | null>(null);
  const networkLogger = useRef<NetworkLogger | null>(null);
  
  // Initialize loggers on mount
  useEffect(() => {
    if (!consoleLogger.current) {
      consoleLogger.current = new ConsoleLogger();
    }
    if (!networkLogger.current) {
      networkLogger.current = new NetworkLogger();
    }
    
    // Load html2canvas
    loadHtml2Canvas();
    
    // Cleanup on unmount
    return () => {
      if (consoleLogger.current) {
        consoleLogger.current.destroy();
      }
      if (networkLogger.current) {
        networkLogger.current.destroy();
      }
    };
  }, []);
  
  const handleCaptureScreenshot = async () => {
    setIsCapturingScreenshot(true);
    try {
      // Hide the modal temporarily
      const modalElement = document.getElementById('bug-reporter-modal');
      if (modalElement) {
        modalElement.style.display = 'none';
      }
      
      // Wait a bit for the modal to hide
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const screenshot = await captureScreenshot();
      setScreenshotDataUrl(screenshot);
      
      // Show the modal again
      if (modalElement) {
        modalElement.style.display = '';
      }
    } catch (error) {
      console.error('Failed to capture screenshot:', error);
    } finally {
      setIsCapturingScreenshot(false);
    }
  };
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!title.trim() || !description.trim()) {
      alert('Please provide both title and description');
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      // Capture screenshot if requested and not already captured
      if (includeScreenshot && !screenshotDataUrl) {
        await handleCaptureScreenshot();
      }
      
      // Get logs
      const consoleLogs = includeLogs && consoleLogger.current ? consoleLogger.current.getLogs() : '';
      const networkLogs = includeLogs && networkLogger.current ? networkLogger.current.getLogs() : '';
      
      // Submit to API route
      const response = await fetch('/api/bug-report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title,
          description,
          consoleLogs,
          networkLogs,
          screenshotDataUrl: includeScreenshot ? screenshotDataUrl : null,
        }),
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Failed to submit bug report');
      }
      
      // Success
      alert(`Bug report created successfully! Issue #${result.issueNumber}`);
      
      // Reset form
      setTitle('');
      setDescription('');
      setScreenshotDataUrl(null);
      onClose();
      
    } catch (error) {
      console.error('Failed to submit bug report:', error);
      alert(`Failed to submit bug report: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsSubmitting(false);
    }
  };
  
  if (!isOpen) return null;
  
  return (
    <div 
      id="bug-reporter-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
    >
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <BugAntIcon className="h-6 w-6" />
            Report a Bug
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            disabled={isSubmitting}
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-4 space-y-4 overflow-y-auto max-h-[calc(90vh-120px)]">
          <div>
            <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">
              Title *
            </label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Brief description of the issue"
              required
              disabled={isSubmitting}
            />
          </div>
          
          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
              Description *
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={4}
              placeholder="Please describe what happened, what you expected to happen, and steps to reproduce the issue"
              required
              disabled={isSubmitting}
            />
          </div>
          
          <div className="space-y-3">
            <div className="flex items-center">
              <input
                id="includeScreenshot"
                type="checkbox"
                checked={includeScreenshot}
                onChange={(e) => setIncludeScreenshot(e.target.checked)}
                className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                disabled={isSubmitting}
              />
              <label htmlFor="includeScreenshot" className="ml-2 text-sm text-gray-700">
                Include screenshot
              </label>
            </div>
            
            {includeScreenshot && (
              <div className="ml-6">
                {screenshotDataUrl ? (
                  <div className="space-y-2">
                    <img 
                      src={screenshotDataUrl} 
                      alt="Screenshot preview" 
                      className="max-w-full h-32 object-contain border border-gray-300 rounded"
                    />
                    <button
                      type="button"
                      onClick={handleCaptureScreenshot}
                      disabled={isCapturingScreenshot || isSubmitting}
                      className="text-sm text-blue-600 hover:text-blue-800"
                    >
                      Retake screenshot
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleCaptureScreenshot}
                    disabled={isCapturingScreenshot || isSubmitting}
                    className="flex items-center gap-2 px-3 py-1 text-sm text-blue-600 hover:text-blue-800 border border-blue-600 rounded"
                  >
                    <CameraIcon className="h-4 w-4" />
                    {isCapturingScreenshot ? 'Capturing...' : 'Capture screenshot'}
                  </button>
                )}
              </div>
            )}
            
            <div className="flex items-center">
              <input
                id="includeLogs"
                type="checkbox"
                checked={includeLogs}
                onChange={(e) => setIncludeLogs(e.target.checked)}
                className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                disabled={isSubmitting}
              />
              <label htmlFor="includeLogs" className="ml-2 text-sm text-gray-700">
                Include console and network logs
              </label>
            </div>
          </div>
          
          <div className="bg-blue-50 p-3 rounded-md">
            <p className="text-sm text-blue-800">
              <strong>Note:</strong> This will create a public issue on GitHub. Do not include sensitive information.
            </p>
          </div>
          
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Submitting...' : 'Submit Bug Report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}