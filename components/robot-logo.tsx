import { useId } from "react";

type RobotLogoProps = {
  className?: string;
};

export function RobotLogo({ className }: RobotLogoProps) {
  const id = useId();

  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${id}-shell`} x1="13" y1="13" x2="50" y2="49" gradientUnits="userSpaceOnUse">
          <stop stopColor="#52D6B2" />
          <stop offset=".48" stopColor="#20A98A" />
          <stop offset="1" stopColor="#087461" />
        </linearGradient>
        <linearGradient id={`${id}-side`} x1="42" y1="19" x2="51" y2="42" gradientUnits="userSpaceOnUse">
          <stop stopColor="#168C7A" />
          <stop offset="1" stopColor="#075C50" />
        </linearGradient>
        <linearGradient id={`${id}-face`} x1="21" y1="23" x2="44" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#233C50" />
          <stop offset="1" stopColor="#102737" />
        </linearGradient>
        <linearGradient id={`${id}-body`} x1="20" y1="45" x2="44" y2="60" gradientUnits="userSpaceOnUse">
          <stop stopColor="#46CDA9" />
          <stop offset="1" stopColor="#0A806D" />
        </linearGradient>
        <filter id={`${id}-shadow`} x="5" y="5" width="56" height="59" colorInterpolationFilters="sRGB" filterUnits="userSpaceOnUse">
          <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#163D39" floodOpacity=".24" />
        </filter>
      </defs>
      <ellipse cx="32" cy="58" rx="14" ry="3" fill="#153B35" fillOpacity=".14" />
      <g filter={`url(#${id}-shadow)`}>
        <path d="M32 10V15" stroke="#168C7A" strokeWidth="3" strokeLinecap="round" />
        <circle cx="32" cy="8" r="3.2" fill="#51D7B3" stroke="#0A806D" strokeWidth="1.5" />
        <rect x="11" y="27" width="7" height="13" rx="3.5" fill="#108675" />
        <rect x="46" y="27" width="7" height="13" rx="3.5" fill="#0A695A" />
        <path d="M19 44.5C19 41.46 21.46 39 24.5 39H39.5C42.54 39 45 41.46 45 44.5V53H19V44.5Z" fill={`url(#${id}-body)`} />
        <path d="M25 42H39" stroke="#B7F5E3" strokeOpacity=".7" strokeWidth="1.5" strokeLinecap="round" />
        <rect x="29" y="45" width="6" height="3" rx="1.5" fill="#0B6D5D" fillOpacity=".58" />
        <path d="M17 22C17 18.69 19.69 16 23 16H40C43.31 16 46 18.69 46 22V37C46 40.31 43.31 43 40 43H23C19.69 43 17 40.31 17 37V22Z" fill={`url(#${id}-shell)`} />
        <path d="M39 16H40C43.31 16 46 18.69 46 22V37C46 40.31 43.31 43 40 43H37.5C41.09 39.05 42.8 32.6 42.8 25.95C42.8 22.03 41.48 18.61 39 16Z" fill={`url(#${id}-side)`} />
        <path d="M22 18.5C24.75 16.3 36.22 16.12 39.7 18.33" stroke="#C1F8E8" strokeOpacity=".65" strokeWidth="1.5" strokeLinecap="round" />
        <rect x="21" y="23" width="22" height="15" rx="6" fill={`url(#${id}-face)`} />
        <path d="M24 25.5C27.14 23.45 36.48 23.45 39.6 25.5" stroke="#7899A4" strokeOpacity=".5" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="27.5" cy="30" r="2" fill="#C8FFF0" />
        <circle cx="36.5" cy="30" r="2" fill="#C8FFF0" />
        <path d="M28.5 34C30.4 35.6 33.6 35.6 35.5 34" stroke="#55D9B6" strokeWidth="1.7" strokeLinecap="round" />
      </g>
    </svg>
  );
}
