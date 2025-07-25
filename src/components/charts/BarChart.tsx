'use client';

import { useEffect, useRef } from 'react';

interface DataPoint {
  label: string;
  value: number;
  color?: string;
}

interface BarChartProps {
  data: DataPoint[];
  height?: number;
  color?: string;
  showGrid?: boolean;
  showValues?: boolean;
  horizontal?: boolean;
}

export function BarChart({ 
  data, 
  height = 300, 
  color = '#3B82F6',
  showGrid = true,
  showValues = true,
  horizontal = false
}: BarChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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
      top: 20, 
      right: 20, 
      bottom: horizontal ? 50 : 80, 
      left: horizontal ? 100 : 50 
    };
    const chartWidth = rect.width - padding.left - padding.right;
    const chartHeight = rect.height - padding.top - padding.bottom;

    // Find max value
    const maxValue = Math.max(...data.map(d => d.value), 1);

    // Draw grid
    if (showGrid) {
      ctx.strokeStyle = '#E5E7EB';
      ctx.lineWidth = 1;

      if (horizontal) {
        // Vertical grid lines
        for (let i = 0; i <= 5; i++) {
          const x = padding.left + (chartWidth * i) / 5;
          ctx.beginPath();
          ctx.moveTo(x, padding.top);
          ctx.lineTo(x, padding.top + chartHeight);
          ctx.stroke();
        }
      } else {
        // Horizontal grid lines
        for (let i = 0; i <= 5; i++) {
          const y = padding.top + (chartHeight * i) / 5;
          ctx.beginPath();
          ctx.moveTo(padding.left, y);
          ctx.lineTo(padding.left + chartWidth, y);
          ctx.stroke();
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
        const value = (maxValue * i) / 5;
        const x = padding.left + (chartWidth * i) / 5;
        ctx.fillText(Math.round(value).toString(), x, padding.top + chartHeight + 10);
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
      // Y-axis labels (values)
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (let i = 0; i <= 5; i++) {
        const value = maxValue - (maxValue * i) / 5;
        const y = padding.top + (chartHeight * i) / 5;
        ctx.fillText(Math.round(value).toString(), padding.left - 10, y);
      }

      // X-axis labels (categories)
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const barWidth = chartWidth / data.length;
      data.forEach((item, index) => {
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

    // Draw bars
    data.forEach((item, index) => {
      const barColor = item.color || color;
      ctx.fillStyle = barColor;

      if (horizontal) {
        const barHeight = chartHeight / data.length;
        const barPadding = barHeight * 0.2;
        const actualBarHeight = barHeight - barPadding;
        const barLength = (item.value / maxValue) * chartWidth;
        const y = padding.top + barHeight * index + barPadding / 2;

        ctx.fillRect(padding.left, y, barLength, actualBarHeight);

        // Draw value
        if (showValues) {
          ctx.fillStyle = '#374151';
          ctx.font = '12px sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(
            item.value.toString(), 
            padding.left + barLength + 5, 
            y + actualBarHeight / 2
          );
        }
      } else {
        const barWidth = chartWidth / data.length;
        const barPadding = barWidth * 0.2;
        const actualBarWidth = barWidth - barPadding;
        const barHeight = (item.value / maxValue) * chartHeight;
        const x = padding.left + barWidth * index + barPadding / 2;
        const y = padding.top + chartHeight - barHeight;

        ctx.fillRect(x, y, actualBarWidth, barHeight);

        // Draw value
        if (showValues) {
          ctx.fillStyle = '#374151';
          ctx.font = '12px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(
            item.value.toString(), 
            x + actualBarWidth / 2, 
            y - 5
          );
        }
      }
    });
  }, [data, color, showGrid, showValues, horizontal]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: `${height}px` }}
      className="max-w-full"
    />
  );
}