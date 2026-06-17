import { useEffect, useState } from "react";
import { NavLink, Outlet, Link, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { staggerContainer, fadeUp } from "../lib/motion";
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
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();
  const isAtlas = location.pathname === "/atlas";

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className={styles.shell}>
      <motion.header
        className={`${styles.bar} ${scrolled ? styles.barScrolled : ""}`}
        initial="hidden"
        animate="show"
        variants={staggerContainer}
      >
        <motion.div variants={fadeUp}>
          <Link to="/" className={styles.brand}>
            <span className={styles.mark} aria-hidden="true">◍</span>
            <span className={styles.word}>Atlas</span>
          </Link>
        </motion.div>
        <nav className={styles.nav} aria-label="Primary">
          {NAV.map((item, i) => (
            <motion.div key={item.to} variants={fadeUp} custom={i}>
              <NavLink
                to={item.to}
                reloadDocument={item.reload}
                className={({ isActive }) =>
                  isActive ? `${styles.link} ${styles.linkActive}` : styles.link
                }
              >
                {item.label}
              </NavLink>
            </motion.div>
          ))}
        </nav>
      </motion.header>
      <main className={`${styles.main} ${isAtlas ? styles.mainAtlas : ""}`}>
        <Outlet />
      </main>
    </div>
  );
}
