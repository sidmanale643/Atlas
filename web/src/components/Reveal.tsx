import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { EASE, fadeUp } from "../lib/motion";

/* Scroll-reveal primitive: rises + fades the first time it scrolls into view,
   then stays put (`once: true`). Drop it around any section or card.
   `delay` offsets a single element; for sibling cascades wrap them in a
   <motion.* variants={staggerContainer}> instead. */
export default function Reveal({
  children,
  className,
  delay = 0,
  amount = 0.3,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  amount?: number;
}) {
  return (
    <motion.div
      className={className}
      variants={fadeUp}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount }}
      transition={{ duration: 0.4, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}
