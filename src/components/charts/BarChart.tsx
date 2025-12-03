'use client';

import { useEffect, useRef } from 'react';

interface DataPoint {
  label: string;
  value: number;
  color?: string;
  targetLineValue?: number; // New: Target value for a watermark line
}

interface BarChartProps {
  data: DataPoint[];
  height?: number;
  color?: string;
  showGrid?: boolean;
  showValues?: boolean;
  horizontal?: boolean;
  formatType?: 'number' | 'currency' | 'shorthandCurrency';
}

export function BarChart({ 
  data, 
  height = 300, 
  color = '#3B82F6',
  showGrid = true,
  showValues = true,
  horizontal = false,
  formatType = 'number'
}: BarChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Helper function for shorthand currency formatting
  const toKValue = (num: number, currency: string = '£') => {
    num = Math.abs(num); // Work with absolute value for scaling
    if (num >= 1000000) {
      return `${currency}${(num / 1000000).toFixed(1)}M`;
    }
    if (num >= 1000) {
      return `${currency}${(num / 1000).toFixed(1)}k`;
    }
    return `${currency}${num.toFixed(0)}`; // For values less than 1000, keep as is
  };

  // Internal formatter
  const formatValue = (value: number) => {
    if (formatType === 'currency') {
      return `£${value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    if (formatType === 'shorthandCurrency') {
      const sign = value < 0 ? '-' : '';
      return sign + toKValue(value);
    }
    return value.toLocaleString('en-GB'); // Default number formatting
  };

  useEffect(() => {
    if (!canvasRef.current || !data.length) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    // Clear canvas
    ctx.clearRect(0, 0, rect.width, rect.height);

    // Calculate dimensions
    const padding = { 
      top: 30, // Increased top padding for labels
      right: horizontal ? 60 : 20, // Increased right padding for horizontal value labels
      bottom: horizontal ? 50 : 80, 
      left: horizontal ? 100 : 70 // Increased left padding for Y-axis labels
    };
    const chartWidth = rect.width - padding.left - padding.right;
    const chartHeight = rect.height - padding.top - padding.bottom;

    // Find min/max value, considering negative values for variance
    const allValues = data.map(d => d.value);
    // Include targetLineValues in the range calculation to ensure target lines are visible
    const allTargetValues = data.map(d => d.targetLineValue).filter(Boolean) as number[];
    const combinedValues = [...allValues, ...allTargetValues];

    const minValue = Math.min(0, ...combinedValues); 
    const maxValue = Math.max(...combinedValues, 1);
    
    // Adjust total range for proper scaling when negatives are present
    // Add headroom to maxValue so bars don't hit the very top
    const rangePadding = (maxValue - minValue) * 0.1;
    const adjustedMax = maxValue + rangePadding;
    const valueRange = adjustedMax - minValue;

    // Draw grid
    if (showGrid) {
      ctx.strokeStyle = '#E5E7EB';
      ctx.lineWidth = 1;

      if (horizontal) {
        // Vertical grid lines
        for (let i = 0; i <= 5; i++) {
          const valueAtLine = minValue + (valueRange * i) / 5;
          const x = padding.left + (chartWidth * i) / 5;
          ctx.beginPath();
          ctx.moveTo(x, padding.top);
          ctx.lineTo(x, padding.top + chartHeight);
          ctx.stroke();
        }
      } else {
        // Horizontal grid lines
        for (let i = 0; i <= 5; i++) {
          const valueAtLine = minValue + (valueRange * (5 - i)) / 5;
          const y = padding.top + (chartHeight * i) / 5;
          ctx.beginPath();
          ctx.moveTo(padding.left, y);
          ctx.lineTo(padding.left + chartWidth, y);
          ctx.stroke();
          // Also draw Y-axis value labels
          ctx.fillStyle = '#6B7280';
          ctx.font = '12px sans-serif';
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillText(formatValue(valueAtLine), padding.left - 10, y);
        }
      }
    }

    // Draw axes
    ctx.strokeStyle = '#6B7280';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, padding.top + chartHeight);
    ctx.lineTo(padding.left + chartWidth, padding.top + chartHeight);
    ctx.stroke();

    // Draw axis labels
    ctx.fillStyle = '#6B7280';
    ctx.font = '12px sans-serif';

    if (horizontal) {
      // X-axis labels (values)
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (let i = 0; i <= 5; i++) {
        const value = minValue + (valueRange * i) / 5;
        const x = padding.left + (chartWidth * i) / 5;
        ctx.fillText(formatValue(value), x, padding.top + chartHeight + 10);
      }

      // Y-axis labels (categories)
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const barHeight = chartHeight / data.length;
      data.forEach((item, index) => {
        const y = padding.top + barHeight * (index + 0.5);
        ctx.fillText(item.label, padding.left - 10, y);
      });
    } else {
      // X-axis labels (categories)
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const barWidth = chartWidth / data.length;
      
      // Intelligent label skipping
      // Aim for roughly 15-20 labels max to prevent overlap
      const maxLabels = 20;
      const step = Math.ceil(data.length / maxLabels);

      data.forEach((item, index) => {
        if (index % step !== 0) return; // Skip labels to avoid clutter

        const x = padding.left + barWidth * (index + 0.5);
        
        // Save context for rotation
        ctx.save();
        ctx.translate(x, padding.top + chartHeight + 10);
        ctx.rotate(-Math.PI / 4);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(item.label, 0, 0);
        ctx.restore();
      });
    }

    // Auto-hide values if too dense to be readable
    const shouldShowValues = showValues && data.length < 30;

    data.forEach((item, index) => {
      // Draw bars
      const barColor = item.color || color;
      ctx.fillStyle = barColor;

      if (horizontal) {
        const barHeight = chartHeight / data.length;
        const barPadding = barHeight * 0.2;
        const actualBarHeight = barHeight - barPadding;
        const barLength = (item.value / valueRange) * chartWidth; // Scale by total range
        
        const y = padding.top + barHeight * index + barPadding / 2;
        let x = padding.left;

        // Handle negative bars by starting from the zero line
        if (item.value < 0) {
            const zeroLineX = padding.left + (0 - minValue) / valueRange * chartWidth;
            x = zeroLineX + barLength; // Negative length means start further right
            ctx.fillRect(x, y, -barLength, actualBarHeight); // Draw leftwards
        } else {
            ctx.fillRect(x, y, barLength, actualBarHeight);
        }

        // Draw value
        if (shouldShowValues) {
          ctx.fillStyle = '#374151';
          ctx.font = '12px sans-serif';
          ctx.textAlign = item.value < 0 ? 'right' : 'left'; // Align to bar end
          ctx.textBaseline = 'middle';
          ctx.fillText(
            formatValue(item.value), 
            item.value < 0 ? x - 5 : x + barLength + 5, 
            y + actualBarHeight / 2
          );
        }

        // Draw target line
        if (item.targetLineValue !== undefined && item.targetLineValue !== null) {
          ctx.strokeStyle = '#9CA3AF'; // Light grey
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 2]); // Dashed line
          
          const targetX = padding.left + ((item.targetLineValue - minValue) / valueRange) * chartWidth;
          
          ctx.beginPath();
          ctx.moveTo(targetX, y);
          ctx.lineTo(targetX, y + actualBarHeight);
          ctx.stroke();
          ctx.setLineDash([]); // Reset line dash
        }
      } else {
        const barWidth = chartWidth / data.length;
        const barPadding = barWidth * 0.2;
        const actualBarWidth = barWidth - barPadding;
        
        const barValueHeight = (item.value / valueRange) * chartHeight; // Scale by total range
        
        const x = padding.left + barWidth * index + barPadding / 2;
        let y = padding.top + chartHeight - barValueHeight - ((0 - minValue) / valueRange * chartHeight);

        // Position of zero line relative to chart height
        const zeroLineY = padding.top + chartHeight - (0 - minValue) / valueRange * chartHeight;

        if (item.value < 0) {
            y = zeroLineY; // Start at zero line
            ctx.fillRect(x, y, actualBarWidth, -barValueHeight); // Draw upwards
        } else {
            ctx.fillRect(x, y, actualBarWidth, barValueHeight);
        }

        // Draw value
        if (shouldShowValues) {
          ctx.fillStyle = '#374151';
          ctx.font = '12px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = item.value < 0 ? 'top' : 'bottom'; // Align to bar end
          ctx.fillText(
            formatValue(item.value), 
            x + actualBarWidth / 2, 
            item.value < 0 ? y + 5 : y - 5
          );
        }

        // Draw target line
        if (item.targetLineValue !== undefined && item.targetLineValue !== null) {
          ctx.strokeStyle = '#9CA3AF'; // Light grey
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 2]); // Dashed line
          
          const targetY = padding.top + chartHeight - ((item.targetLineValue - minValue) / valueRange) * chartHeight;
          
          ctx.beginPath();
          ctx.moveTo(x, targetY);
          ctx.lineTo(x + actualBarWidth, targetY);
          ctx.stroke();
          ctx.setLineDash([]); // Reset line dash
        }
      }
    });
  }, [data, color, showGrid, showValues, horizontal, formatType]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: `${height}px` }}
      className="max-w-full"
    />
  );
}