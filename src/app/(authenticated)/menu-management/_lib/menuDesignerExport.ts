'use client';

import { downloadBlob } from '@/lib/download-file';
import type { DishListItem, MenuSummary } from '../dishes/_components/DishExpandedRow';

type CsvValue = string | number | null | undefined;

interface DesignerMenuExportOptions {
  menuCode: string;
  menuName?: string;
  menus?: MenuSummary[];
  date?: Date;
}

interface DesignerMenuExportRow {
  menu: string;
  category: string;
  itemOrder: number;
  name: string;
  price: number;
  description: string;
  gpPct: string;
  categoryRank: number;
}

const DESIGNER_EXPORT_HEADERS = [
  'Menu',
  'Menu Category',
  'Item Order',
  'Name',
  'Price (GBP)',
  'Description',
  'GP %',
];

function escapeCsvValue(value: CsvValue): string {
  if (value == null) return '';
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(rows: DesignerMenuExportRow[]): string {
  const body = rows.map((row) => [
    row.menu,
    row.category,
    row.itemOrder,
    row.name,
    row.price.toFixed(2),
    row.description,
    row.gpPct,
  ]);

  return [
    DESIGNER_EXPORT_HEADERS.map(escapeCsvValue).join(','),
    ...body.map((row) => row.map(escapeCsvValue).join(',')),
  ].join('\n');
}

function formatGpPct(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  const percentage = value > 1 ? value : value * 100;
  return `${percentage.toFixed(1)}%`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'menu';
}

function categoryOrderForMenu(menuCode: string, menus: MenuSummary[] | undefined): Map<string, number> {
  const menu = menus?.find((entry) => entry.code === menuCode);
  return new Map((menu?.categories ?? []).map((category, index) => [category.code, index]));
}

export function buildDesignerMenuExportRows(
  dishes: DishListItem[],
  options: DesignerMenuExportOptions,
): DesignerMenuExportRow[] {
  const categoryOrder = categoryOrderForMenu(options.menuCode, options.menus);
  const menuName = options.menuName || options.menus?.find((menu) => menu.code === options.menuCode)?.name || options.menuCode;

  return dishes
    .filter((dish) => dish.is_active)
    .flatMap((dish) =>
      dish.assignments
        .filter((assignment) => assignment.menu_code === options.menuCode)
        .map((assignment) => ({
          menu: assignment.menu_name || menuName,
          category: assignment.category_name || assignment.category_code || 'Uncategorised',
          itemOrder: assignment.sort_order ?? 0,
          name: dish.name,
          price: dish.selling_price,
          description: dish.description ?? '',
          gpPct: formatGpPct(dish.gp_pct),
          categoryRank: categoryOrder.get(assignment.category_code) ?? Number.MAX_SAFE_INTEGER,
        }))
    )
    .sort((a, b) => {
      if (a.categoryRank !== b.categoryRank) return a.categoryRank - b.categoryRank;
      const categoryCompare = a.category.localeCompare(b.category);
      if (categoryCompare !== 0) return categoryCompare;
      if (a.itemOrder !== b.itemOrder) return a.itemOrder - b.itemOrder;
      return a.name.localeCompare(b.name);
    });
}

export function exportDesignerMenuCsv(
  dishes: DishListItem[],
  options: DesignerMenuExportOptions,
): { filename: string; rowCount: number } {
  const rows = buildDesignerMenuExportRows(dishes, options);
  const menuName = options.menuName || options.menus?.find((menu) => menu.code === options.menuCode)?.name || options.menuCode;
  const dateStamp = (options.date ?? new Date()).toISOString().slice(0, 10);
  const filename = `menu-designer-${slugify(menuName)}-${dateStamp}.csv`;

  if (rows.length === 0) {
    return { filename, rowCount: 0 };
  }

  const blob = new Blob([`\uFEFF${toCsv(rows)}`], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, filename);

  return { filename, rowCount: rows.length };
}
