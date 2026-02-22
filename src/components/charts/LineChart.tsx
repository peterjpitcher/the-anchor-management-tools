'use client';

import { useEffect, useRef } from 'react';

interface DataPoint {
  date: string;
  value: number;
}

interface LineChartProps {
  data: DataPoint[];
  height?: number;
  color?: string;
  showGrid?: boolean;
  label?: string;
  xAxisFormatter?: (date: string, index: number) => string;
}

export function LineChart({ 
  data, 
  height = 300, 
  color = '#3B82F6',
  showGrid = true,
  label = 'Clicks',
  xAxisFormatter
}: LineChartProps) {
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
    const padding = { top: 20, right: 20, bottom: 50, left: 50 };
    const chartWidth = rect.width - padding.left - padding.right;
    const chartHeight = rect.height - padding.top - padding.bottom;

    // Find min/max values
    const values = data.map(d => d.value);
    const maxValue = Math.max(...values, 1);
    const minValue = 0;
    const valueRange = Math.max(maxValue - minValue, 1);
    const getXPosition = (index: number) => {
      if (data.length === 1) {
        return padding.left + chartWidth / 2;
      }
      return padding.left + (chartWidth * index) / (data.length - 1);
    };

    // Draw grid
    if (showGrid) {
      ctx.strokeStyle = '#E5E7EB';
      ctx.lineWidth = 1;

      // Horizontal grid lines
      for (let i = 0; i <= 5; i++) {
        const y = padding.top + (chartHeight * i) / 5;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(padding.left + chartWidth, y);
        ctx.stroke();
      }

      // Vertical grid lines
      const step = Math.max(1, Math.ceil(data.length / 7));
      for (let i = 0; i < data.length; i += step) {
        const x = getXPosition(i);
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, padding.top + chartHeight);
        ctx.stroke();
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

    // Draw Y-axis labels
    ctx.fillStyle = '#6B7280';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let i = 0; i <= 5; i++) {
      const value = maxValue - (maxValue * i) / 5;
      const y = padding.top + (chartHeight * i) / 5;
      ctx.fillText(Math.round(value).toString(), padding.left - 10, y);
    }

    // Draw X-axis labels
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const labelStep = Math.max(1, Math.ceil(data.length / 7));
    
    for (let i = 0; i < data.length; i += labelStep) {
      const x = getXPosition(i);
      const defaultDate = new Date(data[i].date);
      const defaultLabel = `${defaultDate.getMonth() + 1}/${defaultDate.getDate()}`;
      const label = xAxisFormatter ? xAxisFormatter(data[i].date, i) : defaultLabel;
      ctx.fillText(label, x, padding.top + chartHeight + 10);
    }

    // Draw line
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    ctx.beginPath();
    data.forEach((point, index) => {
      const x = getXPosition(index);
      const y = padding.top + chartHeight - ((point.value - minValue) / valueRange) * chartHeight;

      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();

    // Draw points
    ctx.fillStyle = color;
    data.forEach((point, index) => {
      const x = getXPosition(index);
      const y = padding.top + chartHeight - ((point.value - minValue) / valueRange) * chartHeight;

      ctx.beginPath();
      ctx.arc(x, y, 3, 0, 2 * Math.PI);
      ctx.fill();
    });

    // Draw label
    if (label) {
      ctx.fillStyle = '#374151';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(label, padding.left, 5);
    }
  }, [data, color, showGrid, label, xAxisFormatter]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: `${height}px` }}
      className="max-w-full"
    />
  );
}
