(function () {
  "use strict";

  // Pure adaptive-learning policy. This module deliberately knows nothing
  // about the DOM, localStorage, dictionary globals, or round UI. Callers
  // supply learner/item state and receive deterministic scores or choices.
  const DEFAULT_MODE_BIASES = Object.freeze({
    forward: 0.6,
    cloze: 0.25,
    listening: 0.1,
    reverse: -0.2,
    "typed-cloze": -0.45,
    "typed-reverse": -0.65,
    "typed-listening": -0.75,
  });
  const DEFAULT_MODE_PREREQUISITES = Object.freeze({
    cloze: "forward",
    "typed-cloze": "cloze",
    reverse: "cloze",
    "typed-reverse": "reverse",
    listening: "reverse",
    "typed-listening": "listening",
  });
  const DEFAULT_SKILLS = Object.freeze([
    "recognition",
    "context",
    "production",
    "listening",
  ]);
  const RESPONSE_TIME_TARGET_MS = Object.freeze({
    forward: 4500,
    cloze: 6500,
    listening: 6000,
    reverse: 6500,
    "typed-cloze": 10000,
    "typed-reverse": 10000,
    "typed-listening": 10000,
  });
  const CONTEXT_VARIATION_MIN_SUCCESSES = 3;
  const DEFAULT_QUEUE_PRIORITY = Object.freeze([
    "relearning",
    "due",
    "approaching",
    "new",
    "scheduled",
  ]);

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function clampProbability(value) {
    return clamp(value, 0.02, 0.98);
  }

  function probabilityToLogOdds(value) {
    const probability = clampProbability(value);
    return Math.log(probability / (1 - probability));
  }

  function logOddsToProbability(value) {
    return 1 / (1 + Math.exp(-value));
  }

  function getExpectedSuccessProbability(
    wordDifficulty,
    ability,
    logisticScale,
  ) {
    return 1 / (1 + Math.exp((wordDifficulty - ability) / logisticScale));
  }

  function getExerciseAdjustedSuccessProbability(
    abilityProbability,
    exerciseBias = 0,
  ) {
    return clampProbability(
      logOddsToProbability(
        probabilityToLogOdds(abilityProbability) + exerciseBias,
      ),
    );
  }

  function getAbilityAfterAnswer({
    ability,
    wordDifficulty,
    isCorrect,
    kFactor,
    logisticScale,
    exerciseBias = 0,
    minimum,
    maximum,
  }) {
    const expected = getExerciseAdjustedSuccessProbability(
      getExpectedSuccessProbability(wordDifficulty, ability, logisticScale),
      exerciseBias,
    );
    const actual = isCorrect ? 1 : 0;
    return clamp(ability + kFactor * (actual - expected), minimum, maximum);
  }

  function getQuestionSkill(mode) {
    if (mode === "cloze" || mode === "typed-cloze") return "context";
    if (mode === "reverse" || mode === "typed-reverse") return "production";
    if (mode === "listening" || mode === "typed-listening") return "listening";
    return "recognition";
  }

  function normalizePredictorState(
    value,
    {
      version = 1,
      modeBiases = DEFAULT_MODE_BIASES,
      calibrationLimit = 1.5,
    } = {},
  ) {
    const normalizeCalibration = (stored) => ({
      attempts: Math.max(0, Math.floor(Number(stored?.attempts) || 0)),
      bias: clamp(
        Number(stored?.bias) || 0,
        -calibrationLimit,
        calibrationLimit,
      ),
      averageResponseMs:
        Number.isFinite(stored?.averageResponseMs) &&
        stored.averageResponseMs > 0
          ? stored.averageResponseMs
          : null,
      exactCorrect: Math.max(
        0,
        Math.floor(Number(stored?.exactCorrect) || 0),
      ),
      nearMisses: Math.max(0, Math.floor(Number(stored?.nearMisses) || 0)),
      misses: Math.max(0, Math.floor(Number(stored?.misses) || 0)),
      possibleGuesses: Math.max(
        0,
        Math.floor(Number(stored?.possibleGuesses) || 0),
      ),
    });
    const modes = {};
    for (const mode of Object.keys(modeBiases)) {
      modes[mode] = normalizeCalibration(value?.modes?.[mode]);
    }
    const skills = {};
    for (const skill of DEFAULT_SKILLS) {
      skills[skill] = normalizeCalibration(value?.skills?.[skill]);
    }
    return { version, modes, skills };
  }

  function getCalibrationEvidenceBias(state, mode) {
    if (!state) return 0;
    const targetResponseMs = RESPONSE_TIME_TARGET_MS[mode] ?? 6500;
    const responsePenalty = Number.isFinite(state.averageResponseMs)
      ? clamp(
          Math.log(state.averageResponseMs / targetResponseMs) * 0.18,
          0,
          0.25,
        )
      : 0;
    const gradedAttempts =
      (state.exactCorrect || 0) +
      (state.nearMisses || 0) +
      (state.misses || 0);
    const nearMissPenalty =
      gradedAttempts > 0 ? 0.15 * (state.nearMisses / gradedAttempts) : 0;
    const guessPenalty =
      gradedAttempts > 0
        ? 0.1 * ((state.possibleGuesses || 0) / gradedAttempts)
        : 0;
    return -(responsePenalty + nearMissPenalty + guessPenalty);
  }

  function getQuestionComplexityBias({
    mode,
    formLength = 0,
    formTokenCount = 1,
    sentenceTokenCount = 0,
  }) {
    const isTyped = String(mode).startsWith("typed-");
    const formPenalty = isTyped
      ? clamp(
          Math.max(0, formLength - 7) * 0.025 +
            Math.max(0, formTokenCount - 1) * 0.08,
          0,
          0.35,
        )
      : 0;
    const contextPenalty = String(mode).includes("cloze")
      ? clamp(Math.max(0, sentenceTokenCount - 10) * 0.015, 0, 0.2)
      : 0;
    return -(formPenalty + contextPenalty);
  }

  function predictSuccess({
    abilityProbability,
    hasPersonalMemory = false,
    retrievability = 0,
    modeBias = 0,
    learnedBias = 0,
    memoryShare = 0.7,
  }) {
    const memoryProbability =
      hasPersonalMemory && Number.isFinite(retrievability)
        ? memoryShare * clampProbability(retrievability) +
          (1 - memoryShare) * abilityProbability
        : abilityProbability;
    return clampProbability(
      logOddsToProbability(
        probabilityToLogOdds(memoryProbability) + modeBias + learnedBias,
      ),
    );
  }

  function getChallengeFit(
    predictedSuccess,
    { targetSuccess = 0.85, sigma = 0.1, floor = 0.1 } = {},
  ) {
    const distance = predictedSuccess - targetSuccess;
    const gaussian = Math.exp(-(distance * distance) / (2 * sigma * sigma));
    return floor + (1 - floor) * gaussian;
  }

  function getProgressionWeight(
    prerequisiteSuccess,
    { floor = 0.15, start = 0.65, full = 0.9 } = {},
  ) {
    const progress = clamp(
      (prerequisiteSuccess - start) / (full - start),
      0,
      1,
    );
    const smoothProgress = progress * progress * (3 - 2 * progress);
    return floor + (1 - floor) * smoothProgress;
  }

  function getSkillUrgencyWeight(overall, skillSnapshot) {
    const hasActiveReview = Boolean(
      overall?.record &&
        (overall.queue === "relearning" ||
          overall.isDue ||
          overall.isApproaching),
    );
    if (!hasActiveReview) return 1;

    const snapshot = skillSnapshot ?? overall;
    const need = clamp(Number(snapshot?.recallNeed) || 0, 0, 1);
    if (snapshot?.queue === "relearning") return 0.65 + 0.35 * need;
    if (snapshot?.isDue || snapshot?.queue === "due") {
      return 0.5 + 0.5 * need;
    }
    if (snapshot?.isApproaching) return 0.25 + 0.5 * need;
    return 0.05;
  }

  function updateCalibrationMode(
    modeState,
    predictedSuccess,
    wasCorrect,
    {
      calibrationLimit = 1.5,
      evidenceWeight = 1,
      outcomeValue = wasCorrect ? 1 : 0,
      responseTimeMs = null,
      nearMiss = false,
      possiblyGuessed = false,
    } = {},
  ) {
    const attempts = Math.max(0, Math.floor(Number(modeState?.attempts) || 0));
    const learningRate = Math.max(0.05, 0.3 / Math.sqrt(1 + attempts / 20));
    const boundedEvidenceWeight = clamp(evidenceWeight, 0.1, 1);
    const previousResponseMs = Number(modeState?.averageResponseMs);
    const nextResponseMs =
      Number.isFinite(responseTimeMs) && responseTimeMs > 0
        ? Number.isFinite(previousResponseMs) && previousResponseMs > 0
          ? previousResponseMs * 0.8 + responseTimeMs * 0.2
          : responseTimeMs
        : Number.isFinite(previousResponseMs) && previousResponseMs > 0
          ? previousResponseMs
          : null;
    return {
      attempts: attempts + 1,
      bias: clamp(
        (Number(modeState?.bias) || 0) +
          learningRate *
            boundedEvidenceWeight *
            (clamp(outcomeValue, 0, 1) - predictedSuccess),
        -calibrationLimit,
        calibrationLimit,
      ),
      averageResponseMs: nextResponseMs,
      exactCorrect:
        Math.max(0, Math.floor(Number(modeState?.exactCorrect) || 0)) +
        (wasCorrect && !nearMiss ? 1 : 0),
      nearMisses:
        Math.max(0, Math.floor(Number(modeState?.nearMisses) || 0)) +
        (nearMiss ? 1 : 0),
      misses:
        Math.max(0, Math.floor(Number(modeState?.misses) || 0)) +
        (wasCorrect ? 0 : 1),
      possibleGuesses:
        Math.max(0, Math.floor(Number(modeState?.possibleGuesses) || 0)) +
        (possiblyGuessed ? 1 : 0),
    };
  }

  function getRecoveryPlan({
    failedMode,
    predictedSuccess,
    responseTimeMs = null,
    reviewAttempts = 1,
    baseGap = 4,
  }) {
    const typed = String(failedMode).startsWith("typed-");
    const untypedMode = typed
      ? String(failedMode).slice("typed-".length)
      : failedMode;
    const veryLow = predictedSuccess < 0.55;
    const needsScaffold =
      failedMode !== "forward" &&
      (veryLow || (typed && predictedSuccess < 0.78));
    const scaffoldMode = needsScaffold
      ? typed && !veryLow
        ? untypedMode
        : "forward"
      : failedMode;
    const slowTarget = RESPONSE_TIME_TARGET_MS[failedMode] ?? 6500;
    const slowAdjustment =
      Number.isFinite(responseTimeMs) && responseTimeMs > slowTarget * 1.5
        ? -1
        : 0;
    const repeatPenalty = Math.min(2, Math.max(0, reviewAttempts - 1));
    const initialGap = clamp(
      Math.round(
        baseGap *
          (veryLow ? 0.5 : predictedSuccess < 0.78 ? 0.65 : 0.5),
      ) +
        slowAdjustment +
        repeatPenalty,
      2,
      8,
    );
    return {
      originalMode: failedMode,
      nextMode: scaffoldMode,
      requiresOriginalSuccess: scaffoldMode !== failedMode,
      initialGap,
      originalRetryGap: clamp(baseGap + 2 + slowAdjustment, 4, 8),
    };
  }

  function shouldUseVariedContext(snapshot, minimumSuccesses = CONTEXT_VARIATION_MIN_SUCCESSES) {
    const successes = Math.max(0, Number(snapshot?.record?.successes) || 0);
    return successes >= Math.max(1, Number(minimumSuccesses) || 1);
  }

  function getVariedContextIndex(
    snapshot,
    candidateCount,
    minimumSuccesses = CONTEXT_VARIATION_MIN_SUCCESSES,
  ) {
    const count = Math.max(0, Math.floor(Number(candidateCount) || 0));
    if (!count || !shouldUseVariedContext(snapshot, minimumSuccesses)) return -1;
    const successes = Math.max(0, Number(snapshot?.record?.successes) || 0);
    return (successes - minimumSuccesses) % count;
  }

  function getTypedRecallProbability(
    predictedSuccess,
    readiness,
    { isRelearning = false, isChronicallyStruggling = false } = {},
  ) {
    if (!readiness || isRelearning || isChronicallyStruggling) return 0;
    const readinessProgress = clamp(
      (predictedSuccess - readiness.start) /
        (readiness.full - readiness.start),
      0,
      1,
    );
    return readiness.maximum * readinessProgress;
  }

  function buildQuestionPairPlan(
    candidates,
    {
      predict,
      challengeFit = getChallengeFit,
      progressionWeight,
      urgencyWeight,
    },
  ) {
    const plannedCandidates = candidates.map((candidate) => {
      const predictedSuccess = predict(candidate.mode);
      return {
        ...candidate,
        predictedSuccess,
        pairWeight:
          candidate.weight *
          challengeFit(predictedSuccess) *
          progressionWeight(candidate.mode) *
          urgencyWeight(candidate.mode),
      };
    });
    const totalPairWeight = plannedCandidates.reduce(
      (sum, candidate) => sum + candidate.pairWeight,
      0,
    );
    return {
      candidates: plannedCandidates,
      totalPairWeight: totalPairWeight > 0 ? totalPairWeight : 1,
    };
  }

  function getAbilityProximity(distance, sigma) {
    return Math.exp(-(distance * distance) / (2 * sigma * sigma));
  }

  function getUsefulnessWeight(frequencyValue, maximumBoost = 0.7) {
    if (!Number.isFinite(frequencyValue)) return 1;
    return 1 + maximumBoost * clamp(frequencyValue, 0, 1);
  }

  function getMemoryWeight(
    { strength = 0, recallNeed = 0, useRecallNeed = false },
    {
      strengthCeiling = 6,
      strengthExponent = 2,
      recallNeedExponent = 1.5,
      recallNeedFloor = 0.02,
    } = {},
  ) {
    return useRecallNeed
      ? Math.pow(Math.max(recallNeedFloor, recallNeed), recallNeedExponent)
      : Math.pow(strengthCeiling - strength, strengthExponent);
  }

  function getWordWeight({
    memoryWeight,
    abilityWeight = 1,
    usefulnessWeight = 1,
  }) {
    return memoryWeight * abilityWeight * usefulnessWeight;
  }

  function getWeightedIndex(weights, randomValue = Math.random()) {
    if (!Array.isArray(weights) || weights.length === 0) return -1;
    const totalWeight = weights.reduce(
      (sum, weight) => sum + Math.max(0, Number(weight) || 0),
      0,
    );
    if (!(totalWeight > 0)) return weights.length - 1;

    let target = clamp(randomValue, 0, 1) * totalWeight;
    for (let index = 0; index < weights.length; index++) {
      target -= Math.max(0, Number(weights[index]) || 0);
      if (target < 0) return index;
    }
    return weights.length - 1;
  }

  function buildQueues(entries, getQueue) {
    const queues = Object.fromEntries(
      DEFAULT_QUEUE_PRIORITY.map((queue) => [queue, []]),
    );
    for (const entry of entries) {
      const queue = getQueue(entry);
      queues[queue]?.push(entry);
    }
    return queues;
  }

  function getNextQueueName(queues) {
    return DEFAULT_QUEUE_PRIORITY.find(
      (queueName) => queues[queueName]?.length > 0,
    );
  }

  function getCoreCandidatePool(
    entries,
    {
      frequencyDataAvailable,
      hasFrequency,
      getDifficulty,
      ability,
      getProximity,
      minimumProximity,
    },
  ) {
    if (!frequencyDataAvailable || entries.length === 0) return entries;
    const coreEntries = entries.filter(hasFrequency);
    if (coreEntries.length === 0) return entries;
    const suitablyChallenging = coreEntries.filter(
      (entry) =>
        getDifficulty(entry) >= ability ||
        getProximity(entry) >= minimumProximity,
    );
    return suitablyChallenging.length > 0 ? suitablyChallenging : entries;
  }

  function shouldPrioritizeQuota({ share, questionCount, savedCount }) {
    if (!(share > 0)) return false;
    const targetSavedCount = Math.floor((questionCount + 1) * share);
    return savedCount < targetSavedCount;
  }

  window.WordGamePolicy = Object.freeze({
    DEFAULT_MODE_BIASES,
    DEFAULT_MODE_PREREQUISITES,
    DEFAULT_SKILLS,
    RESPONSE_TIME_TARGET_MS,
    CONTEXT_VARIATION_MIN_SUCCESSES,
    DEFAULT_QUEUE_PRIORITY,
    clamp,
    clampProbability,
    getExpectedSuccessProbability,
    getExerciseAdjustedSuccessProbability,
    getAbilityAfterAnswer,
    getQuestionSkill,
    normalizePredictorState,
    getCalibrationEvidenceBias,
    getQuestionComplexityBias,
    predictSuccess,
    getChallengeFit,
    getProgressionWeight,
    getSkillUrgencyWeight,
    updateCalibrationMode,
    getRecoveryPlan,
    shouldUseVariedContext,
    getVariedContextIndex,
    getTypedRecallProbability,
    buildQuestionPairPlan,
    getAbilityProximity,
    getUsefulnessWeight,
    getMemoryWeight,
    getWordWeight,
    getWeightedIndex,
    buildQueues,
    getNextQueueName,
    getCoreCandidatePool,
    shouldPrioritizeQuota,
  });
})();
