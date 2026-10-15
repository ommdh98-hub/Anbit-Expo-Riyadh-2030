export function Garden({
  watering = false,
  variant = 0,
  label = "ANBIT garden illustration",
}: {
  watering?: boolean;
  variant?: number;
  label?: string;
}) {
  return (
    <svg
      className={`garden-art ${watering ? "watering" : ""}`}
      viewBox="0 0 600 360"
      fill="none"
      role="img"
      aria-label={label}
    >
      <defs>
        <linearGradient id={`soil${variant}`} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#53715a" />
          <stop offset="1" stopColor="#203d30" />
        </linearGradient>
        <linearGradient id={`leaf${variant}`}>
          <stop stopColor="#9abf77" />
          <stop offset="1" stopColor="#3d785b" />
        </linearGradient>
      </defs>
      <circle cx="410" cy="132" r="114" fill="#dbe8ce" opacity=".23" />
      <circle cx="490" cy="73" r="24" fill="#e1c883" opacity=".85" />
      <path d="M61 259L303 172L558 257L318 349Z" fill="#b6cfa0" opacity=".13" />
      <path
        d="M106 223L303 155L507 223V260L310 332L106 260Z"
        fill={`url(#soil${variant})`}
      />
      <path d="M106 223L302 154L507 223L310 295Z" fill="#93a97b" />
      <path d="M130 224L303 166L481 224L310 281Z" fill="#4e6650" />
      {[0, 1, 2, 3, 4, 5].map((n) => (
        <g
          key={n}
          className="sprout"
          style={{ animationDelay: `${n * 0.5}s` }}
          transform={`translate(${178 + (n % 3) * 100} ${204 + Math.floor(n / 3) * 35 - (n % 3) * 10})`}
        >
          <path
            d="M0 0V-63"
            stroke="#bfce98"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <path
            d="M0-27C-44-19-50-49-45-61C-15-64 0-46 0-27Z"
            fill={`url(#leaf${variant})`}
          />
          <path d="M0-44C35-40 49-64 45-78C21-83 2-63 0-44Z" fill="#b5c98e" />
          <path
            d="M0-62C-18-71-21-94-11-108C8-100 13-78 0-62Z"
            fill="#84ab75"
          />
          {variant === 1 && (
            <>
              <circle cx="-38" cy="-62" r="10" fill="#b5a6d2" />
              <circle cx="-13" cy="-106" r="10" fill="#c5b5dc" />
            </>
          )}
        </g>
      ))}
      <path
        d="M130 250L312 310L486 251"
        stroke="#cad8b1"
        strokeWidth="3"
        opacity=".35"
      />
      <path
        d="M80 241V293H139"
        stroke="#719b8c"
        strokeWidth="13"
        strokeLinecap="round"
      />
      <circle cx="80" cy="232" r="17" fill="#d1dcbf" />
      <circle cx="80" cy="232" r="7" fill="#5b8470" />
      {watering &&
        [0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
          <circle
            key={n}
            className="waterdrop"
            cx={155 + n * 43}
            cy={115 + (n % 2) * 30}
            r="4"
            fill="#91d5de"
            style={{ animationDelay: `${n * 0.2}s` }}
          />
        ))}
      <g transform="translate(492 286)">
        <path
          d="M0 0C0-13 18-31 18-31S36-13 36 0A18 18 0 0 1 0 0Z"
          fill="#96bfa5"
        />
        <path
          d="M9 0C9 6 14 9 18 9"
          stroke="#e3eed8"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </g>
      <path
        d="M94 101L97 90L100 101L111 104L100 107L97 118L94 107L83 104Z"
        fill="#c8d6aa"
      />
    </svg>
  );
}
