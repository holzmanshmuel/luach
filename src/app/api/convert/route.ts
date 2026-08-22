import { NextRequest, NextResponse } from 'next/server';
import { exactGregorianToHebrew, hebrewToGregorian } from '@/lib/hebrew';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const dir = searchParams.get('dir');

  if (dir === 'gToH') {
    const m = parseInt(searchParams.get('m') ?? '');
    const d = parseInt(searchParams.get('d') ?? '');
    const y = parseInt(searchParams.get('y') ?? '');
    if (!m || !d || !y) return NextResponse.json({ error: 'Missing params' }, { status: 400 });

    const result = exactGregorianToHebrew(m, d, y);
    if (!result) return NextResponse.json({ error: 'Conversion failed' }, { status: 400 });
    return NextResponse.json({ hebrew_day: result.day, hebrew_month: result.month });
  }

  if (dir === 'hToG') {
    const hd = parseInt(searchParams.get('hd') ?? '');
    const hm = searchParams.get('hm') ?? '';
    const y = parseInt(searchParams.get('y') ?? '');
    if (!hd || !hm || !y) return NextResponse.json({ error: 'Missing params' }, { status: 400 });

    const result = hebrewToGregorian(hd, hm, y);
    if (!result) return NextResponse.json({ error: 'Conversion failed' }, { status: 400 });
    return NextResponse.json({ month: result.getMonth() + 1, day: result.getDate() });
  }

  return NextResponse.json({ error: 'Invalid direction' }, { status: 400 });
}
