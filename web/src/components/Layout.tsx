import { NavLink, Outlet, Link } from "react-router-dom";
import styles from "./Layout.module.css";

const NAV = [
  // Atlas wraps the self-booting legacy brain module; enter it via full document
  // load so the module re-initializes cleanly on every visit.
  { to: "/atlas", label: "Atlas", reload: true },
  { to: "/memories", label: "Memories" },
  { to: "/entities", label: "Entities" },
  { to: "/graph", label: "Graph" },
];

export default function Layout() {
  return (
    <div className={styles.shell}>
      <header className={styles.bar}>
        <Link to="/" className={styles.brand}>
          <span className={styles.mark} aria-hidden="true">◍</span>
          <span className={styles.word}>Neurogram</span>
        </Link>
        <nav className={styles.nav} aria-label="Primary">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              reloadDocument={item.reload}
              className={({ isActive }) =>
                isActive ? `${styles.link} ${styles.linkActive}` : styles.link
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
