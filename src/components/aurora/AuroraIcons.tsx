import { useId } from "react";
import type { Carrier } from "./auroraModel";

export function CarrierLogo({ carrier }: { carrier: Carrier }) {
  return (
    <svg
      className="aurora-carrier-logo"
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
    >
      {carrier === "电信" ? (
        <g fill="currentColor">
          <path d="M27 5c-8-1-19 6-20 12-2 8 12 9 22 5 12-5 18-13 12-16-3-2-7-2-10-1 6 1 5 5 0 9-6 5-16 7-17 3-1-3 6-9 13-12Z" />
          <path d="M23 7c-6 8-7 24-1 33 4 6 10 1 14-7l-6 3c-5-4-7-16-3-27Z" />
        </g>
      ) : carrier === "联通" ? (
        <g stroke="currentColor" strokeWidth="3.4" transform="rotate(45 24 24)">
          {[12, 24, 36].map((x) => (
            <rect key={x} x={x - 5} y="7" width="10" height="34" rx="5" />
          ))}
          {[12, 24, 36].map((y) => (
            <rect key={y} x="7" y={y - 5} width="34" height="10" rx="5" />
          ))}
        </g>
      ) : (
        <>
          <rect
            x="7"
            y="7"
            width="34"
            height="34"
            rx="10"
            transform="rotate(45 24 24)"
            fill="#00a2df"
          />
          <path
            d="m5 22 12 9c4 3 6 3 10-1l13-12M8 16l11 8c3 2 5 2 8-1l9-8M10 32l8 6c4 3 6 3 10-1l14-13"
            stroke="white"
            strokeWidth="4"
          />
          <path
            d="m7 19 11 8c4 3 6 3 10-1l11-10"
            stroke="#b4d92c"
            strokeWidth="4"
          />
        </>
      )}
    </svg>
  );
}

export function ServerAvatar() {
  const id = useId();
  return (
    <svg
      className="aurora-server-avatar"
      viewBox="0 0 150 150"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={`${id}-orb`}>
          <stop stopColor="#e9e1ff" />
          <stop offset=".68" stopColor="#c2a5ff" />
          <stop offset="1" stopColor="#b794f2" />
        </radialGradient>
        <linearGradient id={`${id}-server`} x2="1" y2="1">
          <stop stopColor="#f5f7ff" />
          <stop offset=".45" stopColor="#c4c6ff" />
          <stop offset="1" stopColor="#7d48de" />
        </linearGradient>
        <linearGradient id={`${id}-top`} x2="1" y2="1">
          <stop stopColor="white" />
          <stop offset="1" stopColor="#bca3ff" />
        </linearGradient>
      </defs>
      <circle
        cx="75"
        cy="75"
        r="70"
        fill={`url(#${id}-orb)`}
        stroke="white"
        strokeWidth="3"
      />
      <ellipse cx="75" cy="110" rx="55" ry="16" fill="#8561ee" opacity=".25" />
      {[2, 1, 0].map((i) => (
        <g key={i} transform={`translate(0 ${i * 22})`}>
          <path
            d="M32 49Q32 46 36 45L78 31Q82 30 86 32L115 43Q119 45 119 49V65Q119 70 114 72L77 87Q73 89 68 87L37 75Q32 73 32 69Z"
            fill={`url(#${id}-server)`}
            stroke="#f0edff"
          />
          <path
            d="M34 47 78 32Q82 31 86 33L116 45 74 63Q71 64 68 62Z"
            fill={`url(#${id}-top)`}
          />
          <path
            d="M73 64 118 46V65Q118 69 114 71L74 87Z"
            fill="#7953d9"
            opacity=".65"
          />
          <circle cx="45" cy="63" r="3" fill="#7ff5ff" stroke="white" />
          <path
            d="m83 68 23-9"
            stroke="#4d399e"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </g>
      ))}
      <ellipse cx="75" cy="35" rx="26" ry="11" fill="white" opacity=".55" />
      <path
        d="M50 36c-8-6 0-16 9-14 3-12 23-13 29-3 14-4 23 8 16 15-14 8-37 9-54 2Z"
        fill="white"
        opacity=".7"
      />
      <path
        d="M16 105C-5 67 131 34 138 65"
        stroke="white"
        strokeWidth="2"
        fill="none"
        opacity=".7"
      />
    </svg>
  );
}
