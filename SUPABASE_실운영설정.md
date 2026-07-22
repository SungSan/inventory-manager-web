# Supabase 실시간 운영 설정

## 1. 프로젝트 생성

Supabase에서 새 프로젝트를 생성합니다.

## 2. 데이터베이스 설치

SQL Editor에서 아래 파일 내용을 순서대로 실행합니다.

1. `supabase/schema.sql`
2. 샘플 데이터가 필요하면 `supabase/seed.sql`

## 3. 작업자 계정 생성

Supabase Dashboard → Authentication → Users에서 이메일/비밀번호 계정을 생성합니다.

## 4. 첫 관리자 지정

첫 계정은 기본적으로 `viewer`로 생성됩니다. SQL Editor에서 해당 이메일을 관리자 권한으로 변경합니다.

```sql
update public.profiles
set role = 'admin', active = true
where email = '관리자이메일@example.com';
```

이후부터는 앱의 `사용자` 메뉴에서 역할을 변경할 수 있습니다.

## 5. 환경변수 설정

`.env.example`을 복사해 `.env.local`로 만들고 아래처럼 입력합니다.

```env
NEXT_PUBLIC_APP_MODE=supabase
NEXT_PUBLIC_SUPABASE_URL=https://프로젝트ID.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=발급받은_ANON_KEY
```

## 6. 실행

```bash
npm install
npm run dev
```

## 7. 운영 전 확인

- 실제 상품 바코드의 EAN/Code 128 인식
- 각 랙에 부착할 로케이션 라벨 인쇄 품질
- 작업자 계정별 권한
- 기존 Google Sheets CSV 샘플 이전
- 동시에 두 기기에서 같은 재고 출고 테스트
- 거래 취소 시 현재 재고 부족 차단 확인
- Supabase 백업 및 요금제 설정

## 송장 기능 확장

현재 송장 API 연결은 구현하지 않았지만 다음 필드는 준비되어 있습니다.

- `scan_targets.target_type = 'shipment'`
- `inventory_transactions.reference_type`
- `inventory_transactions.reference_id`

추후 택배사 또는 주문 시스템 연동 시 기존 상품·로케이션 바코드 구조를 변경하지 않고 송장 매칭을 추가할 수 있습니다.

## v1.1 공통 상품 바코드

이번 `schema.sql`은 같은 상품 바코드가 여러 상품/버전에 연결되는 구조를 지원합니다.

- 상품 바코드: 여러 상품/버전에 중복 연결 가능
- 로케이션 바코드: 중복 연결 불가
- 상품 바코드와 로케이션 바코드에 같은 번호를 동시에 사용 불가
- 공통 상품 바코드 스캔 시 앱에서 상품 ID를 선택한 뒤 입출고 RPC에 전달

기존 구버전 스키마가 설치된 프로젝트라면 새 `schema.sql`을 다시 실행하기 전에 백업을 권장합니다.
