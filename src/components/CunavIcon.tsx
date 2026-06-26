export default function CunavIcon({ className = "w-8 h-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <rect width="32" height="32" rx="8" fill="#7c3aed"/>
      {/* ticket body */}
      <rect x="4" y="9" width="24" height="14" rx="2.5" fill="white" opacity="0.15"/>
      {/* left notch */}
      <circle cx="4" cy="16" r="3" fill="#7c3aed"/>
      {/* right notch */}
      <circle cx="28" cy="16" r="3" fill="#7c3aed"/>
      {/* ticket text lines */}
      <rect x="8" y="13" width="11" height="2" rx="1" fill="white"/>
      <rect x="8" y="17" width="7" height="2" rx="1" fill="white" opacity="0.6"/>
      {/* star badge top-right */}
      <circle cx="22" cy="13" r="4" fill="#7c3aed"/>
      <circle cx="22" cy="13" r="3.5" fill="white" opacity="0.9"/>
      <path d="M22 10.8l.6 1.8h1.9l-1.5 1.1.6 1.8-1.6-1.2-1.6 1.2.6-1.8-1.5-1.1h1.9z" fill="#7c3aed"/>
    </svg>
  );
}
