import { cloneElement, isValidElement, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import {
  BarChart,
  CHART_COLOURS,
  ChartTooltipFrame,
  ChartTooltipRow,
  ComboChart,
  LineChart,
  chartClickIndex,
  chartColour,
  formatChartValue,
  niceChartDomain,
} from './Chart'

// jsdom has no layout, so ResponsiveContainer measures 0 x 0 and draws nothing. Give the chart a
// fixed size instead.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) => (
      <div data-testid="chart-size">
        {isValidElement<{ width?: number; height?: number }>(children)
          ? cloneElement(children, { width: 800, height: 300 })
          : children}
      </div>
    ),
  }
})

describe('chart number formatting', () => {
  it.each([
    [1234.5, 'number', '1,234.5'],
    [1234.5, 'currency', '£1,234.50'],
    [-1234.5, 'currency', '-£1,234.50'],
    [950, 'shorthandCurrency', '£950'],
    [1234, 'shorthandCurrency', '£1.2k'],
    [-3_400_000, 'shorthandCurrency', '-£3.4M'],
    [12.345, 'percent', '12.3%'],
  ] as const)('formats %s as %s', (value, format, expected) => {
    expect(formatChartValue(value, format)).toBe(expected)
  })

  it('takes a custom formatter', () => {
    expect(formatChartValue(7.5, (value) => `${value}h`)).toBe('7.5h')
  })

  it('prints nothing for a missing number', () => {
    expect(formatChartValue(Number.NaN, 'currency')).toBe('')
  })
})

describe('niceChartDomain', () => {
  it('starts at zero and ends on a round step with headroom', () => {
    expect(niceChartDomain([120, 480, 300])).toEqual([0, 600])
  })

  it('goes below zero for negative values', () => {
    const [low, high] = niceChartDomain([-50, 200])
    expect(low).toBeLessThan(-50)
    expect(high).toBeGreaterThan(200)
  })

  it('gives an empty or all-zero series a 0 to 1 axis', () => {
    expect(niceChartDomain([])).toEqual([0, 1])
    expect(niceChartDomain([0, 0])).toEqual([0, 1])
  })
})

describe('chart helpers', () => {
  it('cycles the six chart tokens', () => {
    expect(CHART_COLOURS).toHaveLength(6)
    expect(chartColour(0)).toBe('var(--color-chart-1)')
    expect(chartColour(6)).toBe('var(--color-chart-1)')
    expect(chartColour(7)).toBe('var(--color-chart-2)')
  })

  it('reads the clicked category index and ignores misses', () => {
    expect(chartClickIndex({ activeTooltipIndex: '2' }, 5)).toBe(2)
    expect(chartClickIndex({ activeTooltipIndex: 0 }, 5)).toBe(0)
    expect(chartClickIndex({ activeTooltipIndex: null }, 5)).toBeNull()
    expect(chartClickIndex({ activeTooltipIndex: '9' }, 5)).toBeNull()
    expect(chartClickIndex(undefined, 5)).toBeNull()
  })

  it('draws the shared tooltip card', () => {
    render(
      <ChartTooltipFrame title="Mar 2026">
        <ChartTooltipRow color="var(--color-chart-2)" label="Drinks" value="£1,200.00" />
      </ChartTooltipFrame>,
    )

    expect(screen.getByText('Mar 2026')).toHaveClass('text-text-muted')
    expect(screen.getByText('£1,200.00')).toHaveClass('font-semibold', 'text-text-strong')
  })
})

describe('BarChart', () => {
  const data = [
    { label: 'Jan', value: 1200 },
    { label: 'Feb', value: 850, color: 'var(--color-chart-3)' },
    { label: 'Mar', value: 1500, targetLineValue: 1400 },
  ]

  it('draws one bar per item in the chart colours, with value labels', () => {
    const { container } = render(<BarChart data={data} formatType="shorthandCurrency" ariaLabel="Takings by month" />)

    // A named figure, not an img: an img would hide the chart's own keyboard stop inside it.
    const figure = screen.getByRole('figure', { name: 'Takings by month' })
    expect(within(figure).getByRole('application')).toHaveAttribute('tabindex', '0')
    expect(screen.queryByRole('img', { name: 'Takings by month' })).toBeNull()
    const bars = container.querySelectorAll('.recharts-bar-rectangle')
    expect(bars).toHaveLength(3)
    const fills = Array.from(container.querySelectorAll('.recharts-bar-rectangle path, .recharts-bar-rectangle rect')).map(
      (shape) => shape.getAttribute('fill'),
    )
    expect(fills).toContain('var(--color-chart-1)')
    expect(fills).toContain('var(--color-chart-3)')
    // Within the chart: recharts leaves a hidden text-measuring span on the page.
    const labels = Array.from(container.querySelectorAll('.recharts-label')).map((label) => label.textContent)
    expect(labels).toEqual(['£1.2k', '£850', '£1.5k'])
    expect(within(container).getAllByText('£1.5k').length).toBeGreaterThan(0)
  })

  it('draws the dashed target marker for an item with a target', () => {
    const { container } = render(<BarChart data={data} />)

    expect(container.querySelectorAll('line[stroke-dasharray="4 2"]')).toHaveLength(1)
  })

  it('hides the value labels past 31 bars, as the canvas chart did', () => {
    const many = Array.from({ length: 32 }, (_, index) => ({ label: `D${index + 1}`, value: 100 + index }))
    const { container } = render(<BarChart data={many} />)

    expect(container.querySelector('.recharts-label-list')).toBeNull()
  })

  it('is 300px tall by default and takes a pointer cursor when bars are clickable', () => {
    render(<BarChart data={data} onBarClick={() => undefined} />)

    const sized = screen.getByTestId('chart-size').parentElement
    expect(sized).toHaveStyle({ height: '300px' })
    expect(sized).toHaveClass('cursor-pointer')
  })

  it('lays the bars sideways when horizontal', () => {
    const { container } = render(<BarChart data={data} horizontal showValues={false} />)

    expect(container.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(3)
    expect(container.querySelector('.recharts-label-list')).toBeNull()
  })
})

describe('LineChart and ComboChart', () => {
  type Month = { month: string; drinks: number; food: number; drinksShare: number }
  const months: Month[] = [
    { month: 'Jan', drinks: 1000, food: 600, drinksShare: 62.5 },
    { month: 'Feb', drinks: 1200, food: 700, drinksShare: 63.2 },
    { month: 'Mar', drinks: 900, food: 800, drinksShare: 52.9 },
  ]

  it('draws lines, a legend for several series and a dot on the last point', () => {
    const { container } = render(
      <LineChart
        data={months}
        xKey="month"
        series={[
          { key: 'drinks', label: 'Drinks' },
          { key: 'food', label: 'Food', dashed: true },
        ]}
        markLastPoint
      />,
    )

    expect(container.querySelectorAll('.recharts-line')).toHaveLength(2)
    expect(screen.getByText('Drinks')).toBeInTheDocument()
    expect(screen.getByText('Food')).toBeInTheDocument()
    expect(container.querySelector('.recharts-reference-dot')).not.toBeNull()
    const strokes = Array.from(container.querySelectorAll('.recharts-line-curve')).map((line) => line.getAttribute('stroke'))
    expect(strokes).toEqual(['var(--color-chart-1)', 'var(--color-chart-2)'])
  })

  it('fills an area series with its own gradient', () => {
    const { container } = render(
      <LineChart data={months} xKey="month" series={[{ key: 'drinks', label: 'Drinks', type: 'area' }]} />,
    )

    const gradient = container.querySelector('linearGradient')
    expect(gradient).not.toBeNull()
    expect(container.querySelector('.recharts-area-area')?.getAttribute('fill')).toBe(`url(#${gradient?.id})`)
    // One series: no legend.
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('groups bars and adds a right axis for a line on it', () => {
    const { container } = render(
      <ComboChart
        data={months}
        xKey="month"
        leftAxis={{ format: 'currency' }}
        rightAxis={{ format: 'percent', domain: [0, 100] }}
        series={[
          { key: 'drinks', label: 'Drinks sales' },
          { key: 'food', label: 'Food sales' },
          { key: 'drinksShare', label: 'Drinks %', type: 'line', axis: 'right' },
        ]}
      />,
    )

    expect(container.querySelectorAll('.recharts-bar')).toHaveLength(2)
    expect(container.querySelectorAll('.recharts-line')).toHaveLength(1)
    expect(container.querySelectorAll('.recharts-yAxis')).toHaveLength(2)
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Drinks sales', 'Food sales', 'Drinks %'])
  })

  it('draws a reference line and takes a responsive height class', () => {
    const { container } = render(
      <LineChart
        data={months}
        xKey="month"
        series={[{ key: 'drinks', label: 'Balance', type: 'area' }]}
        leftAxis={{ domain: ['auto', 'auto'] }}
        referenceLines={[{ value: 1000, tone: 'danger' }]}
        heightClassName="h-[320px] sm:h-[420px]"
      />,
    )

    expect(container.querySelector('.recharts-reference-line line')?.getAttribute('stroke')).toBe('var(--color-danger)')
    const sized = screen.getByTestId('chart-size').parentElement
    expect(sized).toHaveClass('h-[320px]', 'sm:h-[420px]')
    expect(sized).not.toHaveAttribute('style')
  })
})
