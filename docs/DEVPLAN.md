# Digicap v2.0 — 개발 체크리스트

## 개요
v1.0 완료 후 기능 간 연계 및 UX 개선. 각 페이지가 독립적으로 동작하던 구조에서 데이터 연결, 드릴다운, 실시간 메트릭을 추가.

---

## Tier 1: Quick Wins

- [x] **1.1 자산 페이지 — 상단 요약 통계 카드**
  - 전체 자산 / 온라인 / 오프라인 / 계약없음 4개 카드
  - `assets/page.tsx` — 기존 배열에서 계산, API 변경 없음

- [x] **1.2 대시보드 카드 클릭 → 자산 필터 연결**
  - 카테고리 카드 → `<Link href="/assets?type=server">` 등
  - 자산 페이지에서 `useSearchParams()`로 초기 필터값 읽기
  - `page.tsx` (대시보드) + `assets/page.tsx`

- [x] **1.3 토폴로지 — "자동 배치" 버튼**
  - 툴바에 버튼 추가, 기존 `applyDagreLayout` 함수 호출
  - `topology/page.tsx`

- [x] **1.4 자산 필터 강화 — 상태/라이프사이클 드롭다운**
  - `status` (online/offline/warning) + `lifecycle_status` 드롭다운 2개 추가
  - `assets/page.tsx` + `api/assets/route.ts` (WHERE절 파라미터 추가)

- [x] **1.5 자산 CSV 내보내기**
  - 클라이언트에서 assets 배열 → CSV Blob → BOM 포함 다운로드
  - `assets/page.tsx`

- [x] **1.6 대시보드 CPU/메모리 TOP 10 + 알림 클릭 가능**
  - 서버명 → `<Link href="/servers/${id}">`, 알림 → `<Link href="/alerts">`
  - `page.tsx` (대시보드)

---

## Tier 2: Medium Effort

- [x] **2.1 토폴로지 노드 클릭 → 메트릭 팝오버**
  - 클릭 시 사이드 패널 — 이름, IP, 상태, CPU/메모리/디스크 사용률 바, 상세 링크
  - `/api/metrics?asset_id=X&range=1h` 호출
  - `topology/page.tsx`

- [x] **2.2 토폴로지 레이어 전환 (Physical / SAN)**
  - 툴바에 Physical/SAN 토글, 레이어 변경 시 재조회
  - `topology/page.tsx`

- [x] **2.3 자산 테이블에 최근 활동 시간 표시**
  - "최근 활동" 컬럼 추가, 상대 시간 (5분=green, 1시간=yellow, 24시간=orange, 초과=red)
  - `assets/page.tsx`

- [x] **2.4 IPAM 페이지 편집 UI**
  - 서브넷 추가 모달 (CIDR, 이름, VLAN, 위치, 설명)
  - IP 할당 추가/수정 모달 (IP, 호스트명, 용도, 상태, 비고)
  - 할당 행에 편집/삭제 버튼
  - API는 기존 POST/PUT/DELETE 활용
  - `assets/ipam/page.tsx`

- [x] **2.5 자산 일괄 작업 (벌크 라이프사이클 변경)**
  - 체크박스 컬럼 (전체 선택 + 개별 선택)
  - 벌크 액션 바: 라이프사이클 변경 (운영중/폐기예정/폐기완료/반납완료) + 삭제
  - 확인 dialog 후 병렬 API 호출
  - `assets/page.tsx`

---

## Tier 3: 대형 기능

- [x] **3.1 토폴로지 메트릭 오버레이 (CPU/메모리 히트맵)**
  - CPU / MEM 토글 버튼으로 오버레이 모드 전환
  - 전체 노드의 최신 메트릭 배치 조회
  - 노드 배경색 그라디언트 (green → yellow → red) + 미니 프로그레스 바
  - `topology/page.tsx`

- [x] **3.2 토폴로지 알림 표시**
  - `/api/alerts?active=true` 조회하여 asset_id별 최고 심각도 집계
  - 노드에 critical=빨간 점(pulse), warning=주황 점 표시
  - `topology/page.tsx`

- [x] **3.3 랙 장비에 실시간 메트릭 표시**
  - asset_id가 있는 유닛의 최신 메트릭 배치 조회
  - 장비 슬롯에 미니 CPU/MEM 사용률 바 (C: ■■■ M: ■■■)
  - `rack/page.tsx`

---

## 구현 이력

| 커밋 | 항목 | 날짜 |
|------|------|------|
| `dc1c000` | 1.1 ~ 1.6, 2.1 ~ 2.3 (Phase 1+2) | 2026-03-26 |
| (현재) | 2.4, 2.5, 3.1, 3.2, 3.3 (Phase 3~5) | 2026-03-26 |

## 변경 파일 요약

| 파일 | 변경 항목 |
|------|----------|
| `web/src/app/(dashboard)/page.tsx` | 1.2, 1.6 — 카드 링크, TOP10/알림 클릭 |
| `web/src/app/(dashboard)/assets/page.tsx` | 1.1, 1.4, 1.5, 2.3, 2.5 — 통계, 필터, CSV, 활동시간, 벌크작업 |
| `web/src/app/api/assets/route.ts` | 1.4 — status/lifecycle WHERE절 |
| `web/src/app/(dashboard)/topology/page.tsx` | 1.3, 2.1, 2.2, 3.1, 3.2 — 자동배치, 팝오버, 레이어, 오버레이, 알림 |
| `web/src/app/(dashboard)/assets/ipam/page.tsx` | 2.4 — 서브넷/IP 할당 CRUD 모달 |
| `web/src/app/(dashboard)/rack/page.tsx` | 3.3 — 미니 메트릭 바 |
