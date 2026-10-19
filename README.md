# ✨ AI 프롬프트 생성기

DAY1~3 프롬프트 엔지니어링 수업 자료(`prompt-day1~3.html`)의 기법 29개를 바탕으로,
**작업 3줄만 쓰면 어울리는 기법을 추천하고 APE 방식으로 최종 프롬프트를 만들어 주는** 웹앱입니다.

## 화면 흐름

1. **작업 · 원하는 결과물 · 피해야 할 것** 입력 → `🔍 기법 추천받기`
2. **추천 대시보드**: 기법 3개 카드 (적합도 점수 · 추천 이유 2줄 · 그 기법으로 만든 프롬프트 · 예시 결과물)
3. 마음에 드는 카드에서 `⭐ 이걸로 최종 생성 (APE)`
   → 후보 5개 채점표 → 최종 프롬프트(복사 / ChatGPT·Claude·Gemini 열기) → 좋은 이유 3줄 · 주의할 점 2줄
4. **기법 카드** 탭: 큰 주제 6개(프롬프트 구조 · 역할·대상 · 예시·반복 생성 · 대화·진행 · 검증·품질 · 프레임워크)로 묶은 기법 설명 · 뼈대 · 수업 예시. `이 기법으로 생성 →`을 누르면 그 기법으로 바로 만들기

## 파일 구성

| 파일 | 하는 일 |
|---|---|
| `server.js` | Node.js(Express) 서버. OpenAI 호출, 비밀번호 확인 |
| `techniques.js` | DAY1~3 기법 목록 (여기에 추가하면 화면과 추천에 모두 반영) |
| `public/` | 화면 (index.html · style.css · app.js), 반응형 |
| `package.json` | 필요한 라이브러리(express, openai)와 실행 명령 |
| `render.yaml` | Render 배포 설정 |
| `.env.example` | 내 컴퓨터에서 실행할 때 쓰는 환경변수 예시 |

## 내 컴퓨터에서 실행

[Node.js](https://nodejs.org) 22 이상이 필요해요.

```bash
npm install            # 라이브러리 설치 (처음 한 번)
cp .env.example .env   # .env 를 열어 키와 비밀번호 채우기
npm start              # http://localhost:5000
```

## Render 배포

1. 이 저장소를 GitHub에 push
2. [render.com](https://render.com) → **New → Blueprint** → `AI_Prompt_Generator` 저장소 선택
3. 입력칸이 나오면
   - `OPENAI_API_KEY` : OpenAI API 키
   - `APP_PASSWORD` : 사이트 접속 비밀번호 (내가 정하기)
4. **Apply** → 2~5분 뒤 `https://ai-prompt-generator-xxxx.onrender.com` 주소가 생김
5. 이후에는 GitHub에 push만 하면 자동으로 다시 배포됩니다

> 무료 플랜은 15분 동안 안 쓰면 잠들어서, 처음 열 때 30초~1분 걸릴 수 있어요.

### 모델 바꾸기

Render → 서비스 → **Environment** → `OPENAI_MODEL` 값을 바꾸고 저장하면 됩니다.
"model not found" 오류가 나면 [OpenAI 대시보드](https://platform.openai.com) → Models 에 보이는 정확한 이름으로 바꿔 주세요.

## 🔒 보안

- API 키는 코드에 없고 **환경변수**로만 들어갑니다. `.env` 는 `.gitignore`에 있어 GitHub에 올라가지 않아요.
- 비밀번호를 5번 틀리면 그 IP는 5분간 잠깁니다.
- 입력칸은 칸당 1500자까지라 요금이 갑자기 많이 나오지 않아요.
