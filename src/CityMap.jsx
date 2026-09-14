import React, { memo, useId } from "react";
import { powerModeFor } from "../shared/power.js";
import "./citymap.css";

const MAP = {
  width: 960,
  height: 688,
  x: 24,
  y: 27,
  cellWidth: 152,
  cellHeight: 104,
};
const SHORT_NAMES = {
  hospital: "HOSPITAL",
  water: "WATERWORKS",
  fire: "FIRE STN",
  school: "SCHOOL",
  rail: "STATION",
  farm: "FARMLAND",
  residential: "HOMES",
  data: "DATA CENTRE",
  factory: "INDUSTRY",
  market: "MARKET",
  mall: "RETAIL",
  lights: "STREETLIGHTS",
};
// Every service stays named in narrow cells; district codes remain alongside it.
const COMPACT_NAMES = {
  hospital: "HOSP.",
  water: "WATER",
  fire: "FIRE",
  school: "SCHOOL",
  rail: "RAIL",
  farm: "FARM",
  residential: "HOMES",
  data: "DATA",
  factory: "FACT.",
  market: "SHOPS",
  mall: "MALL",
  lights: "LIGHTS",
};
const clamp = (value) => Math.max(0, Math.min(1, value));
const isWarning = (block) => ["warning", "stabilizing"].includes(block.status);
const statusName = (block) =>
  ({
    powered: "Lights on",
    warning: "Power failing",
    stabilizing: "Securing connection",
    stabilized: "Connection secured",
    failed: "Permanently dark",
  })[block.status] || block.status;

/** Four finite light outages, driven by the simulation clock rather than CSS loops. */
export function warningLightState(block) {
  if (block.status === "failed") return { level: 0, progress: 1, completed: 4 };
  if (!isWarning(block)) return { level: 1, progress: 0, completed: 0 };
  const duration = Number(block.warningDuration);
  // Guided practice has no failure deadline; its target stays steadily illuminated.
  if (!Number.isFinite(duration) || duration <= 0)
    return { level: 0.82, progress: 0, completed: 0 };
  const progress = clamp(
    1 - Math.max(0, Number(block.warningRemaining) || 0) / duration,
  );
  const cycle = Math.min(3.999999, progress * 4);
  return {
    level: cycle % 1 < 0.56 ? 1 : 0.045,
    progress,
    completed: Math.min(4, Math.floor(progress * 4)),
  };
}

function seeded(id) {
  let value = 2166136261;
  for (const character of id)
    value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return () => {
    value = Math.imul(value ^ (value >>> 15), 2246822519);
    value = Math.imul(value ^ (value >>> 13), 3266489917);
    value ^= value >>> 16;
    return (value >>> 0) / 4294967296;
  };
}

function Tree({ x, y, r = 4, tone = 0 }) {
  const colors = ["#1e2d2c", "#273330", "#283c34", "#233936"];
  return (
    <g className="city-map-tree">
      <ellipse
        cx={x + 2}
        cy={y + 2.5}
        rx={r * 1.15}
        ry={r * 0.9}
        fill="#080e16"
        opacity=".7"
      />
      <circle cx={x} cy={y} r={r} fill={colors[tone % colors.length]} />
      <circle
        cx={x - r * 0.22}
        cy={y - r * 0.3}
        r={r * 0.62}
        fill="#4d5c48"
        opacity=".22"
      />
      <circle
        cx={x + r * 0.46}
        cy={y + r * 0.08}
        r={r * 0.55}
        fill="#111e21"
        opacity=".35"
      />
    </g>
  );
}

function Roof({
  x,
  y,
  w,
  h,
  angle = 0,
  pitched = false,
  tone = 0,
  vents = true,
}) {
  const colors = [
    "#51565a",
    "#424a50",
    "#596065",
    "#484e50",
    "#646461",
    "#55565a",
    "#555048",
  ];
  const windows = Math.max(2, Math.floor(w / 8));
  return (
    <g transform={`rotate(${angle} ${x + w / 2} ${y + h / 2})`}>
      <rect
        x={x + 2.4}
        y={y + 3}
        width={w}
        height={h}
        fill="#070e15"
        opacity=".8"
      />
      <g className="city-map-structure">
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          fill={colors[tone % colors.length]}
          stroke="#171f27"
          strokeWidth="1.1"
        />
        {pitched ? (
          <>
            <path
              d={`M${x} ${y}h${w}l-${w / 2} ${h / 2}Z`}
              fill="#858379"
              opacity=".22"
            />
            <path
              d={`M${x} ${y + h}h${w}l-${w / 2} -${h / 2}Z`}
              fill="#1c2630"
              opacity=".46"
            />
            <path
              d={`M${x + w / 2} ${y + 2}v${h - 4}`}
              stroke="#a4a195"
              strokeOpacity=".24"
              strokeWidth=".6"
            />
          </>
        ) : (
          <>
            <rect
              x={x + 2.3}
              y={y + 2.3}
              width={Math.max(1, w - 4.6)}
              height={Math.max(1, h - 4.6)}
              fill="none"
              stroke="#93958d"
              strokeOpacity=".25"
              strokeWidth=".8"
            />
            <path
              d={`M${x + 3} ${y + h * 0.5}h${w - 6}`}
              stroke="#1d2933"
              strokeOpacity=".45"
              strokeWidth=".65"
            />
            {vents && (
              <>
                <rect
                  x={x + w * 0.61}
                  y={y + h * 0.25}
                  width={Math.min(7, w * 0.19)}
                  height={Math.min(5, h * 0.23)}
                  fill="#2b333a"
                  stroke="#838987"
                  strokeWidth=".5"
                />
                {w > 35 && (
                  <rect
                    x={x + w * 0.3}
                    y={y + h * 0.54}
                    width="6"
                    height="4"
                    fill="#293239"
                    stroke="#7e8583"
                    strokeWidth=".5"
                  />
                )}
              </>
            )}
          </>
        )}
      </g>
      <g className="city-map-power-lights" fill="currentColor">
        <rect
          x={x + 1.5}
          y={y + h - 1.2}
          width={w - 3}
          height="3.5"
          opacity=".065"
        />
        {Array.from({ length: windows }, (_, i) => (
          <rect
            key={i}
            x={x + 3 + (i * (w - 6)) / windows}
            y={y + h - 0.5}
            width={Math.min(3.2, ((w - 6) / windows) * 0.57)}
            height="1.35"
            opacity={i % 3 === 0 ? 0.5 : 0.96}
          />
        ))}
        <rect
          x={x + w - 0.5}
          y={y + h * 0.36}
          width="1.2"
          height={Math.min(5, h * 0.35)}
          opacity=".78"
        />
        {!pitched && (
          <rect
            x={x + w * 0.2}
            y={y + 3.5}
            width={Math.min(8, w * 0.22)}
            height="1.5"
            opacity=".34"
          />
        )}
      </g>
    </g>
  );
}

function Car({ x, y, angle = 0, color = "#89908c", long = false }) {
  return (
    <g transform={`rotate(${angle} ${x + 2} ${y + 1.2})`} opacity=".83">
      <rect
        x={x + 0.6}
        y={y + 0.7}
        width={long ? 7 : 4.8}
        height="2.8"
        rx=".5"
        fill="#080e13"
      />
      <rect
        x={x}
        y={y}
        width={long ? 7 : 4.8}
        height="2.5"
        rx=".5"
        fill={color}
      />
      <path
        d={`M${x + 1.2} ${y + 0.3}v1.9m${long ? 4.3 : 2.3} -1.9v1.9`}
        stroke="#29333c"
        strokeWidth=".8"
      />
    </g>
  );
}

function Parking({ x, y, columns = 6, rows = 2, random }) {
  return (
    <g>
      <rect
        x={x - 2}
        y={y - 3}
        width={columns * 9 + 2}
        height={rows * 10 + 1}
        fill="#202b35"
      />
      {Array.from({ length: columns * rows }, (_, i) => {
        const px = x + (i % columns) * 9;
        const py = y + Math.floor(i / columns) * 10;
        return (
          <g key={i}>
            <path
              d={`M${px - 1} ${py - 1}v6m0 -6h7`}
              stroke="#75807e"
              strokeOpacity=".3"
              strokeWidth=".6"
            />
            {(random ? random() : i % 3) > 0.28 && (
              <Car
                x={px + 0.5}
                y={py + 0.5}
                angle={90}
                color={["#858b88", "#565755", "#777769", "#4a5158"][i % 4]}
              />
            )}
          </g>
        );
      })}
    </g>
  );
}

function Lamp({ x, y, glow }) {
  return (
    <g className="city-map-power-lights">
      <circle cx={x} cy={y} r="12.5" fill={`url(#${glow})`} />
      <circle cx={x} cy={y} r="1.2" fill="currentColor" opacity=".34" />
      <circle cx={x} cy={y} r=".78" fill="currentColor" />
      <path
        d={`M${x + 0.7} ${y + 0.9}l1.1 1.6`}
        stroke="#080e14"
        strokeWidth=".7"
      />
    </g>
  );
}

const ParcelArt = memo(function ParcelArt({ id, kind, glow }) {
  const random = seeded(id);
  const roofs = [];
  const extras = [];
  const roof = (props) =>
    roofs.push(
      <Roof key={roofs.length} tone={Math.floor(random() * 7)} {...props} />,
    );
  const trees = (count, region = [7, 8, 136, 84]) => {
    for (let i = 0; i < count; i++)
      extras.push(
        <Tree
          key={`tree-${extras.length}`}
          x={region[0] + random() * region[2]}
          y={region[1] + random() * region[3]}
          r={2.8 + random() * 2.8}
          tone={i}
        />,
      );
  };
  let ground;
  switch (kind) {
    case "hospital":
      ground = <path d="M9 10H139V91H94V85H9Z" fill="#27323a" />;
      roof({ x: 17, y: 16, w: 79, h: 23 });
      roof({ x: 44, y: 32, w: 28, h: 46 });
      roof({ x: 18, y: 67, w: 56, h: 15 });
      roof({ x: 107, y: 17, w: 27, h: 35 });
      extras.push(
        <g key="helipad" className="city-map-structure">
          <circle
            cx="84"
            cy="62"
            r="13"
            fill="#35423f"
            stroke="#738278"
            strokeWidth=".8"
          />
          <circle
            cx="84"
            cy="62"
            r="10.5"
            fill="none"
            stroke="#879087"
            strokeWidth=".6"
          />
          <path
            d="M80 56v12m8-12v12m-8-6h8"
            fill="none"
            stroke="#b0b0a1"
            strokeWidth="1.7"
          />
        </g>,
      );
      extras.push(
        <Parking
          key="parking"
          x={106}
          y={64}
          columns={3}
          rows={2}
          random={random}
        />,
      );
      extras.push(<Car key="ambulance" x={23} y={46} color="#bcbfb0" long />);
      trees(5, [10, 84, 80, 8]);
      break;
    case "water":
      ground = <path d="M9 9H140V92H9Z" fill="#20333b" />;
      roof({ x: 16, y: 16, w: 41, h: 25 });
      roof({ x: 15, y: 54, w: 30, h: 28 });
      extras.push(
        <g key="water" className="city-map-structure">
          <rect
            x="110"
            y="17"
            width="25"
            height="66"
            fill="#142b37"
            stroke="#465e66"
            strokeWidth="2"
          />
          <path d="M112 39h21m-21 23h21" stroke="#465d65" strokeWidth="2" />
          {[35, 70].map((y) => (
            <g key={y}>
              <circle
                cx="79"
                cy={y}
                r="17"
                fill="#182b36"
                stroke="#63716f"
                strokeWidth="3"
              />
              <circle cx="79" cy={y} r="12.7" fill="#294650" />
              <path
                d={`M63 ${y}h32M79 ${y - 16}v32`}
                stroke="#69766f"
                strokeWidth="1.2"
              />
              <circle cx="79" cy={y} r="2" fill="#8a9188" />
            </g>
          ))}
          <path
            d="M44 64h17m-20-33h21m35 2h14m-14 39h14"
            stroke="#75807a"
            strokeWidth="1.3"
          />
        </g>,
      );
      trees(4, [6, 85, 125, 9]);
      break;
    case "school":
      ground = <path d="M11 13H140V90H9Z" fill="#293733" />;
      roof({ x: 15, y: 15, w: 73, h: 18 });
      roof({ x: 15, y: 34, w: 20, h: 42 });
      roof({ x: 14, y: 74, w: 77, h: 13 });
      extras.push(
        <g key="school-yard" className="city-map-structure">
          <rect
            x="100"
            y="20"
            width="34"
            height="57"
            rx="2"
            fill="#34473e"
            stroke="#768271"
            strokeWidth=".7"
          />
          <path
            d="M103 23h28v51h-28Zm0 25.5h28"
            stroke="#9ca38a"
            strokeOpacity=".48"
            strokeWidth=".65"
            fill="none"
          />
          <circle
            cx="117"
            cy="48.5"
            r="6.5"
            fill="none"
            stroke="#a5aa91"
            strokeOpacity=".42"
            strokeWidth=".7"
          />
          <path d="M54 42h23v22H54Z" fill="#5a5850" opacity=".4" />
        </g>,
      );
      trees(7, [42, 40, 44, 28]);
      break;
    case "fire":
      ground = <path d="M9 10H139V94H8Z" fill="#2c3338" />;
      roof({ x: 15, y: 17, w: 93, h: 34 });
      roof({ x: 114, y: 16, w: 20, h: 50 });
      roof({ x: 18, y: 76, w: 39, h: 13 });
      extras.push(
        <g key="bays" className="city-map-structure">
          {[27, 50, 73, 96].map((x) => (
            <path key={x} d={`M${x} 53v14`} stroke="#858377" strokeWidth=".7" />
          ))}
          <path
            d="M13 69H106"
            stroke="#858377"
            strokeOpacity=".35"
            strokeWidth=".8"
          />
        </g>,
      );
      extras.push(
        ...[23, 46, 70, 92].map((x, i) => (
          <Car
            key={`truck-${i}`}
            x={x}
            y={57}
            angle={90}
            color={i % 2 ? "#a09173" : "#965746"}
            long
          />
        )),
      );
      trees(6, [74, 78, 62, 11]);
      break;
    case "rail":
      ground = <path d="M10 6H142V96H10Z" fill="#262e32" />;
      extras.push(
        <g key="tracks" className="city-map-structure">
          {[93, 108, 124].map((x) => (
            <g key={x}>
              {Array.from({ length: 19 }, (_, i) => (
                <path
                  key={i}
                  d={`M${x - 5} ${i * 5 + 5}h10`}
                  stroke="#465054"
                  strokeWidth="1"
                />
              ))}
              <path
                d={`M${x - 3} 4v96m6-96v96`}
                stroke="#92978c"
                strokeOpacity=".66"
                strokeWidth=".85"
              />
            </g>
          ))}
          <rect
            x="105"
            y="18"
            width="6"
            height="62"
            fill="#606c70"
            stroke="#939e98"
            strokeWidth=".5"
          />
          <path
            d="M106 27h4m-4 14h4m-4 14h4m-4 14h4"
            stroke="#242e36"
            strokeWidth="1.3"
          />
        </g>,
      );
      roof({ x: 55, y: 12, w: 22, h: 78, pitched: true });
      roof({ x: 16, y: 23, w: 29, h: 49 });
      trees(4, [14, 79, 30, 9]);
      break;
    case "farm":
      ground = (
        <g className="city-map-structure">
          <path d="M12 10H95L91 90H10Z" fill="#303e30" />
          <path d="M13 11L96 10L93 46H11Z" fill="#42452d" opacity=".52" />
          {Array.from({ length: 11 }, (_, i) => (
            <path
              key={i}
              d={`M${17 + i * 7} 14l-3 72`}
              stroke={i % 3 ? "#607047" : "#1a302c"}
              strokeOpacity=".4"
              strokeWidth="2.5"
            />
          ))}
          <path
            d="M10 49L96 47"
            stroke="#7b7958"
            strokeOpacity=".23"
            strokeWidth="3.5"
          />
        </g>
      );
      roof({ x: 108, y: 17, w: 28, h: 33, pitched: true, tone: 6 });
      roof({ x: 108, y: 64, w: 28, h: 16, pitched: true });
      extras.push(
        <g key="silos" className="city-map-structure">
          <circle
            cx="101"
            cy="61"
            r="5.5"
            fill="#6a6d66"
            stroke="#303d3f"
            strokeWidth="1.3"
          />
          <circle
            cx="101"
            cy="73"
            r="5.5"
            fill="#5c625f"
            stroke="#303d3f"
            strokeWidth="1.3"
          />
        </g>,
      );
      trees(7, [8, 89, 127, 7]);
      break;
    case "factory":
      ground = <path d="M9 10H143V93H9Z" fill="#2a3033" />;
      roof({ x: 14, y: 15, w: 75, h: 32, pitched: true });
      roof({ x: 14, y: 54, w: 75, h: 32, pitched: true });
      roof({ x: 104, y: 17, w: 29, h: 21 });
      extras.push(
        <g key="containers" className="city-map-structure">
          {[0, 1, 2, 3].map((i) => (
            <g key={i}>
              <rect
                x="104"
                y={47 + i * 10}
                width="25"
                height="6"
                fill={["#575745", "#49545a", "#624f44", "#566263"][i]}
                stroke="#8a8a7b"
                strokeOpacity=".4"
                strokeWidth=".6"
              />
              <path
                d={`M109 ${48 + i * 10}v4m5-4v4m5-4v4m5-4v4`}
                stroke="#151e23"
                strokeOpacity=".4"
                strokeWidth=".8"
              />
            </g>
          ))}
        </g>,
      );
      trees(3, [133, 52, 5, 31]);
      break;
    case "data":
      ground = <path d="M10 9H142V94H10Z" fill="#283138" />;
      roof({ x: 15, y: 13, w: 78, h: 60 });
      roof({ x: 102, y: 14, w: 29, h: 24 });
      extras.push(
        <g key="cooling" className="city-map-structure">
          {Array.from({ length: 12 }, (_, i) => (
            <g key={i}>
              <rect
                x={24 + (i % 4) * 16}
                y={22 + Math.floor(i / 4) * 14}
                width="9"
                height="8"
                fill="#39464c"
                stroke="#7e8985"
                strokeWidth=".6"
              />
              <circle
                cx={28.5 + (i % 4) * 16}
                cy={26 + Math.floor(i / 4) * 14}
                r="2.3"
                fill="#242f37"
                stroke="#5f6d6e"
                strokeWidth=".5"
              />
            </g>
          ))}
        </g>,
      );
      extras.push(
        <Parking
          key="parking"
          x={101}
          y={48}
          columns={4}
          rows={3}
          random={random}
        />,
      );
      trees(9, [14, 84, 121, 7]);
      break;
    case "mall":
      ground = <path d="M8 9H143V96H8Z" fill="#2c343b" />;
      roof({ x: 17, y: 15, w: 109, h: 40 });
      roof({ x: 32, y: 51, w: 41, h: 13 });
      extras.push(
        <g key="skylights" className="city-map-structure">
          {Array.from({ length: 6 }, (_, i) => (
            <rect
              key={i}
              x={28 + i * 14}
              y="24"
              width="8"
              height="19"
              fill="#3a4c54"
              stroke="#7b8684"
              strokeWidth=".6"
            />
          ))}
        </g>,
      );
      extras.push(
        <Parking
          key="parking"
          x={16}
          y={74}
          columns={13}
          rows={1}
          random={random}
        />,
      );
      trees(5, [132, 16, 5, 45]);
      break;
    case "market":
      ground = <path d="M8 9H141V95H8Z" fill="#323638" />;
      for (let row = 0; row < 3; row++)
        for (let col = 0; col < 4; col++) {
          roof({
            x: 12 + col * 33 + random() * 3,
            y: 13 + row * 27 + random() * 3,
            w: 25 + random() * 3,
            h: 18 + random() * 3,
            pitched: random() > 0.6,
            angle: (random() - 0.5) * 4,
          });
        }
      extras.push(<Car key="delivery" x={116} y={91} color="#899387" long />);
      break;
    case "lights":
      ground = (
        <g className="city-map-structure">
          <path d="M11 10H141L134 92H12Z" fill="#1b302c" />
          <path
            d="M12 28C40 19 67 67 140 78M55 10C75 33 59 57 41 91"
            stroke="#5f6b5e"
            strokeOpacity=".45"
            strokeWidth="3"
            fill="none"
          />
          <ellipse
            cx="83"
            cy="49"
            rx="20"
            ry="14"
            fill="#28393b"
            stroke="#69766b"
            strokeWidth="1.8"
          />
          <ellipse
            cx="83"
            cy="49"
            rx="12"
            ry="8"
            fill="#284551"
            stroke="#465e61"
            strokeWidth=".6"
          />
        </g>
      );
      trees(19);
      roof({ x: 112, y: 16, w: 21, h: 17, pitched: true });
      extras.push(
        ...[
          [34, 25],
          [55, 36],
          [71, 65],
          [109, 70],
          [38, 76],
        ].map(([x, y], i) => (
          <Lamp key={`park-lamp-${i}`} x={x} y={y} glow={glow} />
        )),
      );
      break;
    default:
      ground = (
        <g>
          <path d="M9 9H143V93H9Z" fill="#253430" opacity=".8" />
          <path
            d="M51 8v87m49-87v87M8 47h135"
            stroke="#38434a"
            strokeWidth="4"
          />
          <path
            d="M52 8v87m49-87v87"
            stroke="#929184"
            strokeOpacity=".12"
            strokeWidth=".6"
          />
        </g>
      );
      for (let row = 0; row < 3; row++)
        for (let col = 0; col < 3; col++) {
          const x = 12 + col * 47 + random() * 4;
          const y = 12 + row * 28 + random() * 4;
          roof({
            x,
            y,
            w: 27 + random() * 6,
            h: 17 + random() * 4,
            pitched: true,
            angle: (random() - 0.5) * 8,
          });
          extras.push(
            <Tree
              key={`garden-${row}-${col}`}
              x={x + 35}
              y={y + 8}
              r={3 + random() * 2}
              tone={row + col}
            />,
          );
        }
      if (id.endsWith("2") || id.endsWith("5"))
        extras.push(
          <g key="pool" className="city-map-structure">
            <rect x="53" y="70" width="10" height="18" rx="3" fill="#608281" />
            <rect
              x="54.5"
              y="71.5"
              width="7"
              height="15"
              rx="2"
              fill="#254d60"
            />
            <path
              d="M56 75h4m-4 3h4"
              stroke="#88a4a1"
              strokeOpacity=".25"
              strokeWidth=".7"
            />
          </g>,
        );
  }
  return (
    <>
      <g className="city-map-parcel-ground">{ground}</g>
      {roofs}
      {extras}
      {[
        [7, 8],
        [76, 7],
        [145, 32],
        [7, 66],
        [48, 97],
        [122, 97],
      ].map(([x, y], i) => (
        <Lamp key={`street-lamp-${i}`} x={x} y={y} glow={glow} />
      ))}
    </>
  );
});

const Roads = memo(function Roads() {
  return (
    <g className="city-map-roads">
      <rect
        x="12"
        y="15"
        width="936"
        height="648"
        rx="7"
        fill="none"
        stroke="#34404b"
        strokeWidth="13"
      />
      {[1, 2, 3, 4, 5].map((i) => (
        <g key={`vertical-${i}`}>
          <path
            d={`M${MAP.x + i * MAP.cellWidth} 15V663`}
            stroke="#121c27"
            strokeWidth={i === 2 || i === 4 ? 16 : 10}
          />
          <path
            d={`M${MAP.x + i * MAP.cellWidth} 15V663`}
            stroke="#3a4650"
            strokeWidth={i === 2 || i === 4 ? 12 : 7}
          />
          <path
            d={`M${MAP.x + i * MAP.cellWidth} 20V658`}
            stroke="#a09b7d"
            strokeOpacity=".27"
            strokeWidth=".7"
            strokeDasharray={i === 2 ? "none" : "5 7"}
          />
        </g>
      ))}
      {[1, 2, 3, 4, 5].map((i) => (
        <g key={`horizontal-${i}`}>
          <path
            d={`M12 ${MAP.y + i * MAP.cellHeight}H948`}
            stroke="#121c27"
            strokeWidth={i === 3 ? 18 : 10}
          />
          <path
            d={`M12 ${MAP.y + i * MAP.cellHeight}H948`}
            stroke="#3a4650"
            strokeWidth={i === 3 ? 14 : 7}
          />
          <path
            d={`M16 ${MAP.y + i * MAP.cellHeight}H944`}
            stroke="#a09b7d"
            strokeOpacity=".24"
            strokeWidth=".7"
            strokeDasharray={i === 3 ? "none" : "5 7"}
          />
        </g>
      ))}
      {[1, 2, 3, 4, 5].flatMap((row) =>
        [1, 2, 3, 4, 5].map((col) => (
          <g key={`${row}-${col}`} opacity=".28">
            <path
              d={`M${MAP.x + col * MAP.cellWidth - 12} ${MAP.y + row * MAP.cellHeight - 3}v6m3-6v6m19-6v6m3-6v6`}
              stroke="#bbc0ad"
              strokeWidth="1.1"
            />
          </g>
        )),
      )}
      <g opacity=".66">
        <Car x={153} y={MAP.y + 3 * MAP.cellHeight - 4} color="#8c9288" />
        <Car
          x={443}
          y={MAP.y + 3 * MAP.cellHeight + 2}
          color="#8e7b62"
          angle={180}
        />
        <Car
          x={MAP.x + 4 * MAP.cellWidth - 4}
          y={271}
          angle={90}
          color="#8c9696"
        />
        <Car
          x={MAP.x + 2 * MAP.cellWidth + 2}
          y={467}
          angle={90}
          color="#636c73"
        />
      </g>
    </g>
  );
});

export default function CityMap({ state, onSelect }) {
  const prefix = `city-${useId().replace(/:/g, "")}`;
  const glow = `${prefix}-lamp`;
  const blocks = state.blocks || [];
  return (
    <div
      className="city-map"
      role="group"
      aria-label="Overhead city map. Select a district to supply its service."
    >
      <svg
        className="city-map-drawing"
        viewBox={`0 0 ${MAP.width} ${MAP.height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id={`${prefix}-terrain`} x2=".8" y2="1">
            <stop stopColor="#1b2936" />
            <stop offset="1" stopColor="#101a27" />
          </linearGradient>
          <radialGradient id={glow}>
            <stop stopColor="#ebc781" stopOpacity=".45" />
            <stop offset=".33" stopColor="#d5ab66" stopOpacity=".15" />
            <stop offset="1" stopColor="#d9ae66" stopOpacity="0" />
          </radialGradient>
          <pattern
            id={`${prefix}-grain`}
            width="43"
            height="37"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M2 7h4m13 21h3m9-13h5M8 34h5m21-3h2M17 2h2M3 22h1"
              stroke="#a6b5b3"
              strokeWidth=".65"
              opacity=".095"
            />
            <path
              d="M8 15h3m10-1h1m8 14h3M37 6h2M12 27h3"
              stroke="#050b16"
              strokeWidth="1.6"
              opacity=".27"
            />
          </pattern>
          <linearGradient id={`${prefix}-edge`} x2="0" y2="1">
            <stop stopColor="#070f1b" stopOpacity=".08" />
            <stop offset=".8" stopColor="#070f1b" stopOpacity="0" />
            <stop offset="1" stopColor="#070f1b" stopOpacity=".65" />
          </linearGradient>
        </defs>
        <rect
          width={MAP.width}
          height={MAP.height}
          fill={`url(#${prefix}-terrain)`}
        />
        <path
          d="M0 0H960V13C684 8 685 25 457 15C233 7 153 22 0 12Z"
          fill="#1b3337"
          opacity=".55"
        />
        <Roads />
        {blocks.map((block) => {
          const light = warningLightState(block);
          const warning = isWarning(block);
          return (
            <g
              key={block.id}
              className={`city-map-parcel ${warning ? "is-warning" : ""} ${block.status === "failed" ? "is-failed" : ""}`}
              transform={`translate(${MAP.x + block.col * MAP.cellWidth} ${MAP.y + block.row * MAP.cellHeight})`}
              style={{ "--parcel-light": light.level }}
              data-demand={
                block.powerMode || powerModeFor(block.powerRequirement)
              }
              data-warning-progress={
                warning ? light.progress.toFixed(3) : undefined
              }
              data-warning-pulses={warning ? 4 : undefined}
            >
              <ParcelArt id={block.id} kind={block.kind} glow={glow} />
            </g>
          );
        })}
        <rect
          width={MAP.width}
          height={MAP.height}
          fill={`url(#${prefix}-grain)`}
          pointerEvents="none"
        />
        <rect
          width={MAP.width}
          height={MAP.height}
          fill={`url(#${prefix}-edge)`}
          pointerEvents="none"
        />
        <g
          className="city-map-mapmarks"
          fill="#859393"
          fontFamily="monospace"
          fontSize="6.5"
          letterSpacing="1.4"
        >
          <text x="28" y="676">
            N E W H O R I Z O N
          </text>
          <text x="924" y="676" textAnchor="end">
            SECTOR 07
          </text>
          <path
            d="M899 669h25m-25-2v4m25-4v4"
            stroke="#7e8f90"
            strokeWidth=".65"
          />
        </g>
      </svg>
      <div className="city-map-targets">
        {blocks.map((block) => {
          const selected = block.id === state.selectedId;
          const warning = isWarning(block);
          const failed = block.status === "failed";
          const target = state.training?.targetId === block.id;
          const mode = block.powerMode || powerModeFor(block.powerRequirement);
          const light = warningLightState(block);
          return (
            <button
              key={block.id}
              type="button"
              className={`city-map-hit ${selected ? "is-selected" : ""} ${warning ? "is-warning" : ""} ${failed ? "is-failed" : ""} ${target ? "is-training" : ""}`}
              style={{
                left: `${((MAP.x + block.col * MAP.cellWidth) / MAP.width) * 100}%`,
                top: `${((MAP.y + block.row * MAP.cellHeight) / MAP.height) * 100}%`,
                width: `${(MAP.cellWidth / MAP.width) * 100}%`,
                height: `${(MAP.cellHeight / MAP.height) * 100}%`,
              }}
              onClick={() => onSelect?.(block.id)}
              aria-label={`${block.name}, district ${block.district}, ${mode} demand, ${statusName(block)}`}
              aria-pressed={selected}
              data-block-id={block.id}
              data-demand={mode}
              title={`${block.district} · ${block.name} · ${mode.toUpperCase()} demand · ${statusName(block)}`}
            >
              <span className="city-map-corners" aria-hidden="true" />
              <span className="city-map-label" aria-hidden="true">
                <span className="city-map-district">{block.district}</span>
                <span className="city-map-service">
                  {SHORT_NAMES[block.kind] || block.name}
                </span>
                <span className="city-map-service-compact">
                  {COMPACT_NAMES[block.kind] || block.name}
                </span>
              </span>
              {(selected || warning || target) && (
                <span
                  className={`city-map-demand demand-${mode} ${warning ? "has-alert" : ""}`}
                  aria-hidden="true"
                >
                  {warning && (
                    <svg
                      className="city-map-alert"
                      viewBox="0 0 24 24"
                      focusable="false"
                    >
                      <path
                        d="M10.3 3.7a2 2 0 0 1 3.4 0l8.5 14.8a2 2 0 0 1-1.7 3H3.5a2 2 0 0 1-1.7-3Z"
                        fill="currentColor"
                      />
                      <path
                        d="M12 8v6"
                        stroke="#111d2a"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                      />
                      <circle cx="12" cy="17.7" r="1.2" fill="#111d2a" />
                    </svg>
                  )}
                  <span className="city-map-demand-text">
                    {failed ? "DARK" : mode.toUpperCase()}
                  </span>
                </span>
              )}
              {warning && !state.training && (
                <span
                  className="city-map-pulses"
                  aria-label="Four light flashes before failure"
                >
                  {[0, 1, 2, 3].map((i) => (
                    <i key={i} className={i < light.completed ? "spent" : ""} />
                  ))}
                </span>
              )}
              {block.status === "stabilized" && selected && (
                <span className="city-map-restored" aria-hidden="true">
                  SECURED
                </span>
              )}
              {warning && block.status === "stabilizing" && (
                <span
                  className="city-map-recovery"
                  aria-hidden="true"
                  style={{
                    transform: `scaleX(${clamp(block.stabilization || 0)})`,
                  }}
                />
              )}
            </button>
          );
        })}
      </div>
      <div className="city-map-compass" aria-hidden="true">
        <span>N</span>
        <i />
      </div>
    </div>
  );
}
