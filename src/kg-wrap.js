/**
 * Break wide ranks into multiple sub-rows for a squarer overall aspect ratio.
 */
export function targetRowWidth(widths, numLayers, { aspect = 1.05, min = 420, max = 680 } = {}) {
  const sumW = [...widths.values()].reduce((s, w) => s + (typeof w === "object" ? w.width : w), 0);
  const avgH = 26;
  const area = sumW * Math.max(4, numLayers) * avgH;
  const target = Math.sqrt(area / aspect);
  return Math.max(min, Math.min(max, target));
}

export function wrapLayersToRows(layers, widths, maxRowWidth, gapX = 10) {
  const out = [];
  for (const layer of layers) {
    if (!layer.length) continue;
    const rows = [];
    let row = [];
    let w = 0;
    for (const id of layer) {
      const nw = (widths.get(id)?.width ?? widths.get(id) ?? 52) + gapX;
      if (w + nw > maxRowWidth && row.length > 0) {
        rows.push(row);
        row = [];
        w = 0;
      }
      row.push(id);
      w += nw;
    }
    if (row.length) rows.push(row);
    for (const r of rows) out.push(r);
  }
  return out;
}

/** Place nodes row-by-row; returns laid items with x, y, _dagY. */
export function assignRowCoordinates(
  virtualLayers,
  widths,
  rankMeta,
  { gapX = 10, rowGap = 20, startY = 20 } = {},
) {
  const metaById = rankMeta;
  let y = startY;
  const placed = new Map();
  const rowWidths = virtualLayers.map((layer) => {
    let w = gapX;
    for (const id of layer) {
      const size = widths.get(id) ?? { width: 52, height: 22 };
      w += size.width + gapX;
    }
    return w;
  });
  const globalMaxX = Math.max(...rowWidths, gapX);

  for (let ri = 0; ri < virtualLayers.length; ri += 1) {
    const layer = virtualLayers[ri];
    const maxH = Math.max(...layer.map((id) => widths.get(id)?.height ?? 22));
    const rowW = rowWidths[ri];
    const offset = (globalMaxX - rowW) / 2;
    let x = gapX + offset;
    for (const id of layer) {
      const size = widths.get(id) ?? { width: 52, height: 22 };
      const cx = x + size.width / 2;
      placed.set(id, {
        id,
        x: cx,
        y: y + maxH / 2,
        _dagY: y + maxH / 2,
        width: size.width,
        height: size.height,
        layer: metaById?.get(id)?.layer,
        band: metaById?.get(id)?.band,
      });
      x += size.width + gapX;
    }
    y += maxH + rowGap;
  }

  return { placed, height: y, width: globalMaxX };
}
