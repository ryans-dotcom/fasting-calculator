import { useState, useEffect, useCallback, useRef } from "react";

// ─── SCIENCE ENGINE ───────────────────────────────────────────────────────────
function calcBMR(weight, heightCm, age, sex) {
  if (sex === "male") return 10 * weight + 6.25 * heightCm - 5 * age + 5;
  return 10 * weight + 6.25 * heightCm - 5 * age - 161;
}
function calcTDEE(bmr, activity) {
  const f = { sedentary:1.2, light:1.375, moderate:1.55, active:1.725, veryActive:1.9 };
  return bmr * (f[activity] || 1.2);
}
function estimateBodyFat(weight, heightCm, age, sex, build) {
  const bmi = weight / Math.pow(heightCm / 100, 2);
  let bf = sex === "male" ? 1.2*bmi + 0.23*age - 16.2 : 1.2*bmi + 0.23*age - 5.4;
  const adj = { lean:-5, athletic:-3, average:0, stocky:4, obese:10 };
  return Math.max(5, Math.min(60, bf + (adj[build] || 0)));
}

// MET-based calorie burn (Ainsworth MET Compendium 2011)
function calcExtraKcal(weight, walkMins, walkPace, liftMins, liftIntensity, caliMins, caliIntensity) {
  const walkMET = { slow:2.8, moderate:3.5, brisk:4.3, fast:5.0 };
  const liftMET = { light:3.0, moderate:4.5, heavy:6.0 };
  const caliMET = { light:3.5, moderate:5.5, vigorous:8.0 };
  const walkKcal = (walkMET[walkPace]||3.5) * weight * (walkMins/60);
  const liftKcal = (liftMET[liftIntensity]||4.5) * weight * (liftMins/60);
  const caliKcal = (caliMET[caliIntensity]||5.5) * weight * (caliMins/60);
  return { walkKcal, liftKcal, caliKcal, totalExtraKcal: walkKcal+liftKcal+caliKcal };
}

// mTOR protein-sparing: resistance training reduces net muscle protein breakdown ~15-25%
// (Biolo et al. 1995, Phillips et al. 1997)
function calcProteinSparing(liftMins, caliMins) {
  const total = liftMins + caliMins;
  if (total === 0) return 1.0;
  if (total <= 20) return 0.92;
  if (total <= 40) return 0.85;
  return 0.78;
}

function calcDailyLoss(day, weight, bodyFatPct, baseTdee, extraKcal, proteinSparingFactor) {
  const leanMass = weight * (1 - bodyFatPct / 100);
  const totalEnergy = baseTdee + extraKcal;
  let glycogenWater, baseFatFraction, proteinLoss;
  if (day === 1) {
    glycogenWater = 0.9 + (leanMass / 70) * 0.4;
    baseFatFraction = 0.30; proteinLoss = 0.075;
  } else if (day === 2) {
    glycogenWater = 0.25; baseFatFraction = 0.65; proteinLoss = 0.080;
  } else if (day === 3) {
    glycogenWater = 0.05; baseFatFraction = 0.80; proteinLoss = 0.055;
  } else if (day <= 5) {
    glycogenWater = 0.02; baseFatFraction = 0.88; proteinLoss = 0.040;
  } else if (day <= 7) {
    glycogenWater = 0; baseFatFraction = 0.92; proteinLoss = 0.030;
  } else {
    glycogenWater = 0; baseFatFraction = 0.90; proteinLoss = 0.025;
  }
  const fatLoss = (totalEnergy * baseFatFraction) / 9000;
  const bfMod = bodyFatPct < 15 ? 1.35 : bodyFatPct < 20 ? 1.15 : bodyFatPct < 30 ? 1.0 : 0.85;
  const adjProtein = proteinLoss * bfMod * proteinSparingFactor;
  const adjFat = fatLoss * (2 - bfMod);
  return {
    glycogenWater: +glycogenWater.toFixed(3),
    fatLoss: +adjFat.toFixed(3),
    proteinLoss: +adjProtein.toFixed(3),
    total: +(glycogenWater + adjFat + adjProtein).toFixed(3),
  };
}

function runSimulation(params) {
  const { weight, heightCm, age, sex, build, bodyFatOverride, duration,
    activity, walkMins, walkPace, liftMins, liftIntensity,
    caliMins, caliIntensity, isKetoadapted, electrolytes } = params;
  const bf = bodyFatOverride !== null ? bodyFatOverride : estimateBodyFat(weight, heightCm, age, sex, build);
  const bmr = calcBMR(weight, heightCm, age, sex);
  const baseTdee = calcTDEE(bmr, activity) * (electrolytes ? 1.0 : 0.97);
  const { totalExtraKcal, walkKcal, liftKcal, caliKcal } =
    calcExtraKcal(weight, walkMins, walkPace, liftMins, liftIntensity, caliMins, caliIntensity);
  const proteinSparingFactor = calcProteinSparing(liftMins, caliMins);
  const ketoBoost = isKetoadapted ? 0.15 : 0;
  let cumulative = 0, cumulativeFat = 0, cumulativeLean = 0;
  const days = [];
  for (let d = 1; d <= duration; d++) {
    const { glycogenWater, fatLoss, proteinLoss } = calcDailyLoss(
      d, weight - cumulative, bf, baseTdee, totalExtraKcal, proteinSparingFactor
    );
    const adjFat = d === 1 ? fatLoss * (1 + ketoBoost) : fatLoss;
    const dayTotal = glycogenWater + adjFat + proteinLoss;
    cumulative += dayTotal; cumulativeFat += adjFat; cumulativeLean += glycogenWater + proteinLoss;
    days.push({
      day: d, dayLoss: +dayTotal.toFixed(2), cumLoss: +cumulative.toFixed(2),
      fatKg: +adjFat.toFixed(3), proteinKg: +proteinLoss.toFixed(3),
      waterKg: +glycogenWater.toFixed(3), cumFat: +cumulativeFat.toFixed(2),
      cumLean: +cumulativeLean.toFixed(2), weight: +(weight - cumulative).toFixed(1),
      pctFatLost: +((cumulativeFat / (weight * bf / 100)) * 100).toFixed(1),
    });
  }
  return {
    days, bf: +bf.toFixed(1), bmr: +bmr.toFixed(0),
    baseTdee: +baseTdee.toFixed(0), totalTdee: +(baseTdee + totalExtraKcal).toFixed(0),
    walkKcal: +walkKcal.toFixed(0), liftKcal: +liftKcal.toFixed(0), caliKcal: +caliKcal.toFixed(0),
    totalExtraKcal: +totalExtraKcal.toFixed(0), proteinSparingFactor,
    totalLoss: +cumulative.toFixed(2), totalFat: +cumulativeFat.toFixed(2),
    totalLean: +cumulativeLean.toFixed(2), finalWeight: +(weight - cumulative).toFixed(1),
    fatPctOfLoss: +((cumulativeFat / cumulative) * 100).toFixed(0),
  };
}

// ─── UNIT HELPERS ─────────────────────────────────────────────────────────────
// All internal math uses kg. These helpers convert for display only.
function kgToLbs(kg) { return kg * 2.20462; }
// fmt(kg, unit) → { val: string, label: string }
function fmt(kg, unit, decimals = 2) {
  if (unit === "imperial") return { val: kgToLbs(kg).toFixed(decimals), label: "lbs" };
  return { val: Number(kg).toFixed(decimals), label: "kg" };
}
function fmtWeight(kg, unit) {
  if (unit === "imperial") return { val: kgToLbs(kg).toFixed(1), label: "lbs" };
  return { val: Number(kg).toFixed(1), label: "kg" };
}

// ─── TOKENS ───────────────────────────────────────────────────────────────────
const T = {
  bg:"#07080A", surface:"#0D0F12", surface2:"#111318",
  border:"#1C2028", text:"#D8DDE6", muted:"#5A6272", mutedLight:"#7A8599",
  accent:"#00C896", accentDim:"#00C89618", accentBright:"#00FFB8",
  warn:"#F5A623", danger:"#E05252",
  fat:"#F5A623", water:"#52B0D4", protein:"#E05252", lean:"#5B8DEF",
  walk:"#5B8DEF", lift:"#F5A623", cali:"#00C896",
};
const SI = {
  label:{ display:"block", fontSize:10, letterSpacing:"0.12em", textTransform:"uppercase", color:T.muted, marginBottom:6, fontFamily:"monospace" },
  input:{ width:"100%", boxSizing:"border-box", background:T.surface, border:`1px solid ${T.border}`, borderRadius:4, color:T.text, fontSize:16, padding:"10px 11px", fontFamily:"monospace", outline:"none", WebkitAppearance:"none", MozAppearance:"none", transition:"border-color 0.15s", WebkitTapHighlightColor:"transparent" },
  select:{ width:"100%", boxSizing:"border-box", background:T.surface, border:`1px solid ${T.border}`, borderRadius:4, color:T.text, fontSize:16, padding:"10px 32px 10px 11px", fontFamily:"monospace", outline:"none", cursor:"pointer", appearance:"none", WebkitAppearance:"none", MozAppearance:"none", backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%235A6272'/%3E%3C/svg%3E")`, backgroundRepeat:"no-repeat", backgroundPosition:"right 10px center", WebkitTapHighlightColor:"transparent" },
};

// ─── UI COMPONENTS ────────────────────────────────────────────────────────────
function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom:15 }}>
      <label style={SI.label}>{label}</label>
      {children}
      {hint && <div style={{ fontSize:10, color:T.muted, marginTop:4, fontFamily:"monospace", lineHeight:1.5 }}>{hint}</div>}
    </div>
  );
}

function Toggle({ value, onChange, options, small, accentColor }) {
  const ac = accentColor || T.accent;
  return (
    <div style={{ display:"flex", gap:3 }}>
      {options.map(([val, lbl]) => (
        <button key={val} onClick={() => onChange(val)} style={{
          flex:1, padding: small ? "6px 3px" : "9px 6px",
          fontSize: small ? 10 : 11, fontFamily:"monospace",
          background: value===val ? ac+"22" : "transparent",
          border:`1px solid ${value===val ? ac : T.border}`,
          borderRadius:4, color: value===val ? ac : T.muted,
          cursor:"pointer", transition:"all 0.15s", letterSpacing:"0.04em",
        }}>{lbl}</button>
      ))}
    </div>
  );
}

function SectionHead({ children, color }) {
  return <div style={{ fontSize:9, letterSpacing:"0.18em", color:color||T.accent, textTransform:"uppercase", margin:"18px 0 12px", paddingBottom:8, borderBottom:`1px solid ${T.border}`, fontFamily:"monospace" }}>{children}</div>;
}

function StatBox({ label, value, unit, color, sub }) {
  return (
    <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, padding:"15px 16px" }}>
      <div style={{ fontSize:9, letterSpacing:"0.12em", color:T.muted, textTransform:"uppercase", fontFamily:"monospace", marginBottom:5 }}>{label}</div>
      <div style={{ fontSize:24, fontWeight:700, color:color||T.accent, fontFamily:"monospace", lineHeight:1 }}>
        {value}<span style={{ fontSize:12, fontWeight:400, color:T.muted, marginLeft:3 }}>{unit}</span>
      </div>
      {sub && <div style={{ fontSize:10, color:T.muted, marginTop:4, fontFamily:"monospace" }}>{sub}</div>}
    </div>
  );
}

function SliderWithTicks({ value, onChange, min, max, step, ticks, color }) {
  return (
    <div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseInt(e.target.value))}
        style={{ width:"100%", accentColor:color||T.accent, cursor:"pointer" }} />
      <div style={{ display:"flex", justifyContent:"space-between", marginTop:3 }}>
        {ticks.map(v => (
          <span key={v} onClick={() => onChange(v)}
            style={{ fontSize:9, color:value===v?(color||T.accent):T.muted, cursor:"pointer", fontFamily:"monospace" }}>{v}m</span>
        ))}
      </div>
    </div>
  );
}

function ExerciseBadge({ mins, color, label }) {
  if (mins === 0) return null;
  return (
    <span style={{ display:"inline-block", padding:"2px 8px", borderRadius:3, background:color+"22", border:`1px solid ${color}44`, color:color, fontSize:10, fontFamily:"monospace", marginRight:4 }}>
      {label} {mins}m
    </span>
  );
}

// Stacked bar chart — fat / protein / water per day
function StackedBarChart({ days }) {
  const maxLoss = Math.max(...days.map(d => d.dayLoss));
  return (
    <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, padding:"18px 18px 12px" }}>
      <div style={{ fontSize:9, letterSpacing:"0.14em", color:T.muted, textTransform:"uppercase", fontFamily:"monospace", marginBottom:14 }}>Daily Loss by Component (kg)</div>
      <div style={{ display:"flex", alignItems:"flex-end", gap:3, height:90 }}>
        {days.map(d => {
          const h = (d.dayLoss / maxLoss) * 84;
          const fatH = (d.fatKg / d.dayLoss) * h;
          const proH = (d.proteinKg / d.dayLoss) * h;
          const watH = Math.max(0, h - fatH - proH);
          return (
            <div key={d.day} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center" }}
              title={`Day ${d.day}: ${d.dayLoss}kg — Fat:${d.fatKg} Protein:${d.proteinKg} Water:${d.waterKg}`}>
              <div style={{ width:"100%", display:"flex", flexDirection:"column-reverse", height:h }}>
                <div style={{ background:T.water, height:watH, borderRadius:"2px 2px 0 0" }} />
                <div style={{ background:T.protein, height:proH }} />
                <div style={{ background:T.fat, height:fatH }} />
              </div>
              <div style={{ fontSize:9, color:T.muted, marginTop:4, fontFamily:"monospace" }}>{d.day}</div>
            </div>
          );
        })}
      </div>
      <div style={{ display:"flex", gap:14, marginTop:10, flexWrap:"wrap" }}>
        {[[T.fat,"Fat"],[T.protein,"Protein"],[T.water,"Water/Glycogen"]].map(([c,l]) => (
          <div key={l} style={{ display:"flex", alignItems:"center", gap:5 }}>
            <div style={{ width:8, height:8, borderRadius:2, background:c }} />
            <span style={{ fontSize:9, color:T.muted, fontFamily:"monospace", textTransform:"uppercase", letterSpacing:"0.08em" }}>{l}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function WeightLine({ days, startWeight, unit }) {
  const all = [startWeight, ...days.map(d => d.weight)];
  const minW = Math.min(...all) - 0.3, maxW = Math.max(...all) + 0.3;
  const W=100, H=55;
  const pts = all.map((w,i) => `${(i/(all.length-1))*W},${H-((w-minW)/(maxW-minW))*H}`);
  const startFmt = fmtWeight(startWeight, unit);
  const endFmt = fmtWeight(days[days.length-1]?.weight || startWeight, unit);
  return (
    <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, padding:"16px 18px 14px" }}>
      <div style={{ fontSize:9, letterSpacing:"0.14em", color:T.muted, textTransform:"uppercase", fontFamily:"monospace", marginBottom:10 }}>Projected Weight Curve ({unit==="imperial"?"lbs":"kg"})</div>
      <svg viewBox="0 0 100 55" style={{ width:"100%", height:75, overflow:"visible" }}>
        <polyline points={pts.join(" ")} fill="none" stroke={T.accent} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        {all.map((w,i) => { const x=(i/(all.length-1))*W; const y=H-((w-minW)/(maxW-minW))*H; return <circle key={i} cx={x} cy={y} r="1.3" fill={T.accent} />; })}
      </svg>
      <div style={{ display:"flex", justifyContent:"space-between" }}>
        <span style={{ fontSize:10, color:T.muted, fontFamily:"monospace" }}>Start: {startFmt.val} {startFmt.label}</span>
        <span style={{ fontSize:10, color:T.accentBright, fontFamily:"monospace" }}>End: {endFmt.val} {endFmt.label}</span>
      </div>
    </div>
  );
}

function ExerciseBreakdown({ result }) {
  const { walkKcal, liftKcal, caliKcal, totalExtraKcal, baseTdee } = result;
  const total = baseTdee + totalExtraKcal;
  const bars = [
    { label:"Base TDEE", kcal:baseTdee, color:T.muted },
    { label:"Walking", kcal:walkKcal, color:T.walk },
    { label:"Lifting", kcal:liftKcal, color:T.lift },
    { label:"Calisthenics", kcal:caliKcal, color:T.cali },
  ].filter(b => b.kcal > 0);
  return (
    <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, padding:"14px 16px" }}>
      <div style={{ fontSize:9, letterSpacing:"0.14em", color:T.muted, textTransform:"uppercase", fontFamily:"monospace", marginBottom:10 }}>Daily Caloric Deficit Breakdown</div>
      <div style={{ display:"flex", height:10, borderRadius:4, overflow:"hidden", gap:1, marginBottom:12 }}>
        {bars.map(b => <div key={b.label} style={{ flex:b.kcal, background:b.color, minWidth:b.kcal>0?2:0 }} />)}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(110px,1fr))", gap:10 }}>
        {bars.map(b => (
          <div key={b.label} style={{ display:"flex", alignItems:"center", gap:7 }}>
            <div style={{ width:8, height:8, borderRadius:2, background:b.color, flexShrink:0 }} />
            <div>
              <div style={{ fontSize:9, color:T.mutedLight, fontFamily:"monospace" }}>{b.label}</div>
              <div style={{ fontSize:13, color:T.text, fontFamily:"monospace", fontWeight:600 }}>{b.kcal} kcal</div>
              <div style={{ fontSize:9, color:T.muted, fontFamily:"monospace" }}>{((b.kcal/total)*100).toFixed(0)}%</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop:12, paddingTop:10, borderTop:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span style={{ fontSize:10, color:T.muted, fontFamily:"monospace", textTransform:"uppercase", letterSpacing:"0.1em" }}>Total daily deficit</span>
        <span style={{ fontSize:18, color:T.accent, fontFamily:"monospace", fontWeight:700 }}>{total.toFixed(0)} kcal</span>
      </div>
      {result.proteinSparingFactor < 1.0 && (
        <div style={{ marginTop:10, padding:"8px 10px", background:T.accentDim, borderRadius:4, fontSize:10, color:T.accentBright, fontFamily:"monospace" }}>
          ✓ Resistance training: protein breakdown ↓{((1-result.proteinSparingFactor)*100).toFixed(0)}% vs rest (mTOR signal)
        </div>
      )}
    </div>
  );
}

// ── COMPARISON CHARTS ─────────────────────────────────────────────────────────
function WalkingComparisonChart({ baseParams, duration, unit }) {
  const scenarios = [
    { label:"No walk", mins:0, pace:"moderate" },
    { label:"30m slow", mins:30, pace:"slow" },
    { label:"30m brisk", mins:30, pace:"brisk" },
    { label:"60m moderate", mins:60, pace:"moderate" },
    { label:"60m brisk", mins:60, pace:"brisk" },
    { label:"90m brisk", mins:90, pace:"brisk" },
    { label:"120m brisk", mins:120, pace:"brisk" },
    { label:"120m fast", mins:120, pace:"fast" },
    { label:"180m brisk", mins:180, pace:"brisk" },
  ].map(s => {
    const r = runSimulation({ ...baseParams, walkMins:s.mins, walkPace:s.pace, liftMins:0, caliMins:0, duration });
    return { ...s, totalFat:r.totalFat, totalLoss:r.totalLoss, extraKcal:r.walkKcal };
  });
  const maxFat = Math.max(...scenarios.map(s => s.totalFat));
  const baseline = scenarios[0].totalFat;
  const ul = unit==="imperial" ? "lbs" : "kg";
  const cv = kg => unit==="imperial" ? kgToLbs(kg).toFixed(1) : Number(kg).toFixed(2);

  return (
    <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, padding:"18px 18px 14px" }}>
      <div style={{ fontSize:9, letterSpacing:"0.14em", color:T.muted, textTransform:"uppercase", fontFamily:"monospace", marginBottom:4 }}>Walking Duration & Pace — Fat Loss Impact</div>
      <div style={{ fontSize:10, color:T.muted, fontFamily:"monospace", marginBottom:16 }}>No other exercise. Colored bar = fat lost. Grey extension = water/glycogen.</div>
      {scenarios.map(s => {
        const fatW = (s.totalFat / maxFat) * 100;
        const totalW = (s.totalLoss / Math.max(...scenarios.map(x=>x.totalLoss))) * 100;
        const gain = unit==="imperial" ? kgToLbs(s.totalFat - baseline).toFixed(1) : (s.totalFat - baseline).toFixed(2);
        return (
          <div key={s.label} style={{ marginBottom:9 }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3, flexWrap:"wrap", gap:4 }}>
              <span style={{ fontSize:10, color:T.text, fontFamily:"monospace", minWidth:130 }}>{s.label}</span>
              <div style={{ display:"flex", gap:14 }}>
                <span style={{ fontSize:10, color:T.walk, fontFamily:"monospace", fontWeight:600 }}>−{cv(s.totalFat)}{ul} fat</span>
                <span style={{ fontSize:10, color:T.muted, fontFamily:"monospace" }}>−{cv(s.totalLoss)}{ul} scale</span>
                {parseFloat(gain) > 0 && <span style={{ fontSize:10, color:T.accentBright, fontFamily:"monospace" }}>+{gain}{ul} vs rest</span>}
              </div>
            </div>
            <div style={{ position:"relative", height:10, background:T.bg, borderRadius:3, overflow:"hidden" }}>
              <div style={{ position:"absolute", left:0, top:0, width:`${totalW}%`, height:"100%", background:T.border, borderRadius:3 }} />
              <div style={{ position:"absolute", left:0, top:0, width:`${fatW}%`, height:"100%", background:T.walk, borderRadius:3 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ResistanceComparisonChart({ baseParams, duration, unit }) {
  const ul = unit==="imperial" ? "lbs" : "kg";
  const cv = kg => unit==="imperial" ? kgToLbs(kg).toFixed(1) : Number(kg).toFixed(2);
  const scenarios = [
    { label:"No resistance", lift:0, li:"moderate", cali:0, ci:"moderate" },
    { label:"Lifting 20m light", lift:20, li:"light", cali:0, ci:"moderate" },
    { label:"Lifting 30m moderate", lift:30, li:"moderate", cali:0, ci:"moderate" },
    { label:"Lifting 45m moderate", lift:45, li:"moderate", cali:0, ci:"moderate" },
    { label:"Lifting 60m heavy", lift:60, li:"heavy", cali:0, ci:"moderate" },
    { label:"Cali 20m moderate", lift:0, li:"moderate", cali:20, ci:"moderate" },
    { label:"Cali 45m moderate", lift:0, li:"moderate", cali:45, ci:"moderate" },
    { label:"Cali 45m vigorous", lift:0, li:"moderate", cali:45, ci:"vigorous" },
    { label:"Lift 30m + Cali 30m", lift:30, li:"moderate", cali:30, ci:"moderate" },
    { label:"Lift 45m + Cali 45m", lift:45, li:"moderate", cali:45, ci:"vigorous" },
  ].map(s => {
    const r = runSimulation({ ...baseParams, walkMins:0, liftMins:s.lift, liftIntensity:s.li, caliMins:s.cali, caliIntensity:s.ci, duration });
    const ps = calcProteinSparing(s.lift, s.cali);
    return { ...s, totalFat:r.totalFat, totalLoss:r.totalLoss, proteinLost: r.days.reduce((a,d)=>a+d.proteinKg,0), proteinSparing:((1-ps)*100).toFixed(0) };
  });
  const maxFat = Math.max(...scenarios.map(s => s.totalFat));
  const maxProt = Math.max(...scenarios.map(s => s.proteinLost));

  return (
    <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, padding:"18px 18px 14px" }}>
      <div style={{ fontSize:9, letterSpacing:"0.14em", color:T.muted, textTransform:"uppercase", fontFamily:"monospace", marginBottom:4 }}>Weightlifting vs Calisthenics — Fat Loss + Muscle Preservation</div>
      <div style={{ fontSize:10, color:T.muted, fontFamily:"monospace", marginBottom:16 }}>No walking. Orange = fat lost. Red bar (protein) shows how much muscle protein was catabolized — shorter is better.</div>
      {scenarios.map(s => {
        const col = s.lift>0&&s.cali>0 ? "#C84B7A" : s.lift>0 ? T.lift : s.cali>0 ? T.cali : T.muted;
        const fatW = (s.totalFat / maxFat) * 100;
        const protW = (s.proteinLost / maxProt) * 100;
        return (
          <div key={s.label} style={{ marginBottom:10 }}>
            <div style={{ display:"flex", justifyContent:"space-between", flexWrap:"wrap", gap:4, marginBottom:3 }}>
              <span style={{ fontSize:10, color:T.text, fontFamily:"monospace", minWidth:170 }}>{s.label}</span>
              <div style={{ display:"flex", gap:12 }}>
                <span style={{ fontSize:10, color:col, fontFamily:"monospace", fontWeight:600 }}>−{cv(s.totalFat)}{ul} fat</span>
                <span style={{ fontSize:10, color:T.protein, fontFamily:"monospace" }}>−{cv(s.proteinLost)}{ul} protein</span>
                {parseInt(s.proteinSparing) > 0 && <span style={{ fontSize:10, color:T.accentBright, fontFamily:"monospace" }}>↓{s.proteinSparing}% breakdown</span>}
              </div>
            </div>
            <div style={{ display:"flex", gap:3 }}>
              <div style={{ flex:3, position:"relative", height:8, background:T.bg, borderRadius:3, overflow:"hidden" }}>
                <div style={{ position:"absolute", left:0, top:0, width:`${fatW}%`, height:"100%", background:col, borderRadius:3 }} />
              </div>
              <div style={{ flex:1, position:"relative", height:8, background:T.bg, borderRadius:3, overflow:"hidden" }}>
                <div style={{ position:"absolute", left:0, top:0, width:`${protW}%`, height:"100%", background:T.protein, borderRadius:3 }} />
              </div>
            </div>
            <div style={{ display:"flex", gap:3, marginTop:2 }}>
              <div style={{ flex:3, fontSize:8, color:T.muted, fontFamily:"monospace" }}>fat lost →</div>
              <div style={{ flex:1, fontSize:8, color:T.muted, fontFamily:"monospace" }}>protein lost →</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CombinedComparisonChart({ baseParams, duration, unit }) {
  const ul = unit==="imperial" ? "lbs" : "kg";
  const cv = kg => unit==="imperial" ? kgToLbs(kg).toFixed(1) : Number(kg).toFixed(2);
  const scenarios = [
    { label:"Rest only", w:0, wp:"moderate", l:0, li:"moderate", c:0, ci:"moderate" },
    { label:"60m walk only", w:60, wp:"brisk", l:0, li:"moderate", c:0, ci:"moderate" },
    { label:"120m walk only", w:120, wp:"brisk", l:0, li:"moderate", c:0, ci:"moderate" },
    { label:"Lift 45m only", w:0, wp:"moderate", l:45, li:"moderate", c:0, ci:"moderate" },
    { label:"Cali 45m only", w:0, wp:"moderate", l:0, li:"moderate", c:45, ci:"moderate" },
    { label:"Walk 60m + Lift 30m", w:60, wp:"brisk", l:30, li:"moderate", c:0, ci:"moderate" },
    { label:"Walk 60m + Cali 30m", w:60, wp:"brisk", l:0, li:"moderate", c:30, ci:"moderate" },
    { label:"Walk 90m + Lift 45m", w:90, wp:"brisk", l:45, li:"moderate", c:0, ci:"moderate" },
    { label:"Walk 120m + Lift 45m", w:120, wp:"brisk", l:45, li:"moderate", c:0, ci:"moderate" },
    { label:"Walk 120m + Cali 45m", w:120, wp:"brisk", l:0, li:"moderate", c:45, ci:"vigorous" },
    { label:"Walk 120m + Lift + Cali", w:120, wp:"brisk", l:30, li:"moderate", c:30, ci:"moderate" },
  ].map(s => {
    const r = runSimulation({ ...baseParams, walkMins:s.w, walkPace:s.wp, liftMins:s.l, liftIntensity:s.li, caliMins:s.c, caliIntensity:s.ci, duration });
    const ps = calcProteinSparing(s.l, s.c);
    return { ...s, totalFat:r.totalFat, totalLoss:r.totalLoss, proteinSparing:((1-ps)*100).toFixed(0), totalMins:s.w+s.l+s.c };
  });
  const baseline = scenarios[0].totalFat;
  const maxFat = Math.max(...scenarios.map(s => s.totalFat));

  return (
    <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, padding:"18px 18px 14px" }}>
      <div style={{ fontSize:9, letterSpacing:"0.14em", color:T.muted, textTransform:"uppercase", fontFamily:"monospace", marginBottom:4 }}>Combined Exercise Scenarios — Best of Both Worlds</div>
      <div style={{ fontSize:10, color:T.muted, fontFamily:"monospace", marginBottom:16 }}>Comparing walking + resistance combinations. Shows extra fat vs rest-only baseline.</div>
      {scenarios.map(s => {
        const hasResistance = s.l > 0 || s.c > 0;
        const hasWalk = s.w > 0;
        const col = hasResistance && hasWalk ? "#C84B7A" : hasWalk ? T.walk : hasResistance ? T.lift : T.muted;
        const fatW = (s.totalFat / maxFat) * 100;
        const extra = (s.totalFat - baseline).toFixed(2);
        return (
          <div key={s.label} style={{ marginBottom:9 }}>
            <div style={{ display:"flex", justifyContent:"space-between", flexWrap:"wrap", gap:4, marginBottom:3 }}>
              <div>
                <span style={{ fontSize:10, color:T.text, fontFamily:"monospace" }}>{s.label}</span>
                {parseInt(s.proteinSparing) > 0 && <span style={{ fontSize:9, color:T.accentBright, fontFamily:"monospace", marginLeft:8 }}>↓{s.proteinSparing}% protein breakdown</span>}
              </div>
              <div style={{ display:"flex", gap:12 }}>
                <span style={{ fontSize:10, color:col, fontFamily:"monospace", fontWeight:600 }}>−{cv(s.totalFat)}{ul} fat</span>
                {parseFloat(extra) > 0 && <span style={{ fontSize:10, color:T.accentBright, fontFamily:"monospace" }}>+{cv(s.totalFat - baseline)}{ul} vs rest</span>}
              </div>
            </div>
            <div style={{ position:"relative", height:10, background:T.bg, borderRadius:3, overflow:"hidden" }}>
              <div style={{ position:"absolute", left:0, top:0, width:`${fatW}%`, height:"100%", background:col, borderRadius:3 }} />
            </div>
          </div>
        );
      })}
      <div style={{ display:"flex", gap:14, marginTop:14, flexWrap:"wrap" }}>
        {[[T.walk,"Walk only"],[T.lift,"Lift only"],["#C84B7A","Walk + Resistance"],[T.muted,"Rest"]].map(([c,l]) => (
          <div key={l} style={{ display:"flex", alignItems:"center", gap:5 }}>
            <div style={{ width:8, height:8, borderRadius:2, background:c }} />
            <span style={{ fontSize:9, color:T.muted, fontFamily:"monospace" }}>{l}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DayTable({ days, unit }) {
  const u = unit === "imperial" ? "lbs" : "kg";
  const cv = (kg, dec=2) => unit === "imperial" ? kgToLbs(kg).toFixed(dec) : Number(kg).toFixed(dec);
  const cvW = (kg) => unit === "imperial" ? kgToLbs(kg).toFixed(1) : Number(kg).toFixed(1);
  return (
    <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, overflow:"hidden" }}>
      <div style={{ padding:"12px 16px 10px", borderBottom:`1px solid ${T.border}` }}>
        <span style={{ fontSize:9, letterSpacing:"0.14em", color:T.muted, textTransform:"uppercase", fontFamily:"monospace" }}>Day-by-Day Breakdown ({u})</span>
      </div>
      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11, fontFamily:"monospace" }}>
          <thead>
            <tr style={{ borderBottom:`1px solid ${T.border}` }}>
              {["Day",`Weight (${u})`,`Day Loss`,`Cumulative`,`Fat`,`Protein`,`Water`,`% BF Lost`].map(h => (
                <th key={h} style={{ padding:"7px 12px", textAlign:"right", color:T.muted, fontWeight:400, fontSize:9, letterSpacing:"0.1em", textTransform:"uppercase", whiteSpace:"nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((d,i) => (
              <tr key={d.day} style={{ borderBottom:`1px solid ${T.border}22`, background:i%2?"#00000022":"transparent" }}>
                <td style={{ padding:"8px 12px", textAlign:"right", color:T.accent }}>{d.day}</td>
                <td style={{ padding:"8px 12px", textAlign:"right", color:T.text }}>{cvW(d.weight)}</td>
                <td style={{ padding:"8px 12px", textAlign:"right", color:T.warn }}>−{cv(d.dayLoss)}</td>
                <td style={{ padding:"8px 12px", textAlign:"right", color:T.accentBright }}>−{cv(d.cumLoss)}</td>
                <td style={{ padding:"8px 12px", textAlign:"right", color:T.fat }}>{cv(d.fatKg,3)}</td>
                <td style={{ padding:"8px 12px", textAlign:"right", color:T.protein }}>{cv(d.proteinKg,3)}</td>
                <td style={{ padding:"8px 12px", textAlign:"right", color:T.water }}>{cv(d.waterKg,3)}</td>
                <td style={{ padding:"8px 12px", textAlign:"right", color:T.muted }}>{d.pctFatLost}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── RESPONSIVE HOOK ─────────────────────────────────────────────────────────
function useBreakpoint() {
  const [bp, setBp] = useState(() => {
    if (typeof window === "undefined") return "desktop";
    const w = window.innerWidth;
    return w < 640 ? "mobile" : w < 960 ? "tablet" : "desktop";
  });
  useEffect(() => {
    const check = () => {
      const w = window.innerWidth;
      setBp(w < 640 ? "mobile" : w < 960 ? "tablet" : "desktop");
    };
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return bp;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function FastingCalc() {
  const [unit, setUnit] = useState("metric");
  const [weight, setWeight] = useState(80);
  const [heightCm, setHeightCm] = useState(178);
  const [heightFt, setHeightFt] = useState(5);
  const [heightIn, setHeightIn] = useState(10);
  const [weightLbs, setWeightLbs] = useState(176);
  const [age, setAge] = useState(32);
  const [sex, setSex] = useState("male");
  const [build, setBuild] = useState("average");
  const [bfOverride, setBfOverride] = useState("");
  const [duration, setDuration] = useState(3);
  const [activity, setActivity] = useState("light");
  const [walkMins, setWalkMins] = useState(30);
  const [walkPace, setWalkPace] = useState("moderate");
  const [liftMins, setLiftMins] = useState(0);
  const [liftIntensity, setLiftIntensity] = useState("moderate");
  const [caliMins, setCaliMins] = useState(0);
  const [caliIntensity, setCaliIntensity] = useState("moderate");
  const [isKetoadapted, setIsKetoadapted] = useState(false);
  const [electrolytes, setElectrolytes] = useState(true);
  const [activeTab, setActiveTab] = useState("results");
  const [result, setResult] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const bp = useBreakpoint();
  const isMobile = bp === "mobile";
  const isTablet = bp === "tablet";
  const sidebarWidth = isTablet ? 260 : 296;

  const getWeightKg = useCallback(() => unit==="metric" ? weight : weightLbs*0.453592, [unit,weight,weightLbs]);
  const getHeightCm = useCallback(() => unit==="metric" ? heightCm : heightFt*30.48+heightIn*2.54, [unit,heightCm,heightFt,heightIn]);

  const getBaseParams = useCallback(() => ({
    weight:getWeightKg(), heightCm:getHeightCm(), age, sex, build,
    bodyFatOverride: bfOverride!=="" ? parseFloat(bfOverride) : null,
    activity, walkMins, walkPace, liftMins, liftIntensity,
    caliMins, caliIntensity, isKetoadapted, electrolytes,
  }), [getWeightKg,getHeightCm,age,sex,build,bfOverride,activity,walkMins,walkPace,liftMins,liftIntensity,caliMins,caliIntensity,isKetoadapted,electrolytes]);

  useEffect(() => {
    const p = getBaseParams();
    if (p.weight<30||p.heightCm<100) return;
    setResult(runSimulation({...p, duration}));
  }, [getBaseParams, duration]);

  // Close sidebar when switching to desktop
  useEffect(() => { if (!isMobile && !isTablet) setSidebarOpen(false); }, [isMobile, isTablet]);

  const onF = e => e.target.style.borderColor = T.accent;
  const onB = e => e.target.style.borderColor = T.border;
  const numI = (val,set,min,max) => (
    <input type="number" value={val} min={min} max={max} style={SI.input} inputMode="decimal"
      onFocus={onF} onBlur={onB} onChange={e=>set(parseFloat(e.target.value)||0)} />
  );

  const totalExMins = walkMins + liftMins + caliMins;

  const tabs = [
    ["results","Results"],
    ["walk-compare","Walking"],
    ["lift-compare","Lifting / Cali"],
    ["combined","Combined"],
    ["table","Day Table"],
  ];

  // Inline JSX — defined as variables not components to prevent focus loss on re-render
  const sidebarJsx = (

    <div style={{ padding:"16px 14px 40px" }}>
      <SectionHead>Body Metrics</SectionHead>
      {unit==="metric" ? (<>
        <Field label="Weight (kg)">{numI(weight,setWeight,30,300)}</Field>
        <Field label="Height (cm)">{numI(heightCm,setHeightCm,100,250)}</Field>
      </>) : (<>
        <Field label="Weight (lbs)">{numI(weightLbs,setWeightLbs,66,660)}</Field>
        <Field label="Height">
          <div style={{ display:"flex", gap:6 }}>
            <input type="number" value={heightFt} min={3} max={8} style={SI.input} inputMode="decimal" placeholder="ft" onFocus={onF} onBlur={onB} onChange={e=>setHeightFt(parseFloat(e.target.value)||0)} />
            <input type="number" value={heightIn} min={0} max={11} style={SI.input} inputMode="decimal" placeholder="in" onFocus={onF} onBlur={onB} onChange={e=>setHeightIn(parseFloat(e.target.value)||0)} />
          </div>
        </Field>
      </>)}
      <Field label="Age">{numI(age,setAge,16,90)}</Field>
      <Field label="Sex"><Toggle value={sex} onChange={setSex} options={[["male","Male"],["female","Female"]]} /></Field>
      <Field label="Body Composition">
        <select value={build} onChange={e=>setBuild(e.target.value)} style={SI.select}>
          <option value="lean">Lean (low BF%)</option>
          <option value="athletic">Athletic</option>
          <option value="average">Average</option>
          <option value="stocky">Stocky / High BF</option>
          <option value="obese">Obese</option>
        </select>
      </Field>
      <Field label="Body Fat % Override" hint="Leave blank to auto-estimate">
        <input type="number" value={bfOverride} min={5} max={60} style={SI.input} inputMode="decimal" placeholder="Auto"
          onFocus={onF} onBlur={onB} onChange={e=>setBfOverride(e.target.value)} />
      </Field>

      <SectionHead>Fast Settings</SectionHead>
      <Field label={`Duration: ${duration} day${duration>1?"s":""}`}>
        <input type="range" min={1} max={14} value={duration}
          onChange={e=>setDuration(parseInt(e.target.value))}
          style={{ width:"100%", accentColor:T.accent, cursor:"pointer", WebkitAppearance:"auto" }} />
        <div style={{ display:"flex", justifyContent:"space-between", marginTop:3 }}>
          {[1,3,5,7,10,14].map(v=>(
            <span key={v} onClick={()=>setDuration(v)}
              style={{ fontSize:9, color:duration===v?T.accentBright:T.muted, cursor:"pointer" }}>{v}d</span>
          ))}
        </div>
      </Field>
      <Field label="Baseline Activity">
        <select value={activity} onChange={e=>setActivity(e.target.value)} style={SI.select}>
          <option value="sedentary">Sedentary</option>
          <option value="light">Light active</option>
          <option value="moderate">Moderately active</option>
          <option value="active">Active</option>
          <option value="veryActive">Very active</option>
        </select>
      </Field>

      <SectionHead color={T.walk}>🚶 Walking</SectionHead>
      <Field label={`Walk time: ${walkMins} min/day`}>
        <SliderWithTicks value={walkMins} onChange={setWalkMins} min={0} max={180} step={5}
          ticks={[0,30,60,90,120,180]} color={T.walk} />
      </Field>
      {walkMins > 0 && (
        <Field label="Pace">
          <Toggle value={walkPace} onChange={setWalkPace} small accentColor={T.walk}
            options={[["slow","Slow"],["moderate","Mod"],["brisk","Brisk"],["fast","Fast"]]} />
        </Field>
      )}

      <SectionHead color={T.lift}>🏋️ Weightlifting</SectionHead>
      <Field label={`Lifting: ${liftMins} min/day`}>
        <SliderWithTicks value={liftMins} onChange={setLiftMins} min={0} max={90} step={5}
          ticks={[0,20,30,45,60,90]} color={T.lift} />
      </Field>
      {liftMins > 0 && (
        <Field label="Intensity">
          <Toggle value={liftIntensity} onChange={setLiftIntensity} small accentColor={T.lift}
            options={[["light","Light"],["moderate","Mod"],["heavy","Heavy"]]} />
        </Field>
      )}

      <SectionHead color={T.cali}>🤸 Calisthenics</SectionHead>
      <Field label={`Calisthenics: ${caliMins} min/day`} hint="Push-ups, pull-ups, dips, squats">
        <SliderWithTicks value={caliMins} onChange={setCaliMins} min={0} max={90} step={5}
          ticks={[0,20,30,45,60,90]} color={T.cali} />
      </Field>
      {caliMins > 0 && (
        <Field label="Intensity">
          <Toggle value={caliIntensity} onChange={setCaliIntensity} small accentColor={T.cali}
            options={[["light","Light"],["moderate","Mod"],["vigorous","Vig"]]} />
        </Field>
      )}

      <SectionHead>Modifiers</SectionHead>
      <Field label="Keto-Adapted?" hint="Enters ketosis ~12–18h earlier">
        <Toggle value={isKetoadapted?"yes":"no"} onChange={v=>setIsKetoadapted(v==="yes")}
          options={[["no","No"],["yes","Yes"]]} />
      </Field>
      <Field label="Electrolytes?">
        <Toggle value={electrolytes?"yes":"no"} onChange={v=>setElectrolytes(v==="yes")}
          options={[["no","No"],["yes","Yes"]]} />
      </Field>

      <div style={{ marginTop:20, padding:"9px 12px", background:"#0D0600", border:`1px solid #2A1500`, borderRadius:6, fontSize:9, color:"#6A4E2A", lineHeight:1.7 }}>
        ⚠ Estimates only — ±20–30% individual variation. Consult a physician before fasting beyond 24h.
      </div>
    </div>
  
  );

  const resultsJsx = result ? (

    <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:10 }}>
        <StatBox label="Total Scale Loss" value={`−${fmt(result.totalLoss,unit).val}`} unit={fmt(result.totalLoss,unit).label} sub={`over ${duration} days`} />
        <StatBox label="Final Weight" value={fmtWeight(result.finalWeight,unit).val} unit={fmtWeight(result.finalWeight,unit).label} color={T.text} />
        <StatBox label="True Fat Lost" value={fmt(result.totalFat,unit).val} unit={fmt(result.totalFat,unit).label} color={T.fat} sub={`${result.fatPctOfLoss}% of scale loss`} />
        <StatBox label="Water + Glycogen" value={fmt(result.totalLean,unit).val} unit={fmt(result.totalLean,unit).label} color={T.water} sub="Returns within 48h of refeeding" />
      </div>

      <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, padding:"13px 15px" }}>
        <div style={{ fontSize:9, letterSpacing:"0.14em", color:T.muted, textTransform:"uppercase", marginBottom:10 }}>Metabolic Profile</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:10 }}>
          {[["BMR",`${result.bmr} kcal`,"basal"],["Base TDEE",`${result.baseTdee} kcal`,"activity adj."],["Exercise +",`+${result.totalExtraKcal} kcal`,"per day"],["Body Fat",`${result.bf}%`,bfOverride?"manual":"estimated"]].map(([l,v,s])=>(
            <div key={l}>
              <div style={{ fontSize:9, color:T.muted, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:2 }}>{l}</div>
              <div style={{ fontSize:14, color:T.text, fontWeight:600 }}>{v}</div>
              <div style={{ fontSize:9, color:T.muted, marginTop:2 }}>{s}</div>
            </div>
          ))}
        </div>
      </div>

      <ExerciseBreakdown result={result} />
      <WeightLine days={result.days} startWeight={getWeightKg()} unit={unit} />
      <StackedBarChart days={result.days} />

      <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, padding:"14px 16px" }}>
        <div style={{ fontSize:9, letterSpacing:"0.14em", color:T.muted, textTransform:"uppercase", marginBottom:10 }}>Loss Composition</div>
        <div style={{ display:"flex", height:14, borderRadius:4, overflow:"hidden", marginBottom:10 }}>
          <div style={{ flex:result.totalFat, background:T.fat }} />
          <div style={{ flex:result.totalLean, background:T.water }} />
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
          <div style={{ fontSize:11, color:T.fat }}>■ Fat: {fmt(result.totalFat,unit).val}{fmt(result.totalFat,unit).label} ({result.fatPctOfLoss}%)<div style={{ fontSize:9, color:T.muted, marginTop:2 }}>Permanent if refeeding done right</div></div>
          <div style={{ fontSize:11, color:T.water, textAlign:"right" }}>■ Water/Glycogen: {fmt(result.totalLean,unit).val}{fmt(result.totalLean,unit).label} ({100-result.fatPctOfLoss}%)<div style={{ fontSize:9, color:T.muted, marginTop:2 }}>Returns on refeeding</div></div>
        </div>
      </div>

      <div style={{ background:"#080D12", border:`1px solid #0E1E2A`, borderRadius:6, padding:"13px 15px" }}>
        <div style={{ fontSize:9, letterSpacing:"0.14em", color:T.lean, textTransform:"uppercase", marginBottom:9 }}>Interpretation</div>
        <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
          {[
            `Day 1 drop (${fmt(result.days[0]?.dayLoss||0,unit).val}${fmt(result.days[0]?.dayLoss||0,unit).label}) is mostly glycogen + water — temporary.`,
            `True fat loss peaks Day 2–3 as ketosis deepens and fat fuels ${result.days[Math.min(2,result.days.length-1)]?.fatKg && ((result.days[Math.min(2,result.days.length-1)].fatKg/result.days[Math.min(2,result.days.length-1)].dayLoss)*100).toFixed(0)}% of daily loss.`,
            liftMins+caliMins>0 ? `Resistance training (${liftMins+caliMins} min/day) reduces protein breakdown by ~${((1-result.proteinSparingFactor)*100).toFixed(0)}% via mTOR signaling.` : "Adding even 20–30 min resistance training would reduce muscle protein breakdown ~15% via mTOR.",
            walkMins>0 ? `${walkMins} min walk @ ${walkPace} pace burns ${result.walkKcal} kcal/day — predominantly from fat in fasted aerobic state.` : "Walking 30–60 min/day is high-yield during fasting: aerobic, fat-dominant, and low-stress.",
            result.bf<15 ? "⚠ Low body fat: elevated protein catabolism. Resistance training is especially important." : result.bf>30 ? "Higher body fat = better protein sparing — abundant fat substrate protects muscle." : "Moderate body fat: protein catabolism is well within safe limits.",
          ].map((note,i) => (
            <div key={i} style={{ display:"flex", gap:8, alignItems:"flex-start" }}>
              <div style={{ width:3, height:3, borderRadius:"50%", background:T.lean, marginTop:7, flexShrink:0 }} />
              <span style={{ fontSize:11, color:"#8AAAC8", lineHeight:1.65 }}>{note}</span>
            </div>
          ))}
        </div>
      </div>

      {/* KETO ADAPTATION */}
      <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, overflow:"hidden" }}>
        <div style={{ padding:"12px 16px", borderBottom:`1px solid ${T.border}`, display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:6, height:6, borderRadius:"50%", background:T.accent }} />
          <span style={{ fontSize:9, letterSpacing:"0.14em", color:T.accent, textTransform:"uppercase" }}>What Is Keto-Adaptation?</span>
        </div>
        <div style={{ padding:"14px 16px", display:"flex", flexDirection:"column", gap:10 }}>
          <p style={{ fontSize:12, color:"#8AAAC8", lineHeight:1.7, margin:0 }}>
            Keto-adaptation means your body has already shifted its metabolic machinery to prioritize fat and ketones as fuel — typically after 2–4 weeks of a low-carb or ketogenic diet (&lt;50g carbs/day). A keto-adapted person carries significantly less stored glycogen, so on Day 1 of a fast they skip the multi-kilogram water/glycogen dump and move directly into fat oxidation 12–18 hours earlier.
          </p>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            {[
              ["Standard diet","24–36h to enter deep ketosis","Day 1 is mostly water/glycogen loss"],
              ["Keto-adapted","8–16h to enter deep ketosis","More fat loss from Day 1 onward"],
            ].map(([title,a,b])=>(
              <div key={title} style={{ background:T.bg, borderRadius:4, padding:"10px 12px", border:`1px solid ${T.border}` }}>
                <div style={{ fontSize:10, color:T.accentBright, fontWeight:600, marginBottom:5 }}>{title}</div>
                <div style={{ fontSize:10, color:T.muted, lineHeight:1.6 }}>{a}</div>
                <div style={{ fontSize:10, color:T.muted, lineHeight:1.6 }}>{b}</div>
              </div>
            ))}
          </div>
          <p style={{ fontSize:11, color:T.muted, lineHeight:1.6, margin:0 }}>
            <span style={{ color:T.warn }}>Note:</span> Keto-adaptation does not mean more total fat loss over a long fast — the advantage is front-loaded: better Days 1 and 2, with less "fake" scale weight loss from water.
          </p>
        </div>
      </div>

      {/* ELECTROLYTES */}
      <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, overflow:"hidden" }}>
        <div style={{ padding:"12px 16px", borderBottom:`1px solid ${T.border}`, display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:6, height:6, borderRadius:"50%", background:T.water }} />
          <span style={{ fontSize:9, letterSpacing:"0.14em", color:T.water, textTransform:"uppercase" }}>Ideal Electrolytes During Fasting</span>
        </div>
        <div style={{ padding:"14px 16px", display:"flex", flexDirection:"column", gap:10 }}>
          <p style={{ fontSize:12, color:"#8AAAC8", lineHeight:1.7, margin:0 }}>
            Ketosis causes the kidneys to excrete sodium faster than normal, and sodium loss pulls water and other electrolytes with it. Without replacement, deficiency sets in within 24–48 hours — causing headaches, dizziness, cramps, and fatigue.
          </p>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {[
              { mineral:"Sodium", dose:"2,000–5,000 mg/day", source:"Salty broth, pink salt in water", color:T.warn, note:"Most critical. Deficiency = headaches, dizziness, brain fog." },
              { mineral:"Potassium", dose:"1,000–3,500 mg/day", source:"No Salt / Nu-Salt (KCl), electrolyte powder", color:T.accent, note:"Deficiency = muscle cramps, heart palpitations. Balance with sodium." },
              { mineral:"Magnesium", dose:"300–500 mg/day", source:"Magnesium glycinate or citrate capsules", color:T.cali, note:"Take in the evening — improves sleep and reduces cramping." },
              { mineral:"Phosphorus", dose:"Moderate", source:"Bone broth", color:T.lean, note:"Critical for refeeding syndrome prevention. Don't over-supplement." },
              { mineral:"Water", dose:"3–4 L/day", source:"Still water, herbal tea, black coffee", color:T.water, note:"Target pale yellow urine. Overhydration dilutes electrolytes." },
            ].map(e => (
              <div key={e.mineral} style={{ display:"flex", gap:12, padding:"9px 12px", background:T.bg, borderRadius:4, border:`1px solid ${T.border}`, alignItems:"flex-start" }}>
                <div style={{ width:3, flexShrink:0, alignSelf:"stretch", background:e.color, borderRadius:2 }} />
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", flexWrap:"wrap", gap:6, marginBottom:3 }}>
                    <span style={{ fontSize:11, color:e.color, fontWeight:600 }}>{e.mineral}</span>
                    <span style={{ fontSize:10, color:T.text, fontFamily:"monospace" }}>{e.dose}</span>
                  </div>
                  <div style={{ fontSize:10, color:T.mutedLight, marginBottom:3 }}>Source: {e.source}</div>
                  <div style={{ fontSize:10, color:T.muted, lineHeight:1.5 }}>{e.note}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ padding:"9px 12px", background:"#080D12", borderRadius:4, border:`1px solid #0E1E2A`, fontSize:10, color:T.muted, lineHeight:1.6 }}>
            💊 <span style={{ color:T.text }}>Simplest protocol:</span> 1 cup bone broth morning + evening (sodium + phosphorus), ¼ tsp No Salt in water twice daily (potassium), 1× magnesium glycinate 400mg before bed.
          </div>
        </div>
      </div>

      {/* REFEEDING */}
      <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, overflow:"hidden" }}>
        <div style={{ padding:"12px 16px", borderBottom:`1px solid ${T.border}`, display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:6, height:6, borderRadius:"50%", background:T.fat }} />
          <span style={{ fontSize:9, letterSpacing:"0.14em", color:T.fat, textTransform:"uppercase" }}>Refeeding Done Right</span>
        </div>
        <div style={{ padding:"14px 16px", display:"flex", flexDirection:"column", gap:10 }}>
          <p style={{ fontSize:12, color:"#8AAAC8", lineHeight:1.7, margin:0 }}>
            MIT research (2024) found that stem cell regeneration surges during the refeeding phase — not during the fast itself. Breaking your fast incorrectly wastes this window. Reintroduce carbohydrates slowly and prioritise protein to capture the anabolic rebound.
          </p>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {[
              { phase:"Hours 0–4", label:"Break fast gently", color:T.water, items:["Bone broth only, small sips","No solid food yet","Lets digestive enzymes reactivate without shock"] },
              { phase:"Hours 4–12", label:"Simple sugars only", color:T.accent, items:["Diluted fruit juice, coconut water, watermelon","Gentle glucose reintroduction","Avoids digestive distress from complex foods"] },
              { phase:"Day 2", label:"Soft foods + small protein", color:T.cali, items:["Vegetable soup, steamed veg, rice or sweet potato","100–150g protein: eggs, fish, tofu, or legumes","No raw veg, heavy meat, or large portions yet"] },
              { phase:"Day 3+", label:"Normal eating + lift", color:T.lift, items:["Resume full diet, prioritise 1.6–2.2g protein/kg/day","Day 3 is optimal for resistance training (mTOR + IGF-1 rebound)","Distribute protein: 20g every 3 hours outperforms one large bolus"] },
            ].map(r => (
              <div key={r.phase} style={{ background:T.bg, borderRadius:4, border:`1px solid ${T.border}`, overflow:"hidden" }}>
                <div style={{ padding:"8px 12px", borderBottom:`1px solid ${T.border}`, display:"flex", gap:10, alignItems:"center" }}>
                  <span style={{ fontSize:9, color:r.color, fontFamily:"monospace", fontWeight:600 }}>{r.phase}</span>
                  <span style={{ fontSize:10, color:T.text }}>{r.label}</span>
                </div>
                <div style={{ padding:"8px 12px", display:"flex", flexDirection:"column", gap:4 }}>
                  {r.items.map((item,i) => (
                    <div key={i} style={{ display:"flex", gap:8, alignItems:"flex-start" }}>
                      <span style={{ color:r.color, fontSize:10, flexShrink:0, marginTop:1 }}>›</span>
                      <span style={{ fontSize:11, color:T.muted, lineHeight:1.5 }}>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div style={{ padding:"9px 12px", background:"#0D0600", borderRadius:4, border:`1px solid #2A1500`, fontSize:10, color:"#6A4E2A", lineHeight:1.6 }}>
            ⚠ <span style={{ color:"#A07040" }}>Refeeding syndrome risk:</span> After fasts of 5+ days, rapid carbohydrate reintroduction causes phosphate, magnesium and potassium to shift rapidly into cells — potentially causing dangerous cardiac arrhythmias. Always refeed gradually.
          </div>
        </div>
      </div>
    </div>
  
  ) : null;


  return (
    <div style={{ background:T.bg, color:T.text, fontFamily:"monospace", minHeight:"100vh", display:"flex", flexDirection:"column", WebkitFontSmoothing:"antialiased", MozOsxFontSmoothing:"grayscale" }}>

      {/* ── HEADER ── */}
      <div style={{ background:T.surface, borderBottom:`1px solid ${T.border}`, padding: isMobile ? "12px 14px" : "16px 24px", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"nowrap", gap:10 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, minWidth:0 }}>
            {/* Hamburger on mobile/tablet */}
            {(isMobile || isTablet) && (
              <button onClick={() => setSidebarOpen(o => !o)} style={{
                background:"none", border:`1px solid ${T.border}`, borderRadius:4,
                color:T.text, cursor:"pointer", padding:"6px 9px", fontSize:16,
                flexShrink:0, WebkitTapHighlightColor:"transparent", lineHeight:1,
              }}>☰</button>
            )}
            <div style={{ minWidth:0 }}>
              <div style={{ fontSize:isMobile?8:9, letterSpacing:"0.15em", color:T.accent, textTransform:"uppercase", marginBottom:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {isMobile ? "Mifflin-St Jeor · Cahill · MET" : "Mifflin-St Jeor · Cahill · Ainsworth MET · Biolo mTOR"}
              </div>
              <h1 style={{ margin:0, fontSize:isMobile?"clamp(14px,4.5vw,20px)":"clamp(16px,2.5vw,26px)", fontWeight:700, letterSpacing:"-0.02em", color:"#FFF", lineHeight:1, whiteSpace:"nowrap" }}>
                Fasting <span style={{ color:T.accent }}>Calculator</span>
              </h1>
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
            {result && !isMobile && (
              <span style={{ fontSize:10, color:T.accentBright, fontFamily:"monospace", whiteSpace:"nowrap" }}>
                −{unit==="imperial" ? kgToLbs(result.totalLoss).toFixed(1) : result.totalLoss}{unit==="imperial"?"lbs":"kg"}
              </span>
            )}
            <Toggle value={unit} onChange={setUnit} options={[["metric","KG"],["imperial","LBS"]]} small />
          </div>
        </div>

        {/* Mobile exercise badges row */}
        {isMobile && (
          <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginTop:8, alignItems:"center" }}>
            <span style={{ fontSize:9, color:T.muted }}>{duration}d fast</span>
            <ExerciseBadge mins={walkMins} color={T.walk} label="Walk" />
            <ExerciseBadge mins={liftMins} color={T.lift} label="Lift" />
            <ExerciseBadge mins={caliMins} color={T.cali} label="Cali" />
            {result && <span style={{ fontSize:9, color:T.accentBright }}>−{unit==="imperial" ? kgToLbs(result.totalLoss).toFixed(1) : result.totalLoss}{unit==="imperial"?"lbs":"kg"}</span>}
          </div>
        )}
      </div>

      {/* ── BODY ── */}
      <div style={{ display:"flex", flex:1, position:"relative", overflow:"hidden" }}>

        {/* Mobile overlay backdrop */}
        {(isMobile || isTablet) && sidebarOpen && (
          <div onClick={() => setSidebarOpen(false)} style={{
            position:"fixed", inset:0, background:"rgba(0,0,0,0.6)",
            zIndex:40, WebkitBackdropFilter:"blur(2px)", backdropFilter:"blur(2px)",
          }} />
        )}

        {/* SIDEBAR — fixed on desktop, drawer on mobile/tablet */}
        <div style={{
          width: sidebarWidth,
          flexShrink:0,
          background:T.surface,
          borderRight:`1px solid ${T.border}`,
          overflowY:"auto",
          WebkitOverflowScrolling:"touch",
          // Mobile/tablet: slide-in drawer
          ...(isMobile || isTablet ? {
            position:"fixed",
            top:0, left:0, bottom:0,
            zIndex:50,
            transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)",
            transition:"transform 0.28s cubic-bezier(0.4,0,0.2,1)",
            width: isMobile ? "min(85vw, 320px)" : sidebarWidth,
          } : {}),
        }}>
          {/* Close button inside drawer on mobile */}
          {(isMobile || isTablet) && (
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"14px 14px 0" }}>
              <span style={{ fontSize:9, letterSpacing:"0.15em", color:T.accent, textTransform:"uppercase" }}>Settings</span>
              <button onClick={() => setSidebarOpen(false)} style={{
                background:"none", border:`1px solid ${T.border}`, borderRadius:4,
                color:T.muted, cursor:"pointer", padding:"4px 8px", fontSize:14,
                WebkitTapHighlightColor:"transparent",
              }}>✕</button>
            </div>
          )}
          {sidebarJsx}
        </div>

        {/* RIGHT CONTENT */}
        <div style={{
          flex:1,
          overflowY:"auto",
          WebkitOverflowScrolling:"touch",
          background:T.bg,
          minWidth:0,
        }}>
          {result && (
            <div style={{ padding: isMobile ? "14px 12px 60px" : "18px 20px 60px" }}>

              {/* Tabs — horizontally scrollable */}
              <div style={{ display:"flex", borderBottom:`1px solid ${T.border}`, overflowX:"auto", WebkitOverflowScrolling:"touch", marginBottom:16, scrollbarWidth:"none" }}>
                {tabs.map(([k,l]) => (
                  <button key={k} onClick={()=>setActiveTab(k)} style={{
                    background:"none", border:"none", cursor:"pointer",
                    padding: isMobile ? "10px 12px" : "10px 14px",
                    fontSize: isMobile ? 9 : 10,
                    fontFamily:"monospace", letterSpacing:"0.08em", textTransform:"uppercase",
                    whiteSpace:"nowrap", WebkitTapHighlightColor:"transparent",
                    color: activeTab===k ? T.accentBright : T.muted,
                    borderBottom:`2px solid ${activeTab===k?T.accent:"transparent"}`,
                    transition:"color 0.15s, border-color 0.15s", flexShrink:0,
                  }}>{l}</button>
                ))}
              </div>

              {activeTab==="results" && resultsJsx}

              {activeTab==="walk-compare" && (
                <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
                  <div style={{ background:"#080D12", border:`1px solid #0E1E2A`, borderRadius:6, padding:"11px 13px", fontSize:11, color:"#8AAAC8", lineHeight:1.7 }}>
                    Using your body metrics and {duration}-day fast duration. Each scenario shows walking in isolation across different durations and paces.
                  </div>
                  <WalkingComparisonChart baseParams={getBaseParams()} duration={duration} unit={unit} />
                </div>
              )}

              {activeTab==="lift-compare" && (
                <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
                  <div style={{ background:"#080D12", border:`1px solid #0E1E2A`, borderRadius:6, padding:"11px 13px", fontSize:11, color:"#8AAAC8", lineHeight:1.7 }}>
                    No walking in these scenarios. Both lifting and calisthenics trigger the same mTOR protein-sparing signal — the difference is in caloric burn.
                  </div>
                  <ResistanceComparisonChart baseParams={getBaseParams()} duration={duration} unit={unit} />
                </div>
              )}

              {activeTab==="combined" && (
                <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
                  <div style={{ background:"#080D12", border:`1px solid #0E1E2A`, borderRadius:6, padding:"11px 13px", fontSize:11, color:"#8AAAC8", lineHeight:1.7 }}>
                    The optimal fasting protocol combines long-duration walking (fat oxidation) with resistance training (mTOR muscle preservation).
                  </div>
                  <CombinedComparisonChart baseParams={getBaseParams()} duration={duration} unit={unit} />
                </div>
              )}

              {activeTab==="table" && <DayTable days={result.days} unit={unit} />}

            </div>
          )}
        </div>
      </div>
    </div>
  );
}
