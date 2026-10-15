import { display } from "../lib/i18n";
/** Decorative botanical illustration adapted from the team-provided ANBIT design. */
export default function GardenIllustration() {
  return (
    <svg
      viewBox="0 0 600 360"
      role="img"
      aria-label={display("رسم توضيحي لمسطح أخضر ونباتات")}
      className="anbit-garden-art"
    >
      <defs>
        <linearGradient id="unified-soil" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#53715a" />
          <stop offset="1" stopColor="#203d30" />
        </linearGradient>
        <linearGradient id="unified-leaf">
          <stop stopColor="#a7c68b" />
          <stop offset="1" stopColor="#488566" />
        </linearGradient>
      </defs>
      <circle cx="410" cy="132" r="114" fill="#dbe8ce" opacity=".18" />
      <circle cx="490" cy="73" r="24" fill="#e1c883" opacity=".85" />
      <path d="M61 259L303 172L558 257L318 349Z" fill="#b6cfa0" opacity=".15" />
      <path
        d="M106 223L303 155L507 223V260L310 332L106 260Z"
        fill="url(#unified-soil)"
      />
      <path d="M106 223L302 154L507 223L310 295Z" fill="#93a97b" />
      <path d="M130 224L303 166L481 224L310 281Z" fill="#4e6650" />
      {display(
        [0, 1, 2, 3, 4, 5].map((n) => (
          <g
            key={n}
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
              fill="url(#unified-leaf)"
            />
            <path d="M0-44C35-40 49-64 45-78C21-83 2-63 0-44Z" fill="#b5c98e" />
            <path
              d="M0-62C-18-71-21-94-11-108C8-100 13-78 0-62Z"
              fill="#84ab75"
            />
          </g>
        )),
      )}
      <path
        d="M130 250L312 310L486 251"
        stroke="#cad8b1"
        strokeWidth="3"
        opacity=".35"
        fill="none"
      />
      <path
        d="M80 241V293H139"
        stroke="#719b8c"
        strokeWidth="13"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="80" cy="232" r="17" fill="#d1dcbf" />
      <circle cx="80" cy="232" r="7" fill="#5b8470" />
      <path
        d="M510 294C510 281 528 263 528 263S546 281 546 294A18 18 0 0 1 510 294Z"
        fill="#96bfa5"
      />
    </svg>
  );
}
