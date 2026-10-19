"""
AI 프롬프트 생성기 서버 (Flask)

하는 일
  1) 화면(static/index.html)을 보여 준다
  2) /api/recommend : 작업 3칸을 받아 어울리는 기법 3개를 추천 (이유 2줄 + 프롬프트 + 예시 결과물)
  3) /api/generate  : 고른 기법으로 APE(후보 → 채점 → 결합) 최종 프롬프트를 만든다

비밀 정보는 코드에 쓰지 않고 '환경변수'로 받습니다. (Render 대시보드 → Environment)
  OPENAI_API_KEY : OpenAI API 키
  APP_PASSWORD   : 사이트 접속 비밀번호 (남이 내 키로 쓰지 못하게)
  OPENAI_MODEL   : 사용할 모델 이름 (기본값 gpt-6.1-sol-light)
"""

import hmac
import json
import os
import time

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory
from openai import OpenAI

from techniques import TECHNIQUE_BY_ID, TECHNIQUES

load_dotenv()  # 내 컴퓨터에서 실행할 때 .env 파일을 읽어 옴 (Render에서는 없어도 됨)

OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-6.1-sol-light")
APP_PASSWORD = os.environ.get("APP_PASSWORD", "")
MAX_INPUT_LEN = 1500  # 입력칸 하나당 최대 글자 수 (요금 폭탄 방지)

app = Flask(__name__, static_folder="static", static_url_path="")
_client = None


def get_client():
    """OpenAI 연결 통로를 한 번만 만들어 재사용"""
    global _client
    if _client is None:
        _client = OpenAI()  # OPENAI_API_KEY 환경변수를 자동으로 읽음
    return _client


# ───────────── 비밀번호 확인 (틀리면 잠시 잠금) ─────────────
_failed = {}  # {ip: [실패 횟수, 마지막 실패 시각]}
LOCK_AFTER = 5
LOCK_SECONDS = 300


def client_ip():
    # Render는 앞단 프록시를 거치므로 실제 접속 IP는 X-Forwarded-For 첫 번째 값
    forwarded = request.headers.get("X-Forwarded-For", "")
    return forwarded.split(",")[0].strip() or request.remote_addr or "?"


def check_password():
    """통과하면 None, 실패하면 (에러 응답, 상태코드)"""
    if not APP_PASSWORD:
        return jsonify(error="서버에 APP_PASSWORD 환경변수가 설정되지 않았어요."), 500

    ip = client_ip()
    count, last = _failed.get(ip, [0, 0])
    if count >= LOCK_AFTER and time.time() - last < LOCK_SECONDS:
        return jsonify(error="비밀번호를 여러 번 틀려서 5분간 잠겼어요."), 429

    given = request.headers.get("X-App-Password", "")
    if hmac.compare_digest(given.encode(), APP_PASSWORD.encode()):
        _failed.pop(ip, None)
        return None

    _failed[ip] = [count + 1, time.time()]
    return jsonify(error="비밀번호가 틀렸어요."), 401


def read_task_input():
    """작업 / 원하는 결과물 / 피해야 할 것 3칸 읽기"""
    data = request.get_json(silent=True) or {}
    fields = {
        "task": str(data.get("task", "")).strip(),
        "goal": str(data.get("goal", "")).strip(),
        "avoid": str(data.get("avoid", "")).strip(),
    }
    if not fields["task"]:
        return None, data, "작업을 입력해 주세요."
    if any(len(v) > MAX_INPUT_LEN for v in fields.values()):
        return None, data, f"입력칸 하나에 {MAX_INPUT_LEN}자까지 쓸 수 있어요."
    return fields, data, None


def task_block(f):
    return (
        f"작업 : {f['task']}\n"
        f"원하는 결과물 : {f['goal'] or '(미입력)'}\n"
        f"피해야 할 것 : {f['avoid'] or '(미입력)'}"
    )


def call_openai_json(system_prompt, user_prompt):
    """OpenAI에 물어보고 JSON으로 답을 받는다"""
    response = get_client().chat.completions.create(
        model=OPENAI_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        response_format={"type": "json_object"},
    )
    return json.loads(response.choices[0].message.content)


# ───────────── AI에게 줄 지침 (시스템 프롬프트) ─────────────
COMMON_RULES = """
## 지킬 것
- 모든 설명은 한국어, 초보자도 이해하는 쉬운 말
- 사실·숫자·회사 정보를 지어내지 말고, 사용자가 채워야 할 곳은 {빈칸}으로 남긴다
- 만든 프롬프트는 그대로 복사해서 ChatGPT·Claude·Gemini에 붙여 넣을 수 있는 완성형
- '피해야 할 것'은 프롬프트 안에 금지 조건으로 반드시 반영
- 반드시 지정한 JSON 형식으로만 답한다
"""


def recommend_system_prompt(forced_ids):
    catalog = "\n".join(
        f"- id={t['id']} | {t['name']} | {t['summary']} | 이럴 때: {t['when']} | 뼈대: {t['how']}"
        for t in TECHNIQUES
    )
    if forced_ids:
        names = ", ".join(forced_ids)
        pick_rule = f"사용자가 직접 고른 기법({names})만 사용한다. 각 기법마다 카드 1개를 만든다."
    else:
        pick_rule = "목록에서 이 작업에 가장 어울리는 기법 3개를 서로 겹치지 않게 고른다. 적합도가 높은 순서로 정렬한다."

    return f"""너는 프롬프트 엔지니어링 코치야. 사용자가 준 작업에 맞는 프롬프트 기법을 추천하고,
각 기법을 적용한 실제 프롬프트와 그 프롬프트를 실행했을 때의 예시 결과물을 보여 준다.

## 기법 목록 (DAY1~3 수업 자료)
{catalog}

## 할 일
1. 작업을 한 문장으로 해석한다 (summary)
2. {pick_rule}
3. 각 기법마다
   - reason: 이 작업에 이 기법을 추천하는 이유를 정확히 2줄 (각 줄 40자 안팎)
   - fit_score: 이 작업과의 적합도 0~100
   - prompt: 해당 기법의 '뼈대'를 그대로 살려 이 작업용으로 완성한 프롬프트
   - example_output: 그 프롬프트를 실행하면 나올 결과물의 예시 (마크다운 가능, 600자 이내, 앞부분 위주로)
{COMMON_RULES}
## JSON 형식
{{"summary": "...", "recommendations": [{{"technique_id": "목록의 id", "fit_score": 90, "reason": ["1줄", "2줄"], "prompt": "...", "example_output": "..."}}]}}
"""


APE_SYSTEM_PROMPT = f"""너는 "APE(자동 프롬프트 엔지니어) 생성기"야.
사용자가 고른 기법을 중심으로, 최적의 프롬프트 1개를 만든다.

## 매번 이 순서로
1. 고른 기법을 바탕으로 서로 다른 APE 전략(역할 부여형·단계별 지시형·예시 포함형·제약 명시형·목적 중심형·독자 설정형·형식 지정형·품질 기준형·역방향형·메타 지시형 중 5개)을 섞은 후보 프롬프트 5개
2. 각 후보를 명확성·완전성·실행 가능성·품질 유도력 각 25점(총 100점)으로 채점
3. 상위 2개의 장점을 합쳐 최종 프롬프트 1개 (고른 기법의 구조가 분명히 드러나야 함)
4. 이 프롬프트가 최선인 이유 3줄, 사용할 때 주의할 점 2줄
{COMMON_RULES}
## JSON 형식
{{"candidates": [{{"strategy": "역할 부여형", "idea": "후보의 핵심을 한 줄로", "scores": {{"clarity": 0, "completeness": 0, "executability": 0, "quality": 0}}, "total": 0}}],
 "picked": [후보 번호(1부터) 2개], "final_prompt": "...", "why": ["", "", ""], "cautions": ["", ""]}}
"""


# ───────────── 주소(라우트) ─────────────
@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/api/techniques")
def techniques():
    # 기법 카드는 공개 정보라 비밀번호 없이도 볼 수 있음
    return jsonify(techniques=TECHNIQUES)


@app.post("/api/login")
def login():
    failed = check_password()
    return failed if failed else jsonify(ok=True, model=OPENAI_MODEL)


@app.post("/api/recommend")
def recommend():
    failed = check_password()
    if failed:
        return failed
    fields, data, err = read_task_input()
    if err:
        return jsonify(error=err), 400

    # 기법 카드에서 [이 기법으로 생성]을 누르면 그 기법만 사용
    forced = [i for i in data.get("techniques", []) if i in TECHNIQUE_BY_ID][:3]

    try:
        result = call_openai_json(recommend_system_prompt(forced), task_block(fields))
    except Exception as e:  # 키 오류, 모델 이름 오류, 잔액 부족 등
        return jsonify(error=f"OpenAI 호출 실패: {e}"), 502

    # AI가 목록에 없는 id를 주면 버리고, 이름을 붙여서 돌려준다
    cards = []
    for rec in result.get("recommendations", []):
        t = TECHNIQUE_BY_ID.get(rec.get("technique_id"))
        if not t:
            continue
        cards.append({**rec, "name": t["name"], "group": t["group"], "day": t["day"]})
    return jsonify(summary=result.get("summary", ""), recommendations=cards)


@app.post("/api/generate")
def generate():
    failed = check_password()
    if failed:
        return failed
    fields, data, err = read_task_input()
    if err:
        return jsonify(error=err), 400

    t = TECHNIQUE_BY_ID.get(data.get("technique_id"))
    if not t:
        return jsonify(error="기법을 먼저 골라 주세요."), 400
    draft = str(data.get("draft_prompt", ""))[:4000]

    user_prompt = (
        f"{task_block(fields)}\n\n"
        f"## 고른 기법\n{t['name']} : {t['summary']}\n뼈대: {t['how']}\n\n"
        f"## 추천 단계에서 만든 초안 프롬프트\n{draft or '(없음)'}"
    )
    try:
        result = call_openai_json(APE_SYSTEM_PROMPT, user_prompt)
    except Exception as e:
        return jsonify(error=f"OpenAI 호출 실패: {e}"), 502
    return jsonify({**result, "technique": t["name"]})


if __name__ == "__main__":
    # 내 컴퓨터에서 테스트할 때: python app.py → http://localhost:5000
    app.run(debug=True, port=int(os.environ.get("PORT", 5000)))
