export function PdfBadgeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"
        fill="#e53e3e"
      />
      <path d="M14 2v4a1 1 0 0 0 1 1h4" fill="#fca5a5" />
      <text
        x="12"
        y="17.5"
        textAnchor="middle"
        fontSize="7"
        fontWeight="700"
        fontFamily="var(--font-sans, sans-serif)"
        fill="#ffffff"
      >
        PDF
      </text>
    </svg>
  );
}
