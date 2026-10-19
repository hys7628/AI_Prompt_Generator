/*
 * AI 프롬프트 생성기 서버 (Node.js + Express)
 *
 * 하는 일
 *   1) 화면(public/index.html)을 보여 준다
 *   2) /api/recommend : 작업 3칸을 받아 어울리는 기법 3개를 추천 (이유 2줄 + 프롬프트 + 예시 결과물)
 *   3) /api/generate  : 고른 기법으로 APE(후보 → 채점 → 결합) 최종 프롬프트를 만든다
 *
 * 비밀 정보는 코드에 쓰지 않고 '환경변수'로 받습니다. (Render 대시보드 → Environment)
 *   OPENAI_API_KEY : OpenAI API 키
 *   APP_PASSWORD   : 사이트 접속 비밀번호 (남이 내 키로 쓰지 못하게)
 *   OPENAI_MODEL   : 사용할 모델 이름 (기본값 gpt-6.1-sol-light)
 */

import crypto from "node:crypto";
import express from "express";
import OpenAI from "openai";
import { TECHNIQUES, TECHNIQUE_BY_ID } from "./techniques.js";

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-6.1-sol-light";
const APP_PASSWORD = process.env.APP_PASSWORD || "";
const PORT = process.env.PORT || 5000;
const MAX_INPUT_LEN = 1500; // 입력칸 하나당 최대 글자 수 (요금 폭탄 방지)

const app = express();
app.set("trust proxy", true); // Render 앞단 프록시 뒤의 실제 접속 IP를 쓰기 위해
app.use(express.json({ limit: "50kb" }));
app.use(express.static("public"));

let client = null;
function getClient() {
  // OpenAI 연결 통로를 한 번만 만들어 재사용 (OPENAI_API_KEY 환경변수를 자동으로 읽음)
  if (!client) client = new OpenAI();
  return client;
}

// ───────────── 비밀번호 확인 (틀리면 잠시 잠금) ─────────────
const failed = new Map(); // ip → { count, last }
const LOCK_AFTER = 5;
const LOCK_MS = 5 * 60 * 1000;

function sameText(a, b) {
  // 글자를 비교하는 시간으로 비밀번호를 추측하지 못하게
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// 통과하면 다음으로, 실패하면 에러 응답
function requirePassword(req, res, next) {
  if (!APP_PASSWORD) {
    return res.status(500).json({ error: "서버에 APP_PASSWORD 환경변수가 설정되지 않았어요." });
  }
  const ip = req.ip || "?";
  const { count = 0, last = 0 } = failed.get(ip) || {};
  if (count >= LOCK_AFTER && Date.now() - last < LOCK_MS) {
    return res.status(429).json({ error: "비밀번호를 여러 번 틀려서 5분간 잠겼어요." });
  }
  if (sameText(req.get("X-App-Password") || "", APP_PASSWORD)) {
    failed.delete(ip);
    return next();
  }
  failed.set(ip, { count: count + 1, last: Date.now() });
  return res.status(401).json({ error: "비밀번호가 틀렸어요." });
}

// 작업 / 원하는 결과물 / 피해야 할 것 3칸 읽기
function readTaskInput(body = {}) {
  const fields = {
    task: String(body.task ?? "").trim(),
    goal: String(body.goal ?? "").trim(),
    avoid: String(body.avoid ?? "").trim(),
  };
  if (!fields.task) return { error: "작업을 입력해 주세요." };
  if (Object.values(fields).some((v) => v.length > MAX_INPUT_LEN)) {
    return { error: `입력칸 하나에 ${MAX_INPUT_LEN}자까지 쓸 수 있어요.` };
  }
  return { fields };
}

function taskBlock(f) {
  return `작업 : ${f.task}\n원하는 결과물 : ${f.goal || "(미입력)"}\n피해야 할 것 : ${f.avoid || "(미입력)"}`;
}

// OpenAI에 물어보고 JSON으로 답을 받는다
async function callOpenAIJson(systemPrompt, userPrompt) {
  const response = await getClient().chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
  });
  return JSON.parse(response.choices[0].message.content);
}

// ───────────── AI에게 줄 지침 (시스템 프롬프트) ─────────────
const COMMON_RULES = `
## 지킬 것
- 모든 설명은 한국어, 초보자도 이해하는 쉬운 말
- 사실·숫자·회사 정보를 지어내지 말고, 사용자가 채워야 할 곳은 {빈칸}으로 남긴다
- 만든 프롬프트는 그대로 복사해서 ChatGPT·Claude·Gemini에 붙여 넣을 수 있는 완성형
- '피해야 할 것'은 프롬프트 안에 금지 조건으로 반드시 반영
- 반드시 지정한 JSON 형식으로만 답한다
`;

function recommendSystemPrompt(forcedIds) {
  const catalog = TECHNIQUES.map(
    (t) => `- id=${t.id} | ${t.name} | ${t.summary} | 이럴 때: ${t.when} | 뼈대: ${t.how}`,
  ).join("\n");
  const pickRule = forcedIds.length
    ? `사용자가 직접 고른 기법(${forcedIds.join(", ")})만 사용한다. 각 기법마다 카드 1개를 만든다.`
    : "목록에서 이 작업에 가장 어울리는 기법 3개를 서로 겹치지 않게 고른다. 적합도가 높은 순서로 정렬한다.";

  return `너는 프롬프트 엔지니어링 코치야. 사용자가 준 작업에 맞는 프롬프트 기법을 추천하고,
각 기법을 적용한 실제 프롬프트와 그 프롬프트를 실행했을 때의 예시 결과물을 보여 준다.

## 기법 목록 (DAY1~3 수업 자료)
${catalog}

## 할 일
1. 작업을 한 문장으로 해석한다 (summary)
2. ${pickRule}
3. 각 기법마다
   - reason: 이 작업에 이 기법을 추천하는 이유를 정확히 2줄 (각 줄 40자 안팎)
   - fit_score: 이 작업과의 적합도 0~100
   - prompt: 해당 기법의 '뼈대'를 그대로 살려 이 작업용으로 완성한 프롬프트
   - example_output: 그 프롬프트를 실행하면 나올 결과물의 예시 (마크다운 가능, 600자 이내, 앞부분 위주로)
${COMMON_RULES}
## JSON 형식
{"summary": "...", "recommendations": [{"technique_id": "목록의 id", "fit_score": 90, "reason": ["1줄", "2줄"], "prompt": "...", "example_output": "..."}]}
`;
}

const APE_SYSTEM_PROMPT = `너는 "APE(자동 프롬프트 엔지니어) 생성기"야.
사용자가 고른 기법을 중심으로, 최적의 프롬프트 1개를 만든다.

## 매번 이 순서로
1. 고른 기법을 바탕으로 서로 다른 APE 전략(역할 부여형·단계별 지시형·예시 포함형·제약 명시형·목적 중심형·독자 설정형·형식 지정형·품질 기준형·역방향형·메타 지시형 중 5개)을 섞은 후보 프롬프트 5개
2. 각 후보를 명확성·완전성·실행 가능성·품질 유도력 각 25점(총 100점)으로 채점
3. 상위 2개의 장점을 합쳐 최종 프롬프트 1개 (고른 기법의 구조가 분명히 드러나야 함)
4. 이 프롬프트가 최선인 이유 3줄, 사용할 때 주의할 점 2줄
${COMMON_RULES}
## JSON 형식
{"candidates": [{"strategy": "역할 부여형", "idea": "후보의 핵심을 한 줄로", "scores": {"clarity": 0, "completeness": 0, "executability": 0, "quality": 0}, "total": 0}],
 "picked": [후보 번호(1부터) 2개], "final_prompt": "...", "why": ["", "", ""], "cautions": ["", ""]}
`;

// ───────────── 주소(라우트) ─────────────

// 기법 카드는 공개 정보라 비밀번호 없이도 볼 수 있음
app.get("/api/techniques", (req, res) => {
  res.json({ techniques: TECHNIQUES });
});

app.post("/api/login", requirePassword, (req, res) => {
  res.json({ ok: true, model: OPENAI_MODEL });
});

app.post("/api/recommend", requirePassword, async (req, res) => {
  const { fields, error } = readTaskInput(req.body);
  if (error) return res.status(400).json({ error });

  // 기법 카드에서 [이 기법으로 생성]을 누르면 그 기법만 사용
  const requested = Array.isArray(req.body.techniques) ? req.body.techniques : [];
  const forced = requested.filter((id) => TECHNIQUE_BY_ID[id]).slice(0, 3);

  let result;
  try {
    result = await callOpenAIJson(recommendSystemPrompt(forced), taskBlock(fields));
  } catch (e) {
    // 키 오류, 모델 이름 오류, 잔액 부족 등
    return res.status(502).json({ error: `OpenAI 호출 실패: ${e.message}` });
  }

  // AI가 목록에 없는 id를 주면 버리고, 이름을 붙여서 돌려준다
  const recommendations = (result.recommendations || [])
    .filter((rec) => TECHNIQUE_BY_ID[rec.technique_id])
    .map((rec) => {
      const t = TECHNIQUE_BY_ID[rec.technique_id];
      return { ...rec, name: t.name, group: t.group, day: t.day };
    });
  res.json({ summary: result.summary || "", recommendations });
});

app.post("/api/generate", requirePassword, async (req, res) => {
  const { fields, error } = readTaskInput(req.body);
  if (error) return res.status(400).json({ error });

  const t = TECHNIQUE_BY_ID[req.body.technique_id];
  if (!t) return res.status(400).json({ error: "기법을 먼저 골라 주세요." });
  const draft = String(req.body.draft_prompt ?? "").slice(0, 4000);

  const userPrompt =
    `${taskBlock(fields)}\n\n` +
    `## 고른 기법\n${t.name} : ${t.summary}\n뼈대: ${t.how}\n\n` +
    `## 추천 단계에서 만든 초안 프롬프트\n${draft || "(없음)"}`;

  try {
    const result = await callOpenAIJson(APE_SYSTEM_PROMPT, userPrompt);
    res.json({ ...result, technique: t.name });
  } catch (e) {
    res.status(502).json({ error: `OpenAI 호출 실패: ${e.message}` });
  }
});

// 내 컴퓨터에서 테스트할 때: npm start → http://localhost:5000
app.listen(PORT, () => {
  console.log(`✨ 프롬프트 생성기 실행 중: http://localhost:${PORT}`);
});
