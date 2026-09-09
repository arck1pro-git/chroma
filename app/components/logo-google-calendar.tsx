import type { SVGProps } from "react";

// Google Calendar em traço único (currentColor), como a logo da Meta: o mark
// original é o quadrado colorido com o "31", mas cor de marca no meio da UI
// cinza destoaria. Monocromático, ainda lê como "calendário do Google" ao lado
// do rótulo — o "31" é o que o distingue de um ícone de calendário qualquer.
export default function LogoGoogleCalendar(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <rect
        x="4.5"
        y="4.5"
        width="15"
        height="15"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M8 3v3M16 3v3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <text
        x="12"
        y="16.2"
        textAnchor="middle"
        fontSize="7.5"
        fontWeight="700"
        fontFamily="Helvetica, Arial, sans-serif"
        fill="currentColor"
      >
        31
      </text>
    </svg>
  );
}
