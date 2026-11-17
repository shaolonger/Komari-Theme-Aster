import { useId } from "react";
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
