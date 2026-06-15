import styles from "./Skeleton.module.css";

/* Phosphor shimmer placeholder. `block` is a generic bar; `Skeleton.Row`
   renders a full table row with `cols` shimmer cells for catalog loading. */
export default function Skeleton({
  width = "100%",
  height = 12,
  className,
}: {
  width?: number | string;
  height?: number | string;
  className?: string;
}) {
  return (
    <span
      className={`${styles.block} ${className ?? ""}`}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}

/* A shimmering <tr> sized to a column count — used in place of catalog rows
   while a page of results is loading. */
export function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr className={styles.row} aria-hidden="true">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className={styles.cell}>
          <span
            className={styles.block}
            style={{ width: `${50 + ((i * 37) % 45)}%`, height: 12 }}
          />
        </td>
      ))}
    </tr>
  );
}
