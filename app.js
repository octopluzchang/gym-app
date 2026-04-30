const STORAGE_KEY = "gym-planner-v4";
const TIMER_TICK_MS = 250;

const state = {
  ...loadState(),
  currentPage: "home",
};

let countdownIntervalId = null;

const elements = {
  pages: document.querySelectorAll(".page"),
  navButtons: document.querySelectorAll(".nav-btn"),
  planForm: document.querySelector("#plan-form"),
  planName: document.querySelector("#plan-name"),
  planDate: document.querySelector("#plan-date"),
  planList: document.querySelector("#plan-list"),
  workoutPlanPicker: document.querySelector("#workout-plan-picker"),
  activePlanTitle: document.querySelector("#active-plan-title"),
  activePlanStatus: document.querySelector("#active-plan-status"),
  activeEmpty: document.querySelector("#active-empty"),
  activeWorkout: document.querySelector("#active-workout"),
  historyList: document.querySelector("#history-list"),
  timerCard: document.querySelector("#timer-card"),
  timerDisplay: document.querySelector("#timer-display"),
  timerContext: document.querySelector("#timer-context"),
  skipRestBtn: document.querySelector("#skip-rest-btn"),
  completionModal: document.querySelector("#completion-modal"),
  completionCopy: document.querySelector("#completion-copy"),
  completionHomeBtn: document.querySelector("#completion-home-btn"),
  planCardTemplate: document.querySelector("#plan-card-template"),
  exerciseEditorTemplate: document.querySelector("#exercise-editor-template"),
  workoutPlanTemplate: document.querySelector("#workout-plan-template"),
  activeExerciseTemplate: document.querySelector("#active-exercise-template"),
  activeSetTemplate: document.querySelector("#active-set-template"),
  historyCardTemplate: document.querySelector("#history-card-template"),
};

initialize();

function initialize() {
  elements.planDate.value = formatDateInput(new Date());
  elements.planForm.addEventListener("submit", handleCreatePlan);
  elements.skipRestBtn.addEventListener("click", skipRestCountdown);
  elements.completionHomeBtn.addEventListener("click", handleCompletionHome);
  elements.navButtons.forEach((button) => {
    button.addEventListener("click", () => setPage(button.dataset.page));
  });
  requestNotificationPermission();
  reconcileActiveWorkout();
  render();
  ensureCountdown();
}

function setPage(pageId) {
  state.currentPage = pageId;
  renderPages();
}

function handleCreatePlan(event) {
  event.preventDefault();

  const name = elements.planName.value.trim();
  const date = elements.planDate.value;
  if (!name || !date) {
    return;
  }

  state.plans.unshift({
    id: crypto.randomUUID(),
    name,
    date,
    createdAt: new Date().toISOString(),
    exercises: [],
  });

  persistState();
  elements.planForm.reset();
  elements.planDate.value = formatDateInput(new Date());
  setPage("plan-list");
  renderPlans();
  renderWorkoutPlanPicker();
}

function addExercise(planId, exerciseName) {
  const plan = findPlan(planId);
  if (!plan || !exerciseName) {
    return;
  }

  plan.exercises.push({
    id: crypto.randomUUID(),
    name: exerciseName,
    sets: [],
  });

  persistState();
  renderPlans();
  renderWorkoutPlanPicker();
}

function addSet(planId, exerciseId, formData) {
  const exercise = findExercise(planId, exerciseId);
  if (!exercise) {
    return false;
  }

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
  renderWorkoutPlanPicker();
  return true;
}

function deletePlan(planId) {
  if (state.activeWorkout && state.activeWorkout.planId === planId) {
    return;
  }

  state.plans = state.plans.filter((plan) => plan.id !== planId);
  persistState();
  renderPlans();
  renderWorkoutPlanPicker();
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
  if (!state.activeWorkout) {
    return;
  }

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
  if (!set || set.completed) {
    return;
  }

  set.completed = true;
  set.completedAt = new Date().toISOString();
  syncExerciseCompletion();
  startCountdown(exerciseId, set);
  persistState();
  renderActiveWorkout();
  renderWorkoutPlanPicker();
}

function syncExerciseCompletion() {
  if (!state.activeWorkout) {
    return;
  }

  state.activeWorkout.exercises.forEach((exercise) => {
    const totalSets = exercise.sets.length;
    exercise.completed = totalSets > 0 && exercise.sets.every((set) => set.completed);
  });

  if (state.activeWorkout.exercises.length > 0 && state.activeWorkout.exercises.every((exercise) => exercise.completed)) {
    finishWorkout();
  }
}

function finishWorkout() {
  if (!state.activeWorkout) {
    return;
  }

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
  if (!state.activeWorkout) {
    return;
  }

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
  if (!countdown) {
    return;
  }

  const context = getCountdownContext(countdown);
  state.activeWorkout.countdown = null;
  stopCountdown(false);
  persistState();
  updateTimerCard();
  notifyRestFinished(context);
}

function skipRestCountdown() {
  if (!state.activeWorkout?.countdown) {
    return;
  }

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
  if (!workout) {
    return;
  }

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
}

function renderPlans() {
  elements.planList.innerHTML = "";

  if (state.plans.length === 0) {
    elements.planList.append(createEmpty("還沒有課表，先建立一個。"));
    return;
  }

  state.plans.forEach((plan) => {
    const fragment = elements.planCardTemplate.content.cloneNode(true);
    const title = fragment.querySelector(".card-title");
    const meta = fragment.querySelector(".card-meta");
    const badge = fragment.querySelector(".status-badge");
    const addExerciseForm = fragment.querySelector(".add-exercise-form");
    const exerciseList = fragment.querySelector(".exercise-list");
    const deleteBtn = fragment.querySelector(".delete-plan-btn");

    title.textContent = plan.name;
    meta.textContent = `${formatPlanDate(plan.date)} · ${plan.exercises.length} 個動作 · ${countPlanSets(plan)} 組`;
    badge.textContent = state.activeWorkout?.planId === plan.id ? "進行中" : "待開始";
    if (state.activeWorkout?.planId === plan.id) {
      badge.classList.add("is-complete");
    }

    addExerciseForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = addExerciseForm.elements.exerciseName;
      const exerciseName = input.value.trim();
      addExercise(plan.id, exerciseName);
      addExerciseForm.reset();
    });

    plan.exercises.forEach((exercise) => {
      exerciseList.append(renderExerciseEditor(plan.id, exercise));
    });

    if (plan.exercises.length === 0) {
      exerciseList.append(createEmpty("先加入至少一個動作。"));
    }

    deleteBtn.addEventListener("click", () => deletePlan(plan.id));
    deleteBtn.disabled = state.activeWorkout?.planId === plan.id;
    elements.planList.append(fragment);
  });
}

function renderExerciseEditor(planId, exercise) {
  const fragment = elements.exerciseEditorTemplate.content.cloneNode(true);
  const name = fragment.querySelector(".exercise-name");
  const meta = fragment.querySelector(".exercise-meta");
  const setForm = fragment.querySelector(".set-form");
  const setList = fragment.querySelector(".set-chip-list");

  name.textContent = exercise.name;
  meta.textContent = `${exercise.sets.length} 組`;

  setForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const success = addSet(planId, exercise.id, new FormData(setForm));
    if (success) {
      setForm.reset();
    }
  });

  exercise.sets.forEach((set, index) => {
    const chip = document.createElement("div");
    chip.className = "set-chip";
    chip.innerHTML = `
      <strong>第 ${index + 1} 組</strong>
      <span>${set.reps} 下 · ${formatWeight(set.weight)} kg · 休息 ${set.restSeconds} 秒</span>
    `;
    setList.append(chip);
  });

  if (exercise.sets.length === 0) {
    setList.append(createEmpty("先加入至少一個組。"));
  }

  return fragment;
}

function renderWorkoutPlanPicker() {
  elements.workoutPlanPicker.innerHTML = "";

  if (state.activeWorkout) {
    return;
  }

  const startablePlans = state.plans.filter((plan) => plan.exercises.some((exercise) => exercise.sets.length > 0));

  if (startablePlans.length === 0) {
    elements.workoutPlanPicker.append(createEmpty("目前沒有可開始的課表。"));
    return;
  }

  startablePlans.forEach((plan) => {
    const fragment = elements.workoutPlanTemplate.content.cloneNode(true);
    const title = fragment.querySelector(".card-title");
    const meta = fragment.querySelector(".card-meta");
    const startBtn = fragment.querySelector(".start-plan-btn");

    title.textContent = plan.name;
    meta.textContent = `${formatPlanDate(plan.date)} · ${plan.exercises.length} 個動作 · ${countPlanSets(plan)} 組`;
    startBtn.addEventListener("click", () => startWorkout(plan.id));
    elements.workoutPlanPicker.append(fragment);
  });
}

function renderActiveWorkout() {
  elements.activeWorkout.innerHTML = "";

  if (!state.activeWorkout) {
    elements.activePlanTitle.textContent = "尚未開始訓練";
    elements.activePlanStatus.textContent = "0 / 0 組完成";
    elements.activeEmpty.classList.remove("hidden");
    updateTimerCard();
    return;
  }

  const totalSets = countWorkoutSets(state.activeWorkout);
  const completedSets = countCompletedWorkoutSets(state.activeWorkout);

  elements.activePlanTitle.textContent = state.activeWorkout.planName;
  elements.activePlanStatus.textContent = `${completedSets} / ${totalSets} 組完成`;
  elements.activeEmpty.classList.add("hidden");

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
      detail.textContent = `${set.reps} 下 · ${formatWeight(set.weight)} kg · 休息 ${set.restSeconds} 秒`;

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
  if (!("Notification" in window)) {
    return;
  }

  if (Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
}

function notifyRestFinished(context) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("休息時間到了", {
      body: context,
    });
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
