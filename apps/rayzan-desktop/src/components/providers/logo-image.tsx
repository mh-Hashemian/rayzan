export function LogoImage(input: {
  readonly src: string;
  readonly size?: number;
}) {
  const size = input.size ?? 36;
  return (
    <span
      className="provider-logo-frame"
      style={{ width: size, height: size }}
    >
      <img
        src={input.src}
        alt=""
        width={size}
        height={size}
        className="provider-logo"
        draggable={false}
      />
    </span>
  );
}
