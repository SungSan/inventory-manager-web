# Vercel 배포 체크리스트

- [ ] Supabase SQL 설치 성공
- [ ] 관리자 Auth 사용자 생성
- [ ] 로컬 LIVE 로그인 성공
- [ ] CSV 가져오기 성공
- [ ] 입고·출고 및 원복 테스트 성공
- [ ] GitHub 저장소 생성 및 소스 업로드
- [ ] Vercel 프로젝트 Import
- [ ] 환경변수 3개 등록
- [ ] Vercel Deploy 성공
- [ ] Supabase Site URL에 Vercel 주소 등록
- [ ] PC/모바일 동시 실시간 반영 확인
- [ ] PWA 설치 확인

## Vercel 환경변수

```text
NEXT_PUBLIC_APP_MODE=supabase
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
```

`service_role` 키는 등록하지 않습니다.
