# Barcode WMS v1.2 — Supabase 설정 순서

## 0. 이번 단계의 목표

- 데모 브라우저 저장소 대신 Supabase PostgreSQL 사용
- 여러 PC·휴대폰에서 같은 재고를 실시간으로 조회
- 이메일/비밀번호 로그인
- 관리자·매니저·작업자·조회자 권한 적용
- 최종적으로 Vercel에 배포해 설치형 PWA로 사용

---

## 1. Supabase 프로젝트 생성

1. Supabase Dashboard에서 **New project**를 누릅니다.
2. 프로젝트 이름과 데이터베이스 비밀번호를 지정합니다.
3. Region은 한국 사용자 기준 가까운 지역을 선택합니다.
4. 프로젝트 생성이 끝날 때까지 기다립니다.

기존에 시험하다 SQL이 중간 실패한 프로젝트를 계속 써도 됩니다. 아래 설치 SQL은 Barcode WMS용 public 객체를 초기화하고 다시 만듭니다. 아직 실데이터를 넣기 전일 때만 사용하세요.

---

## 2. 데이터베이스 설치

1. Supabase 왼쪽 메뉴에서 **SQL Editor**를 엽니다.
2. 프로젝트 폴더의 `supabase/01_RESET_AND_INSTALL.sql`을 메모장으로 엽니다.
3. 파일 내부 내용을 `Ctrl+A` → `Ctrl+C`로 전부 복사합니다.
4. SQL Editor에 붙여넣고 **Run**을 누릅니다.
5. 아래 결과가 표시되면 정상입니다.

```text
Barcode WMS v1.2 installation completed
```

> SQL Editor에 `supabase/01_RESET_AND_INSTALL.sql`이라는 파일 경로만 입력하면 안 됩니다. 파일 **내부 SQL 전체**를 붙여넣어야 합니다.

---

## 3. 첫 관리자 계정 생성

1. Supabase 왼쪽 메뉴에서 **Authentication → Users**로 이동합니다.
2. **Add user → Create new user**를 선택합니다.
3. 본인 이메일과 비밀번호를 입력합니다.
4. **Auto Confirm User**를 켜고 생성합니다.

설치 후 처음 생성되는 사용자는 자동으로 `admin` 역할을 받습니다. 이후 생성되는 사용자는 기본 `viewer`입니다. 앱의 **사용자** 메뉴에서 역할을 변경할 수 있습니다.

이미 사용자가 생성된 상태에서 SQL을 설치했다면, 가장 먼저 생성된 기존 사용자가 관리자로 등록됩니다.

---

## 4. Project URL과 Key 확인

1. Supabase에서 **Project Settings → API**로 이동합니다.
2. 아래 두 값을 확인합니다.
   - Project URL
   - Publishable key
3. 구형 화면에서 Publishable key가 보이지 않으면 `anon public` key를 사용합니다.

**service_role key는 앱에 절대 넣지 마세요.** 브라우저 앱에는 Publishable/anon key만 사용합니다.

---

## 5. 로컬에서 LIVE 모드 연결

1. 프로젝트 폴더의 `SETUP_SUPABASE.bat`를 실행합니다.
2. Project URL을 붙여넣습니다.
3. Publishable/anon key를 붙여넣습니다.
4. 설정 완료 후 `START_LIVE_LOCAL.bat`를 실행합니다.
5. 브라우저에서 `http://localhost:3000`이 열리면 관리자 계정으로 로그인합니다.

화면 우측 상단 배지가 `LIVE`로 표시되어야 합니다.

---

## 6. 기존 CSV 데이터 이전

1. 앱의 **데이터이전** 메뉴를 엽니다.
2. 현재 사용 중인 7열 CSV를 선택합니다.
3. 미리보기에서 다음 매핑을 확인합니다.

| CSV 열 | 앱 필드 |
|---|---|
| A | LOCATION |
| B | P_CODE_NO |
| C | CODE_NO / 기본 상품 바코드 |
| D | MASTER_CODE_NO |
| E | ARTIST |
| F | NAME/VER |
| G | QUANTITY |

4. 상품명/버전과 수량이 정상적으로 보이면 가져오기를 실행합니다.
5. 공통 CODE_NO가 여러 상품/버전에 연결된 경우, 입출고 스캔 시 상품 선택창이 표시됩니다.

---

## 7. 실시간 동작 확인

1. PC 브라우저와 휴대폰 브라우저에서 같은 배포 주소에 로그인합니다.
2. PC에서 입고를 처리합니다.
3. 휴대폰의 재고조회 화면이 자동으로 갱신되는지 확인합니다.
4. 동일 상품이 여러 로케이션에 있을 경우 재고 상세보기에서 위치별 수량이 분리되어야 합니다.

---

## 8. Vercel 배포

### 권장 방식

1. 프로젝트 폴더를 GitHub 저장소에 업로드합니다.
2. Vercel에서 **Add New → Project**를 누릅니다.
3. GitHub 저장소를 Import합니다.
4. Framework는 Next.js로 자동 인식됩니다.
5. Vercel의 Environment Variables에 아래 값을 등록합니다.

```text
NEXT_PUBLIC_APP_MODE=supabase
NEXT_PUBLIC_SUPABASE_URL=Supabase Project URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=Supabase Publishable key
```

6. Deploy를 실행합니다.
7. 발급된 `https://...vercel.app` 주소로 접속해 로그인합니다.

배포가 끝난 뒤 스마트폰 브라우저의 **홈 화면에 추가/앱 설치**를 사용하면 일반 앱처럼 실행할 수 있습니다. PC Chrome/Edge에서도 주소창의 설치 버튼으로 설치할 수 있습니다.

---

## 9. Supabase Authentication URL 설정

Vercel 주소가 확정되면 Supabase에서:

1. **Authentication → URL Configuration**으로 이동합니다.
2. Site URL에 Vercel 운영 주소를 입력합니다.
3. Redirect URLs에도 운영 주소를 추가합니다.

현재 앱은 이메일/비밀번호 로그인이므로 기본 로그인에는 리디렉션 의존성이 낮지만, 이후 비밀번호 재설정이나 OAuth를 추가할 때 필요합니다.
