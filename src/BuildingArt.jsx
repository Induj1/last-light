import React from "react";

const windows = (xs, ys, offset = 0) =>
  ys.flatMap((y, j) =>
    xs.map((x, i) => (
      <rect
        key={`${x}-${y}`}
        x={x}
        y={y}
        width="4"
        height="5"
        rx=".5"
        fill="currentColor"
        opacity={(i + j + offset) % 4 === 0 ? 0.18 : 0.7}
        stroke="none"
      />
    )),
  );

export default function BuildingArt({ kind = "residential", seed = 0 }) {
  const frame = {
    fill: "var(--building-fill, #15231c)",
    stroke: "currentColor",
    strokeWidth: 1.2,
    strokeLinejoin: "round",
  };
  let structure;
  switch (kind) {
    case "hospital":
      structure = (
        <>
          <path d="M21 56V26h18V14h26v12h16v30Z" {...frame} />
          <path d="M46 56V43h13v13M26 22h8m36 0h7" />
          <path d="M49 19v11m-5-5h10" strokeWidth="3" />
          {windows([26, 33, 70], [33, 44], seed)}
          <path d="M43 36h18" opacity=".45" />
        </>
      );
      break;
    case "water":
      structure = (
        <>
          <path d="M28 28 32 10h35l5 18v12H28Z" {...frame} />
          <path d="M32 40 27 57m40-17 6 17M35 40v16m26-16v16M28 51h44M29 31h42M38 18h21" />
          <path
            d="M46 32c-7-5 0-12 3-15 4 4 9 11 3 15Z"
            fill="currentColor"
            opacity=".4"
            stroke="none"
          />
          <path d="M74 48h9v9H72" {...frame} />
        </>
      );
      break;
    case "school":
      structure = (
        <>
          <path d="M17 55V30h21V20l13-9 13 9v10h20v25Z" {...frame} />
          <path d="M46 55V42h12v13M38 30h27M19 27h17m31 0h15" />
          <circle cx="51" cy="25" r="5" />
          <path d="M51 22v4h3M52 10V3l10 3-10 3" />
          {windows([23, 30, 70, 77], [36, 46], seed)}
        </>
      );
      break;
    case "fire":
      structure = (
        <>
          <path d="M20 56V27h54v29M64 27V12h14v44" {...frame} />
          <path d="M26 56V38h17v18m6 0V38h17v18M25 30h34M69 18h4M69 23h4" />
          <path
            d="M31 42h7v10h-7m23-10h7v10h-7"
            fill="currentColor"
            opacity=".35"
          />
          <path
            d="M39 14c-9 7-3 13 2 9 3-2 4-6-2-9Z"
            fill="currentColor"
            opacity=".8"
            stroke="none"
          />
        </>
      );
      break;
    case "rail":
      structure = (
        <>
          <path d="M13 54V31l14-12h45l14 12v23Z" {...frame} />
          <path d="M22 31h56M26 55V37h20v18m8 0V37h20v18M26 48h20m8 0h20M24 60l5-7m15 0 4 7m4 0 5-7m15 0 4 7" />
          <path d="M37 24h25" strokeWidth="2" />
          {windows([31, 38, 59, 66], [40], seed)}
        </>
      );
      break;
    case "farm":
      structure = (
        <>
          <path d="M17 54V36l15-17 16 17v18ZM46 54V34h29v20" {...frame} />
          <path d="M25 54V39h14v15m-14-15 14 15m0-15L25 54M58 34V19c0-8 16-8 16 0v15M58 24h16M80 54V36m-1 7-5-5m6 2 5-6" />
          <path d="m8 57 76 0m-70 4h19m8 0h18m7 0h18" opacity=".4" />
          <circle cx="32" cy="32" r="3" />
        </>
      );
      break;
    case "factory":
      structure = (
        <>
          <path
            d="M16 56V31l18 8V28l20 11V28l24 10v18ZM64 32V13h8l2 23"
            {...frame}
          />
          <path d="M24 56V47h11v9m7 0v-9h11v9m7 0v-9h11v9M66 9c-9-5 0-9-7-12" />
          <path d="M22 43h8m12 0h8m12 0h8" strokeWidth="2" />
        </>
      );
      break;
    case "market":
      structure = (
        <>
          <path d="M20 55V33h62v22M16 33l7-16h54l9 16Z" {...frame} />
          <path d="m29 17-3 16m15-16-1 16m13-16v16m13-16 2 16M16 33c0 8 12 8 12 0 0 8 12 8 12 0 0 8 12 8 12 0 0 8 12 8 12 0 0 8 12 8 12 0 0 8 10 8 10 0M45 56V42h13v14" />
          <path
            d="M26 44h12v7H26m38-7h11v7H64"
            fill="currentColor"
            opacity=".3"
          />
        </>
      );
      break;
    case "mall":
      structure = (
        <>
          <path d="M16 55V29h68v26M25 29V18h48v11" {...frame} />
          <path d="M43 55V42h15v13M32 23h34M20 34h60" />
          {windows([23, 33, 64, 74], [40, 48], seed)}
          <path d="M43 11h17" strokeWidth="2" />
        </>
      );
      break;
    case "lights":
      structure = (
        <>
          <path d="M28 56V21c0-13 13-13 13-4M63 56V15c0-14 14-14 14-3M23 56h10m25 0h11" />
          <path d="M34 19h14l-3-6h-8Zm35-14h15l-4-6h-7Z" {...frame} />
          <path
            d="m38 25-8 24h24l-10-24m29-12-8 31h25L79 13"
            fill="currentColor"
            opacity=".07"
            stroke="none"
          />
          <path d="M17 61h71M46 55h9" opacity=".5" />
        </>
      );
      break;
    case "data":
      structure = (
        <>
          <path d="M23 56V15h53v41M29 10h39" {...frame} />
          {[23, 34, 45].map((y) => (
            <g key={y}>
              <rect x="30" y={y} width="38" height="8" rx="1" />
              <path d={`M35 ${y + 4}h16`} opacity=".7" />
              <circle cx="61" cy={y + 4} r="1.2" fill="currentColor" />
            </g>
          ))}
          <path d="M49 15V5m-5 1h10" />
        </>
      );
      break;
    default:
      structure = (
        <>
          <path d="M19 56V29h21v27M39 56V9h25v47M63 56V23h17v33" {...frame} />
          <path d="M44 9V5h15v4M17 26h25M68 20h8M47 56V47h10v9" />
          {windows([24, 32], [35, 45], seed)}
          {windows([45, 55], [16, 26, 36], seed)}
          {windows([69], [30, 40, 49], seed)}
        </>
      );
  }
  return (
    <svg
      className="building-art"
      viewBox="0 0 100 68"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    >
      <path d="M8 55v7h13m71-7v7H80M8 18v-6h8m76 6v-6h-8" opacity=".15" />
      <path d="M13 59h74" opacity=".35" />
      {structure}
    </svg>
  );
}

export function Portrait({ npcId = "operator" }) {
  const doctor = npcId.includes("hospital");
  const farmer = npcId.includes("farm");
  const worker =
    npcId.includes("water") ||
    npcId.includes("factory") ||
    npcId.includes("fire");
  return (
    <svg viewBox="0 0 64 64" className="portrait" aria-hidden="true">
      <rect width="64" height="64" rx="9" fill="#25352a" />
      <path
        d="M9 64v-8c0-12 13-17 23-17s23 5 23 17v8"
        fill={doctor ? "#d8e3ce" : "#7b9369"}
      />
      <path d="m24 43 8 10 8-10" fill="#f0c7a0" />
      <path d="M28 48h8l-2 16h-5Z" fill="#314637" />
      <path
        d="M18 22c0-21 29-22 29 0v11c0 9-8 15-14 15S18 42 18 33Z"
        fill="#e7bd95"
      />
      <path
        d="M17 26V17c1-17 30-18 31 0v12l-7-14c-3 7-11 8-19 7l-1 7Z"
        fill="#33342b"
      />
      <path
        d="M24 31h3m10 0h3"
        stroke="#33342b"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M29 40c3 2 5 2 8-1"
        fill="none"
        stroke="#9d6f54"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {doctor && (
        <>
          <path d="M17 17V7h31v10Z" fill="#dce7da" />
          <path d="M32 8v7m-3-3.5h6" stroke="#6d8d60" strokeWidth="2" />
          <path
            d="M20 45v10c0 4 6 4 6 0m16-10v10"
            stroke="#344936"
            strokeWidth="2"
            fill="none"
          />
          <circle cx="42" cy="56" r="3" fill="#344936" />
        </>
      )}
      {farmer && (
        <>
          <path d="M16 17 20 6h23l5 11" fill="#bea36b" />
          <path
            d="M11 19h43"
            stroke="#d7bc7b"
            strokeWidth="5"
            strokeLinecap="round"
          />
        </>
      )}
      {worker && (
        <>
          <path d="M15 19c0-23 34-23 34 0" fill="#d4b867" />
          <path d="M13 20h39M32 3v14" stroke="#ead38f" strokeWidth="3" />
        </>
      )}
    </svg>
  );
}
