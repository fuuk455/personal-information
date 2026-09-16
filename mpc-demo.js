/* Independent educational CHB candidate comparison. No hardware control. */
(function (root) {
  "use strict";

  const VERSION = "1.0.0";
  const TERM_KEYS = ["current", "soc", "temperature", "switching"];
  const model = deepFreeze({
    moduleCount: 3,
    moduleVoltage: 100,
    inductance: 0.005,
    gridResistance: 0.2,
    currentStep: 0.0001,
    slowPreview: 0.01,
    batteryCapacityAh: 5,
    batteryResistance: 0.08,
    thermalResistance: 1.2,
    thermalCapacity: 35,
    ambientTemperature: 25,
    maxTemperature: 90,
    candidateCount: 27
  });
  const defaults = deepFreeze({
    current: 0,
    currentRef: 4,
    gridVoltage: 0,
    soc: [0.82, 0.61, 0.42],
    temperature: [45, 32, 27],
    previousLevels: [1, 0, 0],
    weights: { current: 5, soc: 0, temperature: 0, switching: 0.2 },
    maxCurrent: 25,
    maxBatteryCurrent: 18
  });
  const bounds = deepFreeze({
    current: [-80, 80], currentRef: [-80, 80], gridVoltage: [-400, 400],
    soc: [0, 1], temperature: [-20, 120], weights: [0, 20],
    maxCurrent: [0.1, 80], maxBatteryCurrent: [0.1, 80]
  });
  const ui = deepFreeze({
    scenarioLabel: "固定零点快照：初始电流 0 A，交流侧电压 0 V",
    currentRef: { min: -6, max: 6, step: 0.5, unit: "A" },
    socWeight: { min: 0, max: 6, step: 0.1 },
    temperatureWeight: { min: 0, max: 6, step: 0.1 },
    switchingWeight: { min: 0, max: 2, step: 0.05 },
    fixedCurrentWeight: 5,
    initialPreset: "current"
  });
  const presets = deepFreeze([
    { id: "current", label: "电流跟踪", weights: { current: 5, soc: 0, temperature: 0, switching: 0.2 }, description: "先比较电流预测误差，再兼顾电平变化。" },
    { id: "soc", label: "均衡优先", weights: { current: 5, soc: 4, temperature: 0, switching: 0.2 }, description: "在电流跟踪之外，增加 SOC 均衡的权重。" },
    { id: "temperature", label: "温度优先", weights: { current: 5, soc: 0, temperature: 4, switching: 0.2 }, description: "在电流跟踪之外，增加模块温差的权重。" }
  ]);
  const copyDefaults = () => ({
    ...defaults, soc: [...defaults.soc], temperature: [...defaults.temperature],
    previousLevels: [...defaults.previousLevels], weights: { ...defaults.weights }
  });

  function deepFreeze(object) {
    for (const value of Object.values(object)) {
      if (value && typeof value === "object") deepFreeze(value);
    }
    return Object.freeze(object);
  }
  function number(value, name, range) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TypeError(name + " 必须为有限数值。");
    }
    if (value < range[0] || value > range[1]) {
      throw new RangeError(name + " 超出教学演示范围 [" + range.join(", ") + "]。");
    }
    return value;
  }
  function vector(value, name, range, discrete) {
    if (!Array.isArray(value) || value.length !== 3) {
      throw new TypeError(name + " 必须为含 3 个数值的数组。");
    }
    return value.map((item, index) => {
      number(item, name + "[" + index + "]", range);
      if (discrete && ![-1, 0, 1].includes(item)) {
        throw new RangeError(name + " 只能包含 -1、0、1。");
      }
      return item;
    });
  }
  function parameters(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new TypeError("参数必须是对象。");
    }
    const values = copyDefaults();
    for (const key of ["current", "currentRef", "gridVoltage", "maxCurrent", "maxBatteryCurrent"]) {
      if (input[key] !== undefined) values[key] = number(input[key], key, bounds[key]);
    }
    for (const key of ["soc", "temperature"]) {
      if (input[key] !== undefined) values[key] = vector(input[key], key, bounds[key], false);
    }
    if (input.previousLevels !== undefined) {
      values.previousLevels = vector(input.previousLevels, "previousLevels", [-1, 1], true);
    }
    if (input.weights !== undefined) {
      if (!input.weights || typeof input.weights !== "object" || Array.isArray(input.weights)) {
        throw new TypeError("weights 必须是对象。");
      }
      for (const key of TERM_KEYS) {
        if (input.weights[key] !== undefined) values.weights[key] = number(input.weights[key], "weights." + key, bounds.weights);
      }
    }
    return values;
  }
  function variance(array) {
    const mean = array.reduce((sum, item) => sum + item, 0) / array.length;
    return array.reduce((sum, item) => sum + (item - mean) ** 2, 0) / array.length;
  }
  function enumerate(p) {
    const result = [];
    for (let a = -1; a <= 1; a += 1) {
      for (let b = -1; b <= 1; b += 1) {
        for (let c = -1; c <= 1; c += 1) {
          const levels = [a, b, c];
          const voltage = (a + b + c) * model.moduleVoltage;
          const predictedCurrent = p.current + model.currentStep / model.inductance *
            (voltage - p.gridVoltage - model.gridResistance * p.current);
          const currentError = p.currentRef - predictedCurrent;
          // Hold the average AC current only for a separate, illustrative slow-state preview.
          const averageCurrent = (p.current + predictedCurrent) / 2;
          const batteryCurrents = levels.map(level => level * averageCurrent);
          const predictedSoc = batteryCurrents.map((current, k) => p.soc[k] -
            current * model.slowPreview / (model.batteryCapacityAh * 3600));
          const predictedTemperature = batteryCurrents.map((current, k) => p.temperature[k] +
            model.slowPreview / model.thermalCapacity *
            (current ** 2 * model.batteryResistance -
             (p.temperature[k] - model.ambientTemperature) / model.thermalResistance));
          const switchingDistance = levels.reduce((sum, level, k) => sum + Math.abs(level - p.previousLevels[k]), 0);
          const violations = [];
          if (Math.abs(predictedCurrent) > p.maxCurrent) {
            violations.push({ code: "ac-current", message: "预测交流电流超限", module: null });
          }
          batteryCurrents.forEach((current, k) => {
            if (Math.abs(current) > p.maxBatteryCurrent) violations.push({ code: "battery-current", message: "模块电池电流超限", module: k + 1 });
            if (predictedSoc[k] < 0 || predictedSoc[k] > 1) violations.push({ code: "soc", message: "预测 SOC 超出 0–100%", module: k + 1 });
            if (predictedTemperature[k] > model.maxTemperature) violations.push({ code: "temperature", message: "预测温度超出教学阈值", module: k + 1 });
          });
          result.push({
            id: result.length, key: levels.join(","), levels, voltage,
            predictedCurrent, currentError, batteryCurrents, predictedSoc,
            predictedTemperature, switchingDistance,
            rawCosts: {
              current: currentError ** 2,
              soc: variance(predictedSoc),
              temperature: variance(predictedTemperature),
              switching: switchingDistance
            },
            normalizedCosts: {}, weightedCosts: {}, totalCost: 0,
            feasible: violations.length === 0, violations, selected: false
          });
        }
      }
    }
    return result;
  }
  function evaluate(input = {}) {
    const p = parameters(input);
    const candidates = enumerate(p);
    const normalization = {};
    // Relative normalization exposes the direction of small slow-state changes;
    // this is an explanatory score, not a calibrated physical control objective.
    for (const key of TERM_KEYS) {
      const values = candidates.map(candidate => candidate.rawCosts[key]);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const range = max - min;
      const flat = range <= 1e-12 * Math.max(1, Math.abs(min), Math.abs(max));
      normalization[key] = { min, max, range, flat };
      for (const candidate of candidates) {
        const normalized = flat ? 0 : Math.max(0, Math.min(1, (candidate.rawCosts[key] - min) / range));
        candidate.normalizedCosts[key] = normalized;
        candidate.weightedCosts[key] = normalized * p.weights[key];
        candidate.totalCost += candidate.weightedCosts[key];
      }
    }
    const feasible = candidates.filter(candidate => candidate.feasible);
    // Exact minimum first; deterministic tie break: fewer level changes, then ID.
    const ranked = [...feasible].sort((a, b) =>
      a.totalCost - b.totalCost || a.switchingDistance - b.switchingDistance || a.id - b.id);
    const selected = ranked[0] || null;
    if (selected) selected.selected = true;
    return {
      version: VERSION, status: selected ? "ok" : "no-feasible-candidate",
      parameters: p, model, candidates, selected,
      feasibleCount: feasible.length, rejectedCount: candidates.length - feasible.length,
      rankedIds: ranked.map(candidate => candidate.id), normalization,
      explanation: {
        title: "CHB · 27 个候选如何取舍",
        label: "教学简化演示 · 非实测结果",
        status: selected ? "选择可行候选中相对代价最低的一项。" : "当前参数下无可行候选，请调整参考值、初始状态或电流约束。",
        timing: "电流使用 100 μs 单步预测；SOC 与温度使用独立的 10 ms 恒流预览。",
        score: "每项代价在本轮 27 个候选间归一化后加权；分数只适合比较本轮候选。",
        limitation: "固定直流电压与简化电池/热模型，未模拟开关器件、采样延迟和实际控制器运行。"
      }
    };
  }
  const api = Object.freeze({ version: VERSION, defaults, model, bounds, ui, presets, termKeys: Object.freeze([...TERM_KEYS]), createParams: copyDefaults, evaluate });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.MPCDemo = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
