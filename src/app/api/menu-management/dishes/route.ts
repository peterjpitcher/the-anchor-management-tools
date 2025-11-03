import { NextRequest, NextResponse } from 'next/server';
import {
  listMenuDishes,
  createMenuDish,
} from '@/app/actions/menu-management';

export async function GET(request: NextRequest) {
  const menuCode = request.nextUrl.searchParams.get('menu_code') || undefined;
  const result = await listMenuDishes(menuCode);
  const status = result.error ? 400 : 200;
  return NextResponse.json(result, { status });
}

export async function POST(request: NextRequest) {
  const payload = await request.json();
  const result = await createMenuDish(payload);
  const status = result.error ? 400 : 201;
  return NextResponse.json(result, { status });
}
