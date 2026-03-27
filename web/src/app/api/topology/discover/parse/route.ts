import { NextRequest, NextResponse } from 'next/server'
import { parseDeviceOutput, type Vendor, type ParseType } from '@/lib/mac-parser'

// POST — 구성 정보 파싱 (파일 업로드 또는 텍스트)
export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || ''
    let text: string
    let vendor: Vendor = 'auto'
    let type: ParseType = 'mac'

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData()
      const file = form.get('file') as File | null
      vendor = (form.get('vendor') as Vendor) || 'auto'
      type = (form.get('type') as ParseType) || 'mac'

      if (!file) {
        return NextResponse.json({ error: 'file required' }, { status: 400 })
      }
      text = await file.text()
    } else {
      const body = await req.json()
      text = body.text
      vendor = body.vendor || 'auto'
      type = body.type || 'mac'
    }

    if (!text?.trim()) {
      return NextResponse.json({ error: 'empty input' }, { status: 400 })
    }

    const result = parseDeviceOutput(text, vendor, type)
    // UI에 통합 entries로 반환
    return NextResponse.json({
      vendor_detected: result.vendor_detected,
      type_detected: result.type_detected,
      entries: result.wwn_entries ?? result.mac_entries ?? [],
    })
  } catch (err) {
    console.error('[Parse]', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
