const PHASES = [
  {
    name: "收紧",
    hint: "收紧骨盆底肌，保持均匀发力",
    duration: 5
  },
  {
    name: "停留",
    hint: "维持发力状态，不要憋气",
    duration: 5
  }
];

const phaseName = document.getElementById("phaseName");
const countdown = document.getElementById("countdown");
const phaseHint = document.getElementById("phaseHint");
const cycleCount = document.getElementById("cycleCount");
const elapsedTime = document.getElementById("elapsedTime");
const startButton = document.getElementById("startButton");
const pauseButton = document.getElementById("pauseButton");
const resetButton = document.getElementById("resetButton");
const squeezeStep = document.getElementById("squeezeStep");
const holdStep = document.getElementById("holdStep");

let timerId = null;
let isRunning = false;
let hasStarted = false;
let phaseIndex = 0;
let secondsLeft = PHASES[0].duration;
let cycles = 0;
let elapsed = 0;

function updateRhythm() {
  squeezeStep.classList.toggle("active", phaseIndex === 0);
  holdStep.classList.toggle("active", phaseIndex === 1);
}

function render() {
  const currentPhase = PHASES[phaseIndex];
  if (!hasStarted) {
    phaseName.textContent = "准备开始";
    phaseHint.textContent = "点击开始后进入 5 秒收紧";
  } else if (isRunning) {
    phaseName.textContent = currentPhase.name;
    phaseHint.textContent = currentPhase.hint;
  } else {
    phaseName.textContent = `${currentPhase.name} 已暂停`;
    phaseHint.textContent = "点击继续，从当前秒数接着练习";
  }

  countdown.textContent = String(secondsLeft);
  cycleCount.textContent = String(cycles);
  elapsedTime.textContent = String(elapsed);
  updateRhythm();
  startButton.disabled = isRunning;
  pauseButton.disabled = !isRunning;
  startButton.textContent = hasStarted ? "继续" : "开始";
}

function advancePhase() {
  if (phaseIndex === PHASES.length - 1) {
    cycles += 1;
  }

  phaseIndex = (phaseIndex + 1) % PHASES.length;
  secondsLeft = PHASES[phaseIndex].duration;
  render();
}

function tick() {
  if (!isRunning) {
    return;
  }

  secondsLeft -= 1;
  elapsed += 1;

  if (secondsLeft === 0) {
    advancePhase();
    return;
  }

  render();
}

function startTimer() {
  if (isRunning) {
    return;
  }

  hasStarted = true;
  isRunning = true;
  render();
  timerId = window.setInterval(tick, 1000);
}

function pauseTimer() {
  if (!isRunning) {
    return;
  }

  isRunning = false;
  window.clearInterval(timerId);
  timerId = null;
  render();
}

function resetTimer() {
  isRunning = false;
  window.clearInterval(timerId);
  timerId = null;
  phaseIndex = 0;
  secondsLeft = PHASES[0].duration;
  cycles = 0;
  elapsed = 0;
  hasStarted = false;
  render();
}

startButton.addEventListener("click", startTimer);
pauseButton.addEventListener("click", pauseTimer);
resetButton.addEventListener("click", resetTimer);

render();
