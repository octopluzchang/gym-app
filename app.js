const STORAGE_KEY = "gym-planner-v4";
const SHEETS_URL_KEY = "gym-planner-sheets-url";
const TIMER_TICK_MS = 250;

const state = {
  ...loadState(),
  currentPage: "home",
  draftPlan: { exercises: [] },
  activePlanId: null,
  sheetsUrl: localStorage.getItem(SHEETS_URL_KEY) ?? "",
};

let countdownIntervalId = null;
let draftSortable = null;
let detailSortable = null;
const expandedExerciseIds = new Set();

const PAGE_META = {
  home: { eyebrow: "Gym Planner", title: () => "訓練紀錄" },
  "plan-create": { eyebrow: "新增課表", title: () => "建立新課表" },
  "plan-list": { eyebrow: "課表列表", title: () => "選擇要編輯的課表" },
  "plan-detail": {
    eyebrow: "課表內容",
    title: () => findPlan(state.activePlanId)?.name ?? "課表",
  },
  workout: {
    eyebrow: "開始訓練",
    title: () => state.activeWorkout?.planName ?? "尚未開始訓練",
  },
  history: { eyebrow: "歷史紀錄", title: () => "完成過的課表" },
  sheets: { eyebrow: "Google Sheets", title: () => "課表同步與 AI" },
};

const SHEETS_PROMPT = `請設計一份健身課表，輸出為 CSV 格式（每組一列）。標頭必須是：
plan,exercise,weight,reps,rest

範例：
plan,exercise,weight,reps,rest
推日,Bench Press,60,10,90
推日,Bench Press,70,8,90
推日,Shoulder Press,30,12,60

- weight 是公斤
- reps 是次數
- rest 是組間休息秒數
- 同一動作多組就寫多列
- 一個 Google Sheets 可以放多份課表，用 plan 欄區分

請只輸出 CSV（含標頭），不要其他文字。我會把它貼到 Google Sheets 用。`;

const elements = {
  pages: document.querySelectorAll(".page"),
  navButtons: document.querySelectorAll(".nav-btn"),
  appBarBack: document.querySelector(".app-bar-back"),
  appBarMark: document.querySelector(".app-bar-mark"),
  appBarEyebrow: document.querySelector(".app-bar-eyebrow"),
  appBarTitle: document.querySelector(".app-bar-title"),
  draftPlanName: document.querySelector("#draft-plan-name"),
  draftExerciseList: document.querySelector("#draft-exercise-list"),
  draftExerciseForm: document.querySelector("#draft-exercise-form"),
  commitPlanBtn: document.querySelector("#commit-plan-btn"),
  planList: document.querySelector("#plan-list"),
  planDetailExercises: document.querySelector("#plan-detail-exercises"),
  detailAddExerciseForm: document.querySelector("#detail-add-exercise-form"),
  deletePlanBtn: document.querySelector("#delete-plan-btn"),
  workoutPlanPicker: document.querySelector("#workout-plan-picker"),
  activeWorkout: document.querySelector("#active-workout"),
  historyList: document.querySelector("#history-list"),
  timerCard: document.querySelector("#timer-card"),
  timerDisplay: document.querySelector("#timer-display"),
  timerContext: document.querySelector("#timer-context"),
  skipRestBtn: document.querySelector("#skip-rest-btn"),
  completionModal: document.querySelector("#completion-modal"),
  completionCopy: document.querySelector("#completion-copy"),
  completionHomeBtn: document.querySelector("#completion-home-btn"),
  planSummaryTemplate: document.querySelector("#plan-summary-template"),
  exerciseEditorTemplate: document.querySelector("#exercise-editor-template"),
  workoutPlanTemplate: document.querySelector("#workout-plan-template"),
  activeExerciseTemplate: document.querySelector("#active-exercise-template"),
  activeSetTemplate: document.querySelector("#active-set-template"),
  historyCardTemplate: document.querySelector("#history-card-template"),
  sheetsUrl: document.querySelector("#sheets-url"),
  saveSheetsUrlBtn: document.querySelector("#save-sheets-url-btn"),
  syncSheetsBtn: document.querySelector("#sync-sheets-btn"),
  sheetsStatus: document.querySelector("#sheets-status"),
  copySheetsPromptBtn: document.querySelector("#copy-sheets-prompt-btn"),
  copyAnalysisBtn: document.querySelector("#copy-analysis-btn"),
};

initialize();

function initialize() {
  elements.appBarBack.addEventListener("click", goBack);
  elements.draftExerciseForm.addEventListener("submit", handleDraftAddExercise);
  elements.commitPlanBtn.addEventListener("click", commitDraftPlan);
  elements.detailAddExerciseForm.addEventListener("submit", handleDetailAddExercise);
  elements.deletePlanBtn.addEventListener("click", handleDeletePlan);
  elements.saveSheetsUrlBtn.addEventListener("click", saveSheetsUrl);
  elements.syncSheetsBtn.addEventListener("click", syncFromSheets);
  elements.copySheetsPromptBtn.addEventListener("click", copySheetsPrompt);
  elements.copyAnalysisBtn.addEventListener("click", copyAnalysisData);
  elements.sheetsUrl.value = state.sheetsUrl;
  elements.skipRestBtn.addEventListener("click", skipRestCountdown);
  elements.completionHomeBtn.addEventListener("click", handleCompletionHome);
  elements.navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.page;
      if (target === "plan-create") {
        resetDraftPlan();
      }
      setPage(target);
    });
  });
  requestNotificationPermission();
  reconcileActiveWorkout();
  render();
  ensureCountdown();
}

function setPage(pageId) {
  state.currentPage = pageId;
  renderPages();
  if (pageId === "plan-create") renderDraftPlan();
  if (pageId === "plan-detail") renderPlanDetail();
}

function goBack() {
  if (state.currentPage === "plan-detail") {
    state.activePlanId = null;
    setPage("plan-list");
    return;
  }
  setPage("home");
}

function resetDraftPlan() {
  state.draftPlan = { exercises: [] };
  if (elements.draftPlanName) elements.draftPlanName.value = "";
}

function handleDraftAddExercise(event) {
  event.preventDefault();
  const input = elements.draftExerciseForm.elements.exerciseName;
  const name = input.value.trim();
  if (!name) return;
  state.draftPlan.exercises.push({
    id: crypto.randomUUID(),
    name,
    sets: [],
  });
  elements.draftExerciseForm.reset();
  renderDraftPlan();
}

function addDraftSet(exerciseId, formData) {
  const exercise = state.draftPlan.exercises.find((ex) => ex.id === exerciseId);
  if (!exercise) return false;
  const reps = Number(formData.get("reps"));
  const weight = Number(formData.get("weight"));
  const restSeconds = Number(formData.get("rest"));
  if (!reps || Number.isNaN(weight) || Number.isNaN(restSeconds) || restSeconds < 0) {
    return false;
  }
  exercise.sets.push({
    id: crypto.randomUUID(),
    reps,
    weight,
    restSeconds,
  });
  renderDraftPlan();
  return true;
}

function removeDraftExercise(exerciseId) {
  state.draftPlan.exercises = state.draftPlan.exercises.filter((ex) => ex.id !== exerciseId);
  renderDraftPlan();
}

function removeDraftSet(exerciseId, setId) {
  const exercise = state.draftPlan.exercises.find((ex) => ex.id === exerciseId);
  if (!exercise) return;
  exercise.sets = exercise.sets.filter((set) => set.id !== setId);
  renderDraftPlan();
}

function duplicateDraftSet(exerciseId, setId) {
  const exercise = state.draftPlan.exercises.find((ex) => ex.id === exerciseId);
  if (!exercise) return;
  const idx = exercise.sets.findIndex((s) => s.id === setId);
  if (idx < 0) return;
  const original = exercise.sets[idx];
  exercise.sets.splice(idx + 1, 0, {
    id: crypto.randomUUID(),
    weight: original.weight,
    reps: original.reps,
    restSeconds: original.restSeconds,
  });
  renderDraftPlan();
}

function removeSet(planId, exerciseId, setId) {
  if (state.activeWorkout?.planId === planId) return;
  const exercise = findExercise(planId, exerciseId);
  if (!exercise) return;
  exercise.sets = exercise.sets.filter((set) => set.id !== setId);
  persistState();
  renderPlans();
  renderPlanDetail();
  renderWorkoutPlanPicker();
}

function duplicateSet(planId, exerciseId, setId) {
  if (state.activeWorkout?.planId === planId) return;
  const exercise = findExercise(planId, exerciseId);
  if (!exercise) return;
  const idx = exercise.sets.findIndex((s) => s.id === setId);
  if (idx < 0) return;
  const original = exercise.sets[idx];
  exercise.sets.splice(idx + 1, 0, {
    id: crypto.randomUUID(),
    weight: original.weight,
    reps: original.reps,
    restSeconds: original.restSeconds,
  });
  persistState();
  renderPlans();
  renderPlanDetail();
  renderWorkoutPlanPicker();
}

function saveSheetsUrl() {
  const url = elements.sheetsUrl.value.trim();
  state.sheetsUrl = url;
  if (url) {
    localStorage.setItem(SHEETS_URL_KEY, url);
  } else {
    localStorage.removeItem(SHEETS_URL_KEY);
  }
  showSheetsStatus(url ? "已儲存" : "已清除", "ok");
}

async function syncFromSheets() {
  const url = state.sheetsUrl;
  if (!url) {
    showSheetsStatus("請先設定並儲存 Sheets 網址。", "error");
    return;
  }
  showSheetsStatus("同步中…", "ok");
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const csv = await res.text();
    const plans = csvToPlans(csv);
    if (plans.length === 0) {
      showSheetsStatus("Sheets 沒有可解析的課表資料。", "error");
      return;
    }
    state.plans = plans;
    persistState();
    render();
    showSheetsStatus(`已同步 ${plans.length} 份課表、${plans.reduce((s, p) => s + countPlanSets(p), 0)} 組。`, "ok");
  } catch (err) {
    showSheetsStatus("同步失敗：" + err.message, "error");
  }
}

function csvToPlans(csv) {
  const rows = parseCSV(csv);
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const idx = {
    plan: headers.indexOf("plan"),
    exercise: headers.indexOf("exercise"),
    weight: headers.indexOf("weight"),
    reps: headers.indexOf("reps"),
    rest: headers.indexOf("rest"),
  };
  if (idx.plan < 0 || idx.exercise < 0) {
    throw new Error("CSV 缺少 plan 或 exercise 欄");
  }
  const plansMap = new Map();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const planName = (row[idx.plan] ?? "").trim();
    const exerciseName = (row[idx.exercise] ?? "").trim();
    if (!planName || !exerciseName) continue;
    const reps = Number(row[idx.reps]);
    if (!reps || reps < 1) continue;
    let plan = plansMap.get(planName);
    if (!plan) {
      plan = {
        id: crypto.randomUUID(),
        name: planName,
        date: formatDateInput(new Date()),
        createdAt: new Date().toISOString(),
        exercises: [],
      };
      plansMap.set(planName, plan);
    }
    let exercise = plan.exercises.find((e) => e.name === exerciseName);
    if (!exercise) {
      exercise = { id: crypto.randomUUID(), name: exerciseName, sets: [] };
      plan.exercises.push(exercise);
    }
    exercise.sets.push({
      id: crypto.randomUUID(),
      weight: Number(row[idx.weight]) || 0,
      reps,
      restSeconds: Number(row[idx.rest]) || 0,
    });
  }
  return Array.from(plansMap.values());
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.length > 1 || row[0].trim() !== "") rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    if (row.length > 1 || row[0].trim() !== "") rows.push(row);
  }
  return rows;
}

function showSheetsStatus(message, kind) {
  elements.sheetsStatus.textContent = message;
  elements.sheetsStatus.dataset.kind = kind;
  elements.sheetsStatus.classList.remove("hidden");
}

async function copySheetsPrompt() {
  await copyToClipboard(SHEETS_PROMPT, elements.copySheetsPromptBtn);
}

async function copyAnalysisData() {
  const data = {
    plans: state.plans.map((p) => ({
      name: p.name,
      exercises: p.exercises.map((ex) => ({
        name: ex.name,
        sets: ex.sets.map((s) => ({ weight: s.weight, reps: s.reps, rest: s.restSeconds })),
      })),
    })),
    history: state.history.map((h) => ({
      planName: h.planName,
      startedAt: h.startedAt,
      completedAt: h.completedAt,
      exercises: h.exercises.map((ex) => ({
        name: ex.name,
        sets: ex.sets.map((s) => ({
          weight: s.weight,
          reps: s.reps,
          rest: s.restSeconds,
          completed: s.completed,
          completedAt: s.completedAt,
        })),
      })),
    })),
  };
  await copyToClipboard(JSON.stringify(data, null, 2), elements.copyAnalysisBtn);
}

async function copyToClipboard(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    if (button) {
      const original = button.textContent;
      button.textContent = "已複製";
      setTimeout(() => {
        button.textContent = original;
      }, 1500);
    }
  } catch (err) {
    showSheetsStatus("複製失敗：" + err.message, "error");
  }
}

function toggleExerciseExpanded(exerciseId, card) {
  if (expandedExerciseIds.has(exerciseId)) {
    expandedExerciseIds.delete(exerciseId);
    card.classList.remove("is-expanded");
  } else {
    expandedExerciseIds.add(exerciseId);
    card.classList.add("is-expanded");
  }
}

function collapseAllInList(listEl) {
  expandedExerciseIds.clear();
  listEl.querySelectorAll(".nested-card").forEach((c) => c.classList.remove("is-expanded"));
}

function ensureSortable(existing, listEl, onReorder, disabled = false) {
  if (existing) existing.destroy();
  if (typeof window.Sortable !== "function") return null;
  return new window.Sortable(listEl, {
    animation: 150,
    handle: ".drag-handle",
    forceFallback: true,
    fallbackTolerance: 4,
    disabled,
    onStart: () => collapseAllInList(listEl),
    onEnd: (evt) => {
      if (evt.oldIndex === evt.newIndex) return;
      onReorder(evt.oldIndex, evt.newIndex);
    },
  });
}

function reorderDraftExercise(oldIdx, newIdx) {
  const arr = state.draftPlan.exercises;
  if (oldIdx < 0 || oldIdx >= arr.length || newIdx < 0 || newIdx >= arr.length) return;
  const [moved] = arr.splice(oldIdx, 1);
  arr.splice(newIdx, 0, moved);
}

function reorderPlanExercise(planId, oldIdx, newIdx) {
  const plan = findPlan(planId);
  if (!plan) return;
  if (oldIdx < 0 || oldIdx >= plan.exercises.length || newIdx < 0 || newIdx >= plan.exercises.length) return;
  const [moved] = plan.exercises.splice(oldIdx, 1);
  plan.exercises.splice(newIdx, 0, moved);
  persistState();
  renderPlans();
  renderWorkoutPlanPicker();
}

function commitDraftPlan() {
  const name = elements.draftPlanName.value.trim();
  if (!name) {
    elements.draftPlanName.focus();
    return;
  }

  state.plans.unshift({
    id: crypto.randomUUID(),
    name,
    date: formatDateInput(new Date()),
    createdAt: new Date().toISOString(),
    exercises: state.draftPlan.exercises.map((exercise) => ({
      id: crypto.randomUUID(),
      name: exercise.name,
      sets: exercise.sets.map((set) => ({
        id: crypto.randomUUID(),
        reps: set.reps,
        weight: set.weight,
        restSeconds: set.restSeconds,
      })),
    })),
  });

  resetDraftPlan();
  persistState();
  setPage("home");
  render();
}

function openPlanDetail(planId) {
  state.activePlanId = planId;
  setPage("plan-detail");
}

function handleDetailAddExercise(event) {
  event.preventDefault();
  const input = elements.detailAddExerciseForm.elements.exerciseName;
  const name = input.value.trim();
  if (!name || !state.activePlanId) return;
  addExercise(state.activePlanId, name);
  elements.detailAddExerciseForm.reset();
}

function handleDeletePlan() {
  if (!state.activePlanId) return;
  if (state.activeWorkout && state.activeWorkout.planId === state.activePlanId) return;
  const id = state.activePlanId;
  state.activePlanId = null;
  state.plans = state.plans.filter((plan) => plan.id !== id);
  persistState();
  setPage("plan-list");
  render();
}

function deletePlanFromList(planId) {
  if (state.activeWorkout?.planId === planId) return;
  state.plans = state.plans.filter((plan) => plan.id !== planId);
  if (state.activePlanId === planId) state.activePlanId = null;
  persistState();
  renderPlans();
  renderWorkoutPlanPicker();
}

function removeExercise(planId, exerciseId) {
  if (state.activeWorkout?.planId === planId) return;
  const plan = findPlan(planId);
  if (!plan) return;
  plan.exercises = plan.exercises.filter((ex) => ex.id !== exerciseId);
  persistState();
  renderPlans();
  renderPlanDetail();
  renderWorkoutPlanPicker();
}

function addExercise(planId, exerciseName) {
  const plan = findPlan(planId);
  if (!plan || !exerciseName) return;
  plan.exercises.push({
    id: crypto.randomUUID(),
    name: exerciseName,
    sets: [],
  });
  persistState();
  renderPlans();
  renderPlanDetail();
  renderWorkoutPlanPicker();
}

function addSet(planId, exerciseId, formData) {
  const exercise = findExercise(planId, exerciseId);
  if (!exercise) return false;
  const reps = Number(formData.get("reps"));
  const weight = Number(formData.get("weight"));
  const restSeconds = Number(formData.get("rest"));
  if (!reps || Number.isNaN(weight) || Number.isNaN(restSeconds) || restSeconds < 0) {
    return false;
  }
  exercise.sets.push({
    id: crypto.randomUUID(),
    reps,
    weight,
    restSeconds,
  });
  persistState();
  renderPlans();
  renderPlanDetail();
  renderWorkoutPlanPicker();
  return true;
}

function startWorkout(planId) {
  const plan = findPlan(planId);
  if (!plan || !plan.exercises.length || !plan.exercises.some((exercise) => exercise.sets.length > 0)) {
    return;
  }

  state.activeWorkout = {
    id: crypto.randomUUID(),
    planId: plan.id,
    planName: plan.name,
    planDate: plan.date,
    startedAt: new Date().toISOString(),
    expandedExerciseIds: [],
    exercises: plan.exercises.map((exercise) => ({
      id: crypto.randomUUID(),
      name: exercise.name,
      completed: false,
      sets: exercise.sets.map((set, index) => ({
        id: crypto.randomUUID(),
        order: index + 1,
        reps: set.reps,
        weight: set.weight,
        restSeconds: set.restSeconds,
        completed: false,
        completedAt: null,
      })),
    })),
    countdown: null,
  };

  state.activeWorkout.expandedExerciseIds = state.activeWorkout.exercises.map((exercise) => exercise.id);
  persistState();
  setPage("workout");
  render();
  ensureCountdown();
}

function toggleExercise(exerciseId) {
  if (!state.activeWorkout) return;
  const expanded = new Set(state.activeWorkout.expandedExerciseIds);
  if (expanded.has(exerciseId)) {
    expanded.delete(exerciseId);
  } else {
    expanded.add(exerciseId);
  }
  state.activeWorkout.expandedExerciseIds = Array.from(expanded);
  persistState();
  renderActiveWorkout();
}

function completeSet(exerciseId, setId) {
  const set = findActiveSet(exerciseId, setId);
  if (!set || set.completed) return;
  set.completed = true;
  set.completedAt = new Date().toISOString();
  syncExerciseCompletion();
  startCountdown(exerciseId, set);
  persistState();
  renderActiveWorkout();
  renderWorkoutPlanPicker();
}

function syncExerciseCompletion() {
  if (!state.activeWorkout) return;
  state.activeWorkout.exercises.forEach((exercise) => {
    const totalSets = exercise.sets.length;
    exercise.completed = totalSets > 0 && exercise.sets.every((set) => set.completed);
  });

  if (state.activeWorkout.exercises.length > 0 && state.activeWorkout.exercises.every((exercise) => exercise.completed)) {
    finishWorkout();
  }
}

function finishWorkout() {
  if (!state.activeWorkout) return;
  const completedAt = new Date().toISOString();
  const completedPlanName = state.activeWorkout.planName;
  state.history.unshift({
    id: crypto.randomUUID(),
    planName: completedPlanName,
    planDate: state.activeWorkout.planDate,
    startedAt: state.activeWorkout.startedAt,
    completedAt,
    exercises: state.activeWorkout.exercises,
  });

  state.activeWorkout = null;
  stopCountdown();
  persistState();
  render();
  openCompletionModal(completedPlanName);
}

function startCountdown(exerciseId, set) {
  if (!state.activeWorkout) return;
  if (set.restSeconds <= 0) {
    state.activeWorkout.countdown = null;
    stopCountdown(false);
    persistState();
    return;
  }

  state.activeWorkout.countdown = {
    exerciseId,
    setId: set.id,
    endsAt: Date.now() + set.restSeconds * 1000,
  };

  persistState();
  ensureCountdown();
}

function ensureCountdown() {
  if (!state.activeWorkout?.countdown) {
    stopCountdown(false);
    updateTimerCard();
    return;
  }

  if (countdownIntervalId) {
    clearInterval(countdownIntervalId);
  }

  updateTimerCard();
  countdownIntervalId = window.setInterval(() => {
    const countdown = state.activeWorkout?.countdown;
    if (!countdown) {
      stopCountdown(false);
      updateTimerCard();
      return;
    }

    if (countdown.endsAt <= Date.now()) {
      handleCountdownComplete();
      return;
    }

    updateTimerCard();
  }, TIMER_TICK_MS);
}

function handleCountdownComplete() {
  const countdown = state.activeWorkout?.countdown;
  if (!countdown) return;
  const context = getCountdownContext(countdown);
  state.activeWorkout.countdown = null;
  stopCountdown(false);
  persistState();
  updateTimerCard();
  notifyRestFinished(context);
}

function skipRestCountdown() {
  if (!state.activeWorkout?.countdown) return;
  state.activeWorkout.countdown = null;
  stopCountdown(false);
  persistState();
  updateTimerCard();
}

function openCompletionModal(planName) {
  elements.completionCopy.textContent = `${planName} 已完成，並且已收錄到歷史紀錄。`;
  elements.completionModal.classList.remove("hidden");
}

function handleCompletionHome() {
  elements.completionModal.classList.add("hidden");
  setPage("home");
}

function stopCountdown(clearStored = true) {
  if (countdownIntervalId) {
    clearInterval(countdownIntervalId);
    countdownIntervalId = null;
  }

  if (clearStored && state.activeWorkout) {
    state.activeWorkout.countdown = null;
  }
}

function reconcileActiveWorkout() {
  const workout = state.activeWorkout;
  if (!workout) return;

  workout.expandedExerciseIds = Array.isArray(workout.expandedExerciseIds)
    ? workout.expandedExerciseIds
    : workout.exercises.map((exercise) => exercise.id);

  if (workout.countdown && workout.countdown.endsAt <= Date.now()) {
    workout.countdown = null;
  }

  syncExerciseCompletion();
  persistState();
}

function render() {
  renderPages();
  renderPlans();
  renderDraftPlan();
  renderPlanDetail();
  renderWorkoutPlanPicker();
  renderActiveWorkout();
  renderHistory();
}

function renderPages() {
  elements.pages.forEach((page) => {
    const isActive = page.id === `page-${state.currentPage}`;
    page.classList.toggle("hidden", !isActive);
    page.classList.toggle("is-active", isActive);
  });

  const isHome = state.currentPage === "home";
  elements.appBarBack.classList.toggle("hidden", isHome);
  elements.appBarMark.classList.toggle("hidden", !isHome);

  const meta = PAGE_META[state.currentPage] ?? PAGE_META.home;
  elements.appBarEyebrow.textContent = meta.eyebrow;
  elements.appBarTitle.textContent = meta.title();
}

function renderPlans() {
  elements.planList.innerHTML = "";

  if (state.plans.length === 0) {
    elements.planList.append(createEmpty("目前沒有可用的課表"));
    return;
  }

  state.plans.forEach((plan) => {
    const fragment = elements.planSummaryTemplate.content.cloneNode(true);
    const wrapper = fragment.querySelector(".plan-summary");
    const main = fragment.querySelector(".plan-summary-main");
    const deleteBtn = fragment.querySelector(".plan-summary-delete");
    const name = fragment.querySelector(".plan-summary-name");
    const meta = fragment.querySelector(".plan-summary-meta");

    name.textContent = plan.name;
    meta.textContent = `${plan.exercises.length} 個動作 · ${countPlanSets(plan)} 組`;
    if (state.activeWorkout?.planId === plan.id) {
      wrapper.dataset.active = "true";
      deleteBtn.disabled = true;
    }
    main.addEventListener("click", () => openPlanDetail(plan.id));
    deleteBtn.addEventListener("click", () => deletePlanFromList(plan.id));
    elements.planList.append(fragment);
  });
}

function renderDraftPlan() {
  if (!elements.draftExerciseList) return;
  elements.draftExerciseList.innerHTML = "";

  state.draftPlan.exercises.forEach((exercise) => {
    elements.draftExerciseList.append(renderDraftExerciseCard(exercise));
  });

  draftSortable = ensureSortable(
    draftSortable,
    elements.draftExerciseList,
    (oldIdx, newIdx) => reorderDraftExercise(oldIdx, newIdx)
  );
}

function renderDraftExerciseCard(exercise) {
  const fragment = elements.exerciseEditorTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".nested-card");
  const toggleBtn = fragment.querySelector(".exercise-toggle-btn");
  const name = fragment.querySelector(".exercise-name");
  const meta = fragment.querySelector(".exercise-meta");
  const setForm = fragment.querySelector(".set-form");
  const setList = fragment.querySelector(".set-chip-list");
  const removeBtn = fragment.querySelector(".remove-exercise-btn");

  card.dataset.exerciseId = exercise.id;
  name.textContent = exercise.name;
  meta.textContent = `${exercise.sets.length} 組`;

  if (expandedExerciseIds.has(exercise.id)) card.classList.add("is-expanded");
  toggleBtn.addEventListener("click", () => toggleExerciseExpanded(exercise.id, card));

  removeBtn.addEventListener("click", () => removeDraftExercise(exercise.id));

  setForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const success = addDraftSet(exercise.id, new FormData(setForm));
    if (success) setForm.reset();
  });

  exercise.sets.forEach((set) => {
    setList.append(
      createSetChip(
        set,
        () => removeDraftSet(exercise.id, set.id),
        () => duplicateDraftSet(exercise.id, set.id)
      )
    );
  });

  return fragment;
}

function renderPlanDetail() {
  if (!elements.planDetailExercises) return;
  if (!state.activePlanId) {
    elements.planDetailExercises.innerHTML = "";
    return;
  }
  const plan = findPlan(state.activePlanId);
  if (!plan) {
    state.activePlanId = null;
    if (state.currentPage === "plan-detail") setPage("plan-list");
    return;
  }

  elements.deletePlanBtn.disabled = state.activeWorkout?.planId === plan.id;
  elements.planDetailExercises.innerHTML = "";

  if (plan.exercises.length === 0) {
    elements.planDetailExercises.append(createEmpty("先加入至少一個動作。"));
    return;
  }

  plan.exercises.forEach((exercise) => {
    elements.planDetailExercises.append(renderExerciseEditor(plan.id, exercise));
  });

  detailSortable = ensureSortable(
    detailSortable,
    elements.planDetailExercises,
    (oldIdx, newIdx) => reorderPlanExercise(plan.id, oldIdx, newIdx),
    state.activeWorkout?.planId === plan.id
  );
}

function renderExerciseEditor(planId, exercise) {
  const fragment = elements.exerciseEditorTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".nested-card");
  const toggleBtn = fragment.querySelector(".exercise-toggle-btn");
  const name = fragment.querySelector(".exercise-name");
  const meta = fragment.querySelector(".exercise-meta");
  const setForm = fragment.querySelector(".set-form");
  const setList = fragment.querySelector(".set-chip-list");
  const removeBtn = fragment.querySelector(".remove-exercise-btn");

  card.dataset.exerciseId = exercise.id;
  name.textContent = exercise.name;
  meta.textContent = `${exercise.sets.length} 組`;

  if (expandedExerciseIds.has(exercise.id)) card.classList.add("is-expanded");
  toggleBtn.addEventListener("click", () => toggleExerciseExpanded(exercise.id, card));

  removeBtn.addEventListener("click", () => removeExercise(planId, exercise.id));
  if (state.activeWorkout?.planId === planId) {
    removeBtn.disabled = true;
  }

  setForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const success = addSet(planId, exercise.id, new FormData(setForm));
    if (success) setForm.reset();
  });

  const isLocked = state.activeWorkout?.planId === planId;
  exercise.sets.forEach((set) => {
    setList.append(
      createSetChip(
        set,
        isLocked ? null : () => removeSet(planId, exercise.id, set.id),
        isLocked ? null : () => duplicateSet(planId, exercise.id, set.id)
      )
    );
  });

  return fragment;
}

function createSetChip(set, onDelete, onDuplicate) {
  const chip = document.createElement("div");
  chip.className = "set-chip";
  const detail = document.createElement("span");
  detail.className = "set-chip-detail";
  detail.textContent = `${formatWeight(set.weight)} kg × ${set.reps} 組  休息 ${set.restSeconds} 秒`;
  chip.append(detail);
  if (onDuplicate) {
    const dupBtn = document.createElement("button");
    dupBtn.type = "button";
    dupBtn.className = "set-chip-copy icon-btn";
    dupBtn.setAttribute("aria-label", "複製組");
    dupBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="1.5"/><path d="M5 15V5a2 2 0 012-2h10"/></svg>';
    dupBtn.addEventListener("click", onDuplicate);
    chip.append(dupBtn);
  }
  if (onDelete) {
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "set-chip-delete icon-btn";
    removeBtn.setAttribute("aria-label", "刪除組");
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", onDelete);
    chip.append(removeBtn);
  }
  return chip;
}

function renderWorkoutPlanPicker() {
  elements.workoutPlanPicker.innerHTML = "";

  if (state.activeWorkout) return;

  const startablePlans = state.plans.filter((plan) => plan.exercises.some((exercise) => exercise.sets.length > 0));

  if (startablePlans.length === 0) {
    elements.workoutPlanPicker.append(createEmpty("目前沒有可用的課表"));
    return;
  }

  startablePlans.forEach((plan) => {
    const fragment = elements.workoutPlanTemplate.content.cloneNode(true);
    const title = fragment.querySelector(".card-title");
    const meta = fragment.querySelector(".card-meta");
    const startBtn = fragment.querySelector(".start-plan-btn");

    title.textContent = plan.name;
    meta.textContent = `${plan.exercises.length} 個動作 · ${countPlanSets(plan)} 組`;
    startBtn.addEventListener("click", () => startWorkout(plan.id));
    elements.workoutPlanPicker.append(fragment);
  });
}

function renderActiveWorkout() {
  elements.activeWorkout.innerHTML = "";

  if (!state.activeWorkout) {
    updateTimerCard();
    return;
  }

  state.activeWorkout.exercises.forEach((exercise) => {
    const fragment = elements.activeExerciseTemplate.content.cloneNode(true);
    const toggle = fragment.querySelector(".exercise-toggle");
    const title = fragment.querySelector(".workout-title");
    const meta = fragment.querySelector(".workout-meta");
    const badge = fragment.querySelector(".workout-badge");
    const setList = fragment.querySelector(".active-set-list");
    const isExpanded = state.activeWorkout.expandedExerciseIds.includes(exercise.id);
    const completed = exercise.sets.filter((set) => set.completed).length;
    const total = exercise.sets.length;

    title.textContent = exercise.name;
    meta.textContent = `${completed} / ${total} 組完成`;
    badge.textContent = exercise.completed ? "已完成" : "進行中";
    if (exercise.completed) {
      badge.classList.add("is-complete");
    }

    setList.classList.toggle("hidden", !isExpanded);

    toggle.addEventListener("click", () => toggleExercise(exercise.id));

    exercise.sets.forEach((set) => {
      const setFragment = elements.activeSetTemplate.content.cloneNode(true);
      const row = setFragment.querySelector(".set-row");
      const label = setFragment.querySelector(".set-label");
      const detail = setFragment.querySelector(".set-detail");
      const button = setFragment.querySelector(".complete-set-btn");

      label.textContent = `第 ${set.order} 組`;
      detail.textContent = `${formatWeight(set.weight)} kg × ${set.reps} 組  休息 ${set.restSeconds} 秒`;

      if (set.completed) {
        row.classList.add("is-complete");
        button.textContent = "已完成";
        button.disabled = true;
        button.classList.add("is-complete");
      } else {
        button.addEventListener("click", () => completeSet(exercise.id, set.id));
      }

      setList.append(setFragment);
    });

    elements.activeWorkout.append(fragment);
  });

  updateTimerCard();
}

function renderHistory() {
  elements.historyList.innerHTML = "";

  if (state.history.length === 0) {
    elements.historyList.append(createEmpty("還沒有完成過的課表。"));
    return;
  }

  state.history.forEach((record) => {
    const fragment = elements.historyCardTemplate.content.cloneNode(true);
    const title = fragment.querySelector(".card-title");
    const meta = fragment.querySelector(".card-meta");
    title.textContent = record.planName;
    meta.textContent = `${formatPlanDate(record.planDate)} · ${formatDateTime(record.startedAt)} 開始 · ${formatDateTime(record.completedAt)} 完成 · ${countWorkoutSets(record)} 組`;
    elements.historyList.append(fragment);
  });
}

function updateTimerCard() {
  const countdown = state.activeWorkout?.countdown;
  if (!countdown) {
    elements.timerCard.classList.add("hidden");
    return;
  }

  const remainingMs = Math.max(0, countdown.endsAt - Date.now());
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  elements.timerDisplay.textContent = formatDuration(remainingSeconds);
  elements.timerContext.textContent = getCountdownContext(countdown);
  elements.timerCard.classList.remove("hidden");
}

function requestNotificationPermission() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
}

function notifyRestFinished(context) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("休息時間到了", { body: context });
    return;
  }

  window.alert(`休息時間到了\n${context}`);
}

function getCountdownContext(countdown) {
  const exercise = state.activeWorkout?.exercises.find((item) => item.id === countdown.exerciseId);
  const set = exercise?.sets.find((item) => item.id === countdown.setId);

  if (!exercise || !set) {
    return "下一組可以開始了";
  }

  return `${exercise.name} · 第 ${set.order} 組`;
}

function countPlanSets(plan) {
  return plan.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0);
}

function countWorkoutSets(workout) {
  return workout.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0);
}

function countCompletedWorkoutSets(workout) {
  return workout.exercises.reduce(
    (sum, exercise) => sum + exercise.sets.filter((set) => set.completed).length,
    0
  );
}

function findPlan(planId) {
  return state.plans.find((plan) => plan.id === planId) ?? null;
}

function findExercise(planId, exerciseId) {
  const plan = findPlan(planId);
  return plan?.exercises.find((exercise) => exercise.id === exerciseId) ?? null;
}

function findActiveSet(exerciseId, setId) {
  const exercise = state.activeWorkout?.exercises.find((item) => item.id === exerciseId);
  return exercise?.sets.find((item) => item.id === setId) ?? null;
}

function formatDuration(totalSeconds) {
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatWeight(weight) {
  return Number.isInteger(weight) ? String(weight) : weight.toFixed(1);
}

function formatDateTime(isoString) {
  return new Intl.DateTimeFormat("zh-TW", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoString));
}

function formatPlanDate(dateString) {
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(`${dateString}T00:00:00`));
}

function formatDateInput(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function createEmpty(message) {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = message;
  return empty;
}

function persistState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      plans: state.plans,
      history: state.history,
      activeWorkout: state.activeWorkout,
    })
  );
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      plans: Array.isArray(parsed.plans) ? parsed.plans : [],
      history: Array.isArray(parsed.history) ? parsed.history : [],
      activeWorkout: parsed.activeWorkout ?? null,
    };
  } catch {
    return {
      plans: [],
      history: [],
      activeWorkout: null,
    };
  }
}
