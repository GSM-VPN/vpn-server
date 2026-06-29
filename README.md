# VPN Server

GSM-VPN의 메인입니다. 실제 터널 연결과 피어 등록을 담당합니다.

## 역할

- WireGuard 서버 시작
- 클라이언트 피어 등록/해제
- 트래픽 전달 준비
- 게이트웨이 서명 검증
- 현재 상태를 게이트웨이에 제공

## 기술 스택

- Node.js
- TypeScript
- Fastify
- WireGuard

## 실행 준비

1. `npm install`
2. `.env.example`을 `.env`로 복사
3. 서버별로 아래 값을 다르게 설정

권장 분리값:

- `HTTP_PORT`
- `INTERNAL_UDP_PORT`
- `EXTERNAL_UDP_PORT`
- `EXTERNAL_HTTP_PORT`
- `SERVER_NAME`
- `SERVER_PRIVATE_KEY`

## 개발 실행

```bash
npm run dev
```

## Windows / Linux 초기화

Windows:

```bash
npm run windows
```

Linux:

```bash
npm run linux
```

## 참고

- 게이트웨이와 같은 `GATEWAY_SHARED_SECRET`를 써야 합니다.
- 서버 공개키는 `SERVER_PRIVATE_KEY`에서 파생됩니다.
- lease 재연결 정보는 게이트웨이가 별도로 보관합니다.
