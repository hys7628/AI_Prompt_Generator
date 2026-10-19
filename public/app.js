// ───────────────────────────────────────────────
// AI 프롬프트 생성기 화면 동작
//  1) 비밀번호 확인 → 2) 기법 추천 대시보드 → 3) APE 최종 생성
//  + 기법 카드 탭 (주제별로 묶은 기법)
// ───────────────────────────────────────────────

const $ = (id) => document.getElementById(id);
let techniques = [];      // 서버에서 받은 기법 목록
let topics = [];          // 기법을 묶는 큰 주제
let forcedIds = [];       // 기법 카드에서 직접 고른 기법
let lastInput = null;     // 마지막으로 추천받은 입력값 (최종 생성 때 다시 사용)

// ───── 작은 도우미 함수들 ─────

// 요소 만들기: AI가 준 글자는 textContent로만 넣어서 안전하게 보여 줌
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child != null) node.append(child);
  }
  return node;
}

function getPassword() {
  try { return localStorage.getItem("app_pw") || ""; } catch { return ""; }
}
function savePassword(pw) {
  try { localStorage.setItem("app_pw", pw); } catch { /* 저장 못 해도 계속 진행 */ }
}

function toast(message) {
  const t = el("div", { class: "toast", text: message });
  document.body.append(t);
  setTimeout(() => t.remove(), 1500);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("복사했어요 ✅");
  } catch {
    toast("복사 실패: 직접 드래그해서 복사해 주세요");
  }
}

function copyButton(getText, label = "복사") {
  return el("button", { class: "btn small", type: "button", text: label, onclick: () => copyText(getText()) });
}

// 서버에 요청 보내기 (비밀번호를 머리글에 함께)
async function api(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-App-Password": getPassword() },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) showLogin("비밀번호를 다시 입력해 주세요.");
  if (!res.ok) throw new Error(data.error || `서버 오류 (${res.status})`);
  return data;
}

function showStatus(message, isError = false) {
  const box = $("status");
  box.hidden = false;
  box.className = "status" + (isError ? " err" : "");
  box.replaceChildren(isError ? "" : el("span", { class: "spinner" }), message);
}
function hideStatus() { $("status").hidden = true; }

// ───── 1) 비밀번호 ─────

function showLogin(message = "") {
  $("login").hidden = false;
  $("loginError").textContent = message;
  $("pw").focus();
}

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  savePassword($("pw").value);
  try {
    await api("/api/login");
    $("login").hidden = true;
    $("pw").value = "";
  } catch (err) {
    $("loginError").textContent = err.message;
  }
});

// ───── 탭 전환 ─────

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  $("generator").hidden = name !== "generator";
  $("library").hidden = name !== "library";
  window.scrollTo({ top: 0, behavior: "smooth" });
}
document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));

// ───── 2) 기법 추천 ─────

$("fillExample").addEventListener("click", () => {
  $("task").value = "고객 클레임 이메일 답장 작성";
  $("goal").value = "고객이 화가 풀리고 우리 회사를 신뢰하게 하는 답장";
  $("avoid").value = "방어적 태도, 책임 회피, 형식적인 사과";
});

function renderForced() {
  const box = $("forced");
  if (!forcedIds.length) {
    box.hidden = true;
    $("recommendBtn").textContent = "🔍 기법 추천받기";
    return;
  }
  const names = forcedIds.map((id) => techniques.find((t) => t.id === id)?.name).join(", ");
  box.hidden = false;
  box.replaceChildren(
    el("span", { text: `🎯 직접 고른 기법: ${names}` }),
    el("button", { class: "btn small", type: "button", text: "AI 추천으로", onclick: () => { forcedIds = []; renderForced(); } }),
  );
  $("recommendBtn").textContent = "🛠 이 기법으로 만들기";
}

$("taskForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  lastInput = { task: $("task").value, goal: $("goal").value, avoid: $("avoid").value };
  $("dashboard").hidden = true;
  $("final").hidden = true;
  $("recommendBtn").disabled = true;
  showStatus(forcedIds.length ? "고른 기법으로 프롬프트를 만드는 중…" : "어울리는 기법을 고르는 중… (10~40초)");
  $("status").scrollIntoView({ behavior: "smooth", block: "center" });
  try {
    const data = await api("/api/recommend", { ...lastInput, techniques: forcedIds });
    hideStatus();
    renderDashboard(data);
  } catch (err) {
    showStatus("⚠️ " + err.message, true);
  } finally {
    $("recommendBtn").disabled = false;
  }
});

function renderDashboard(data) {
  $("summary").textContent = data.summary ? "📌 " + data.summary : "";
  const cards = (data.recommendations || []).map((rec, i) => {
    const score = Math.max(0, Math.min(100, Number(rec.fit_score) || 0));
    const card = el("article", { class: "card rec" },
      el("div", { class: "rec-head" },
        el("div", {},
          el("span", { class: "badge", text: `${i + 1}순위 · ${rec.group}` }),
          el("h3", { text: rec.name }),
        ),
        el("div", { class: "score" }, el("b", { text: String(score) }), el("div", { class: "muted", text: "적합도" })),
      ),
      el("div", { class: "meter" }, el("span", { style: `width:${score}%` })),
      el("ul", { class: "reason" }, (rec.reason || []).slice(0, 2).map((line) => el("li", { text: line }))),
      el("div", {},
        el("div", { class: "box-title" }, el("span", { text: "📝 이 기법으로 만든 프롬프트" }), copyButton(() => rec.prompt)),
        el("pre", { class: "prompt", text: rec.prompt || "" }),
      ),
      el("div", {},
        el("div", { class: "box-title" }, el("span", { text: "👀 예시 결과물 (미리보기)" })),
        el("div", { class: "example", text: rec.example_output || "" }),
      ),
      el("button", { class: "btn primary", type: "button", text: "⭐ 이걸로 최종 생성 (APE)", onclick: () => generateFinal(rec, card) }),
    );
    return card;
  });
  $("recCards").replaceChildren(...cards);
  $("dashboard").hidden = false;
  $("dashboard").scrollIntoView({ behavior: "smooth", block: "start" }); // 휴대폰에서 결과가 바로 보이게
  if (!cards.length) showStatus("⚠️ 추천 결과가 비어 있어요. 다시 시도해 주세요.", true);
}

// ───── 3) APE 최종 생성 ─────

async function generateFinal(rec, card) {
  document.querySelectorAll(".rec").forEach((c) => c.classList.toggle("chosen", c === card));
  document.querySelectorAll(".rec .btn.primary").forEach((b) => (b.disabled = true));
  $("final").hidden = true;
  showStatus(`'${rec.name}' 기법으로 후보 5개를 만들고 채점하는 중… (20~60초)`);
  $("status").scrollIntoView({ behavior: "smooth", block: "center" });
  try {
    const data = await api("/api/generate", { ...lastInput, technique_id: rec.technique_id, draft_prompt: rec.prompt });
    hideStatus();
    renderFinal(data);
  } catch (err) {
    showStatus("⚠️ " + err.message, true);
  } finally {
    document.querySelectorAll(".rec .btn.primary").forEach((b) => (b.disabled = false));
  }
}

function renderFinal(data) {
  const picked = new Set((data.picked || []).map(Number));
  const rows = (data.candidates || []).map((c, i) => {
    const s = c.scores || {};
    return el("tr", { class: picked.has(i + 1) ? "picked" : "" },
      el("td", { text: String(i + 1) }),
      el("td", { class: "left", text: `${c.strategy || ""} — ${c.idea || ""}` }),
      el("td", { text: String(s.clarity ?? "") }),
      el("td", { text: String(s.completeness ?? "") }),
      el("td", { text: String(s.executability ?? "") }),
      el("td", { text: String(s.quality ?? "") }),
      el("td", {}, el("b", { text: String(c.total ?? "") })),
    );
  });

  const prompt = data.final_prompt || "";
  const box = $("final");
  box.replaceChildren(
    el("h2", { text: `⭐ 최종 프롬프트 · ${data.technique}` }),
    el("div", { class: "table-wrap" },
      el("table", {},
        el("thead", {}, el("tr", {},
          ["#", "후보 전략", "명확성", "완전성", "실행 가능성", "품질 유도력", "총점"].map((h, i) =>
            el("th", { class: i === 1 ? "left" : "", text: h })),
        )),
        el("tbody", {}, rows),
      ),
    ),
    el("p", { class: "muted", text: "파란 줄 = 장점을 합친 상위 후보" }),
    el("div", {},
      el("div", { class: "box-title" }, el("span", { text: "📋 바로 복사해서 쓰세요" }), copyButton(() => prompt)),
      el("pre", { class: "prompt", text: prompt }),
    ),
    el("div", { class: "two" },
      el("div", {}, el("b", { text: "✅ 이 프롬프트가 좋은 이유" }), el("ul", {}, (data.why || []).map((t) => el("li", { text: t })))),
      el("div", {}, el("b", { text: "⚠️ 쓸 때 주의할 점" }), el("ul", {}, (data.cautions || []).map((t) => el("li", { text: t })))),
    ),
    el("div", { class: "open-links" },
      openLink("ChatGPT에서 열기", "https://chatgpt.com/?q=" + encodeURIComponent(prompt), prompt),
      openLink("Claude에서 열기", "https://claude.ai/new?q=" + encodeURIComponent(prompt), prompt),
      openLink("Gemini 열기 (붙여넣기)", "https://gemini.google.com/app", prompt),
    ),
  );
  box.hidden = false;
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}

// 링크를 누르면 프롬프트를 먼저 복사해 두고 새 탭으로 연다
function openLink(label, url, prompt) {
  return el("a", { class: "btn", href: url, target: "_blank", rel: "noopener", text: label, onclick: () => copyText(prompt) });
}

// ───── 기법 카드 탭 ─────

let topicFilter = "all";

// 카드 한 장 만들기
function techCard(t) {
  return el("article", { class: "card tech" },
    el("h3", { text: t.name }),
    el("p", { text: t.summary }),
    el("p", { class: "when", text: "💡 이럴 때: " + t.when }),
    el("details", {},
      el("summary", { text: "뼈대 보기" }),
      el("pre", { class: "prompt", text: t.how }),
    ),
    el("details", {},
      el("summary", { text: "수업 예시 프롬프트" }),
      el("pre", { class: "prompt", text: t.example }),
    ),
    el("div", { class: "row" },
      copyButton(() => t.example, "예시 복사"),
      el("button", { class: "btn small primary", type: "button", text: "이 기법으로 생성 →", onclick: () => useTechnique(t.id) }),
    ),
  );
}

// 위쪽 주제 버튼 [전체 | 주제1 | 주제2 …]
function renderTopicChips() {
  const chips = [{ name: "all", label: "전체" }, ...topics.map((tp) => ({ name: tp.name, label: tp.name }))];
  $("topicChips").replaceChildren(...chips.map((c) =>
    el("button", {
      class: "chip" + (c.name === topicFilter ? " active" : ""),
      type: "button",
      text: c.label,
      onclick: () => { topicFilter = c.name; renderTopicChips(); renderLibrary(); },
    })));
}

// 주제별로 제목 + 카드 묶음 그리기
function renderLibrary() {
  const q = $("search").value.trim().toLowerCase();
  const sections = topics
    .filter((tp) => topicFilter === "all" || tp.name === topicFilter)
    .map((tp) => {
      const list = techniques.filter((t) =>
        t.group === tp.name &&
        (!q || [t.name, t.summary, t.when, t.group].join(" ").toLowerCase().includes(q)));
      if (!list.length) return null;
      return el("section", { class: "topic" },
        el("div", { class: "topic-head" },
          el("h2", { text: `${tp.name} ` }, el("span", { class: "count", text: `${list.length}` })),
          el("p", { class: "muted", text: tp.desc }),
        ),
        el("div", { class: "tech-grid" }, list.map(techCard)),
      );
    })
    .filter(Boolean);

  $("techGrid").replaceChildren(...sections);
  if (!sections.length) $("techGrid").append(el("p", { class: "muted", text: "검색 결과가 없어요." }));
}

function useTechnique(id) {
  forcedIds = [id];
  renderForced();
  switchTab("generator");
  $("task").focus();
}

$("search").addEventListener("input", renderLibrary);

// ───── 시작 ─────
(async function start() {
  try {
    const res = await fetch("/api/techniques");
    const data = await res.json();
    techniques = data.techniques || [];
    topics = data.topics || [];
    renderTopicChips();
    renderLibrary();
  } catch {
    $("techGrid").replaceChildren(el("p", { class: "error", text: "기법 목록을 불러오지 못했어요." }));
  }
  if (!getPassword()) showLogin();
})();
