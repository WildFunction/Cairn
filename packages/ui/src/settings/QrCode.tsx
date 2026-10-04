import { useMemo } from 'react';
import type { ReactElement } from 'react';
import qrcode from 'qrcode-generator';

/** The quiet zone the QR spec asks for, in modules. */
const MARGIN = 4;

/** One path of unit squares, one per dark module. */
export function qrPath(text: string): { readonly size: number; readonly d: string } {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  const cells: string[] = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (qr.isDark(row, col)) cells.push(`M${col} ${row}h1v1h-1z`);
    }
  }
  return { size, d: cells.join('') };
}

/** Always black on white, whatever the theme: a phone camera cannot read a dark-mode code. */
export function QrCode({ text, label }: { text: string; label: string }): ReactElement {
  const { size, d } = useMemo(() => qrPath(text), [text]);
  const span = size + MARGIN * 2;
  return (
    <svg
      className="set-qr"
      viewBox={`${-MARGIN} ${-MARGIN} ${span} ${span}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect x={-MARGIN} y={-MARGIN} width={span} height={span} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
