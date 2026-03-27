import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'

// GET /api/agent/download?os=linux&arch=amd64&type=baremetal
// ZIP 파일 다운로드 (dist/ 폴더에서 서빙)
export async function GET(req: NextRequest) {
  const os   = req.nextUrl.searchParams.get('os') || 'linux'
  const arch = req.nextUrl.searchParams.get('arch') || 'amd64'
  const type = req.nextUrl.searchParams.get('type') || 'baremetal'

  // 허용된 값만 사용 (path traversal 방지)
  const validOs   = ['linux', 'windows'].includes(os) ? os : 'linux'
  const validArch = ['amd64', 'arm64'].includes(arch) ? arch : 'amd64'
  const validType = ['baremetal', 'vm', 'cloud'].includes(type) ? type : 'baremetal'

  const filename = `argus-agent-${validType}-${validOs}-${validArch}.zip`
  const distDir  = path.resolve(process.cwd(), '..', 'dist')
  const filePath = path.join(distDir, filename)

  try {
    const data = await readFile(filePath)
    return new NextResponse(data, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(data.length),
      },
    })
  } catch {
    return NextResponse.json(
      { error: `파일을 찾을 수 없습니다: ${filename}` },
      { status: 404 }
    )
  }
}
