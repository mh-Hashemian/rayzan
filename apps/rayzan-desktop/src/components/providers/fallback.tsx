export function FallbackLogo(input: { readonly size?: number }) {
  const size = input.size ?? 36;
  return (
    <span
      className="provider-logo-frame"
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        aria-hidden="true"
        className="provider-logo"
      >
        <circle cx="16" cy="16" r="15" fill="#2a3b4c" />
        <path
          d="M16 5 L18.5 14 L28 16 L18.5 18 L16 27 L13.5 18 L4 16 L13.5 14 Z"
          fill="#dce7f2"
        />
      </svg>
    </span>
  );
}
