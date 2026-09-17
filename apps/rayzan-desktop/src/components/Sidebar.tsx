import { NAV_ITEMS, type ProductPage } from '../navigation.js';
import rayzanLogo from '../assets/branding/rayzan-logo-tagline-white-cropped.png';

export function Sidebar(input: {
  readonly page: ProductPage;
  readonly runtimeReady: boolean;
  readonly connecting: boolean;
  readonly onNavigate: (page: ProductPage) => void;
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <img
          className="brand-logo"
          src={rayzanLogo}
          alt="Rayzan — From many perspectives."
          draggable={false}
        />
      </div>

      <nav className="side-nav" aria-label="Main">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.id === input.page ? 'nav-item active' : 'nav-item'}
            onClick={() => {
              input.onNavigate(item.id);
            }}
          >
            <span className="nav-icon" aria-hidden="true">
              {icon(item.id)}
            </span>
            {item.label}
          </button>
        ))}
      </nav>

      <div className="side-bottom">
        <p className="side-quote">
          Better questions. Broader perspectives. Clearer decisions.
        </p>
        <div className="side-footer">
          <span
            className={
              input.connecting
                ? 'dot'
                : input.runtimeReady
                  ? 'dot ok'
                  : 'dot warn'
            }
            aria-hidden="true"
          />
          {input.connecting
            ? 'Connecting…'
            : input.runtimeReady
              ? 'Runtime connected'
              : 'Runtime stopped'}
        </div>
      </div>
    </aside>
  );
}

function icon(page: ProductPage) {
  const props = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (page) {
    case 'home':
      return (
        <svg {...props}>
          <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" />
        </svg>
      );
    case 'new-decision':
      return (
        <svg {...props}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case 'active-decision':
    case 'debates':
      return (
        <svg {...props}>
          <path d="M5 7h14M5 12h14M5 17h10" />
        </svg>
      );
    case 'library':
      return (
        <svg {...props}>
          <path d="M4 5h7v7H4V5Zm9 0h7v7h-7V5ZM4 14h7v7H4v-7Zm9 0h7v7h-7v-7Z" />
        </svg>
      );
    case 'settings':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v2.2M12 18.8V21M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M3 12h2.2M18.8 12H21M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6" />
        </svg>
      );
  }
}
