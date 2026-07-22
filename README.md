# Barcode WMS

상품·로케이션 바코드 기반 실시간 재고관리 웹앱입니다.

## 주요 기능

- 상품 및 로케이션 바코드 기반 입고·출고
- 동일 바코드의 복수 상품/버전 선택
- 동일 상품의 복수 로케이션 재고 관리
- 상품별 총재고 및 로케이션 상세조회
- 신규 상품·로케이션·추가 바코드 관리
- 입출고 취소·원복, 스캔 로그, 감사 로그
- 관리자·매니저·작업자·조회자 권한
- Supabase Realtime 기반 다중 사용자 동기화
- PC·모바일 반응형 웹 및 PWA

## 기술 구성

- Next.js
- TypeScript
- Supabase PostgreSQL / Auth / Realtime
- Vercel 배포

## 로컬 실행

1. `.env.example`을 참고해 `.env.local`을 생성합니다.
2. Supabase SQL Editor에서 `supabase/01_RESET_AND_INSTALL.sql`을 실행합니다.
3. 다음 명령을 실행합니다.

```bash
npm install
npm run dev
```

`http://localhost:3000`에서 접속할 수 있습니다.

## 환경변수

```env
NEXT_PUBLIC_APP_MODE=supabase
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

Supabase `service_role` 또는 secret key는 브라우저 환경변수로 사용하지 않습니다.
