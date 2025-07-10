interface Html2CanvasOptions {
  useCORS?: boolean;
  allowTaint?: boolean;
  scale?: number;
  logging?: boolean;
  width?: number;
  height?: number;
  windowWidth?: number;
  windowHeight?: number;
}

declare global {
  interface Window {
    html2canvas?: (element: HTMLElement, options?: Html2CanvasOptions) => Promise<HTMLCanvasElement>;
  }
}

export async function captureScreenshot(): Promise<string | null> {
  try {
    // Try to use html2canvas if available
    if (window.html2canvas) {
      const canvas = await window.html2canvas(document.body, {
        useCORS: true,
        allowTaint: false,
        scale: 1,
        logging: false,
        width: window.innerWidth,
        height: window.innerHeight,
        windowWidth: window.innerWidth,
        windowHeight: window.innerHeight,
      });
      
      return canvas.toDataURL('image/png', 0.8);
    }
    
    // Fallback: Try to use getDisplayMedia (requires user permission)
    if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            displaySurface: 'browser'
          }
        });
        
        // Create video element to capture frame
        const video = document.createElement('video');
        video.srcObject = stream;
        video.play();
        
        // Wait for video to load
        await new Promise(resolve => {
          video.onloadedmetadata = resolve;
        });
        
        // Create canvas and capture frame
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(video, 0, 0);
        
        // Clean up
        stream.getTracks().forEach(track => track.stop());
        
        return canvas.toDataURL('image/png', 0.8);
      } catch (error) {
        // User denied permission or not supported
        console.warn('getDisplayMedia not available or permission denied:', error);
      }
    }
    
    return null;
  } catch (error) {
    console.error('Failed to capture screenshot:', error);
    return null;
  }
}

// Load html2canvas dynamically if not already loaded
export async function loadHtml2Canvas(): Promise<boolean> {
  if (window.html2canvas) {
    return true;
  }
  
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}