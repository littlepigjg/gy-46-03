import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';

const GRID_COLS = 16;
const GRID_ROWS = 16;
const PIXEL_DIFF_THRESHOLD = 30;
const MIN_DIFF_REGION_SIZE = 3;

function loadPNG(filePath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      reject(new Error(`文件不存在: ${filePath}`));
      return;
    }
    const data = fs.readFileSync(filePath);
    const png = new PNG();
    png.parse(data, (err, img) => {
      if (err) reject(err);
      else resolve(img);
    });
  });
}

function resizeImageData(img, targetWidth, targetHeight) {
  const srcData = img.data;
  const srcWidth = img.width;
  const srcHeight = img.height;
  const dst = new PNG({ width: targetWidth, height: targetHeight });
  const dstData = dst.data;

  const xRatio = srcWidth / targetWidth;
  const yRatio = srcHeight / targetHeight;

  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      const srcX = Math.floor(x * xRatio);
      const srcY = Math.floor(y * yRatio);
      const srcIdx = (srcY * srcWidth + srcX) << 2;
      const dstIdx = (y * targetWidth + x) << 2;
      dstData[dstIdx] = srcData[srcX];
      dstData[dstIdx + 1] = srcData[srcIdx + 1];
      dstData[dstIdx + 2] = srcData[srcIdx + 2];
      dstData[dstIdx + 3] = srcData[srcIdx + 3];
    }
  }
  return dst;
}

function getPixelColor(data, x, y, width) {
  const idx = (y * width + x) << 2;
  return {
    r: data[idx],
    g: data[idx + 1],
    b: data[idx + 2],
    a: data[idx + 3]
  };
}

function colorDistance(c1, c2) {
  const dr = c1.r - c2.r;
  const dg = c1.g - c2.g;
  const db = c1.b - c2.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function grayscaleValue(c) {
  return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
}

function computeGridDiffs(img1, img2) {
  const width = Math.min(img1.width, img2.width);
  const height = Math.min(img1.height, img2.height);
  const cellWidth = Math.floor(width / GRID_COLS);
  const cellHeight = Math.floor(height / GRID_ROWS);

  const gridDiffs = [];
  const gridGrays1 = [];
  const gridGrays2 = [];
  const gridColors1 = [];
  const gridColors2 = [];

  for (let gy = 0; gy < GRID_ROWS; gy++) {
    for (let gx = 0; gx < GRID_COLS; gx++) {
      let totalDiff = 0;
      let totalGray1 = 0;
      let totalGray2 = 0;
      let totalR1 = 0, totalG1 = 0, totalB1 = 0;
      let totalR2 = 0, totalG2 = 0, totalB2 = 0;
      let pixelCount = 0;

      const startX = gx * cellWidth;
      const startY = gy * cellHeight;
      const endX = Math.min(startX + cellWidth, width);
      const endY = Math.min(startY + cellHeight, height);

      for (let y = startY; y < endY; y += 4) {
        for (let x = startX; x < endX; x += 4) {
          const c1 = getPixelColor(img1.data, x, y, img1.width);
          const c2 = getPixelColor(img2.data, x, y, img2.width);
          totalDiff += colorDistance(c1, c2);
          totalGray1 += grayscaleValue(c1);
          totalGray2 += grayscaleValue(c2);
          totalR1 += c1.r; totalG1 += c1.g; totalB1 += c1.b;
          totalR2 += c2.r; totalG2 += c2.g; totalB2 += c2.b;
          pixelCount++;
        }
      }

      const avgDiff = pixelCount > 0 ? totalDiff / pixelCount / 441.67 : 0;
      const avgGray1 = pixelCount > 0 ? totalGray1 / pixelCount : 0;
      const avgGray2 = pixelCount > 0 ? totalGray2 / pixelCount : 0;

      gridDiffs.push(avgDiff);
      gridGrays1.push(avgGray1);
      gridGrays2.push(avgGray2);
      gridColors1.push({
        r: pixelCount > 0 ? totalR1 / pixelCount : 0,
        g: pixelCount > 0 ? totalG1 / pixelCount : 0,
        b: pixelCount > 0 ? totalB1 / pixelCount : 0
      });
      gridColors2.push({
        r: pixelCount > 0 ? totalR2 / pixelCount : 0,
        g: pixelCount > 0 ? totalG2 / pixelCount : 0,
        b: pixelCount > 0 ? totalB2 / pixelCount : 0
      });
    }
  }

  return { gridDiffs, gridGrays1, gridGrays2, gridColors1, gridColors2, width, height };
}

function computeLayoutScore(gridDiffs) {
  let changedCells = 0;
  let edgeChanges = 0;

  for (let gy = 0; gy < GRID_ROWS; gy++) {
    for (let gx = 0; gx < GRID_COLS; gx++) {
      const idx = gy * GRID_COLS + gx;
      if (gridDiffs[idx] > 0.08) {
        changedCells++;
        if (gx === 0 || gx === GRID_COLS - 1 || gy === 0 || gy === GRID_ROWS - 1) {
          edgeChanges++;
        }
        const neighbors = [
          [gx - 1, gy], [gx + 1, gy], [gx, gy - 1], [gx, gy + 1]
        ];
        let isolated = true;
        for (const [nx, ny] of neighbors) {
          if (nx >= 0 && nx < GRID_COLS && ny >= 0 && ny < GRID_ROWS) {
            const nIdx = ny * GRID_COLS + nx;
            if (gridDiffs[nIdx] > 0.08) {
              isolated = false;
              break;
            }
          }
        }
        if (isolated) changedCells -= 0.5;
      }
    }
  }

  changedCells = Math.max(0, changedCells);
  const layoutScore = changedCells / (GRID_COLS * GRID_ROWS);

  let structuralShift = 0;
  for (let gy = 0; gy < GRID_ROWS; gy++) {
    for (let gx = 0; gx < GRID_COLS - 1; gx++) {
      const idx1 = gy * GRID_COLS + gx;
      const idx2 = gy * GRID_COLS + gx + 1;
      structuralShift += Math.abs(gridDiffs[idx1] - gridDiffs[idx2]);
    }
  }
  for (let gx = 0; gx < GRID_COLS; gx++) {
    for (let gy = 0; gy < GRID_ROWS - 1; gy++) {
      const idx1 = gy * GRID_COLS + gx;
      const idx2 = (gy + 1) * GRID_COLS + gx;
      structuralShift += Math.abs(gridDiffs[idx1] - gridDiffs[idx2]);
    }
  }
  structuralShift = structuralShift / (GRID_COLS * (GRID_ROWS - 1) + GRID_ROWS * (GRID_COLS - 1));

  return Math.min(1, layoutScore * 0.7 + structuralShift * 0.3);
}

function computeContentScore(gridGrays1, gridGrays2, gridDiffs) {
  let contentDiffSum = 0;
  let significantChanges = 0;

  for (let i = 0; i < gridGrays1.length; i++) {
    const grayDiff = Math.abs(gridGrays1[i] - gridGrays2[i]) / 255;
    contentDiffSum += grayDiff;

    if (gridDiffs[i] > 0.12) {
      significantChanges++;
    }
  }

  const avgGrayDiff = contentDiffSum / gridGrays1.length;
  const significantRatio = significantChanges / gridGrays1.length;

  let clusters = 0;
  const visited = new Set();
  for (let gy = 0; gy < GRID_ROWS; gy++) {
    for (let gx = 0; gx < GRID_COLS; gx++) {
      const idx = gy * GRID_COLS + gx;
      if (!visited.has(idx) && gridDiffs[idx] > 0.1) {
        clusters++;
        const stack = [[gx, gy]];
        while (stack.length > 0) {
          const [cx, cy] = stack.pop();
          const cIdx = cy * GRID_COLS + cx;
          if (visited.has(cIdx)) continue;
          visited.add(cIdx);
          const neighbors = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]];
          for (const [nx, ny] of neighbors) {
            if (nx >= 0 && nx < GRID_COLS && ny >= 0 && ny < GRID_ROWS) {
              const nIdx = ny * GRID_COLS + nx;
              if (!visited.has(nIdx) && gridDiffs[nIdx] > 0.06) {
                stack.push([nx, ny]);
              }
            }
          }
        }
      }
    }
  }

  const clusterFactor = Math.min(1, clusters / 4);

  return Math.min(1, avgGrayDiff * 0.4 + significantRatio * 0.4 + clusterFactor * 0.2);
}

function computeStyleScore(gridColors1, gridColors2, gridDiffs) {
  let colorShiftSum = 0;
  let hueShiftCells = 0;

  for (let i = 0; i < gridColors1.length; i++) {
    const c1 = gridColors1[i];
    const c2 = gridColors2[i];

    const dist = colorDistance(c1, c2) / 441.67;
    colorShiftSum += dist;

    const max1 = Math.max(c1.r, c1.g, c1.b);
    const max2 = Math.max(c2.r, c2.g, c2.b);
    const min1 = Math.min(c1.r, c1.g, c1.b);
    const min2 = Math.min(c2.r, c2.g, c2.b);

    if (max1 - min1 > 30 || max2 - min2 > 30) {
      let hue1 = 0, hue2 = 0;
      if (max1 - min1 > 0) {
        if (max1 === c1.r) hue1 = ((c1.g - c1.b) / (max1 - min1)) % 6;
        else if (max1 === c1.g) hue1 = (c1.b - c1.r) / (max1 - min1) + 2;
        else hue1 = (c1.r - c1.g) / (max1 - min1) + 4;
      }
      if (max2 - min2 > 0) {
        if (max2 === c2.r) hue2 = ((c2.g - c2.b) / (max2 - min2)) % 6;
        else if (max2 === c2.g) hue2 = (c2.b - c2.r) / (max2 - min2) + 2;
        else hue2 = (c2.r - c2.g) / (max2 - min2) + 4;
      }
      if (Math.abs(hue1 - hue2) > 1) {
        hueShiftCells++;
      }
    }
  }

  const avgColorShift = colorShiftSum / gridColors1.length;
  const hueShiftRatio = hueShiftCells / gridColors1.length;

  let contrastDiff = 0;
  for (let gy = 0; gy < GRID_ROWS; gy++) {
    for (let gx = 0; gx < GRID_COLS; gx++) {
      const idx = gy * GRID_COLS + gx;
      let neighbors = [];
      if (gx > 0) neighbors.push(idx - 1);
      if (gx < GRID_COLS - 1) neighbors.push(idx + 1);
      if (gy > 0) neighbors.push(idx - GRID_COLS);
      if (gy < GRID_ROWS - 1) neighbors.push(idx + GRID_COLS);

      let localContrast1 = 0, localContrast2 = 0;
      for (const nIdx of neighbors) {
        localContrast1 += Math.abs(grayscaleValue(gridColors1[idx]) - grayscaleValue(gridColors1[nIdx]));
        localContrast2 += Math.abs(grayscaleValue(gridColors2[idx]) - grayscaleValue(gridColors2[nIdx]));
      }
      contrastDiff += Math.abs(localContrast1 - localContrast2) / (neighbors.length * 255);
    }
  }
  contrastDiff = contrastDiff / gridColors1.length;

  return Math.min(1, avgColorShift * 0.5 + hueShiftRatio * 0.3 + contrastDiff * 0.2);
}

function findDiffRegions(gridDiffs, threshold = 0.08) {
  const regions = [];
  const visited = new Set();

  for (let gy = 0; gy < GRID_ROWS; gy++) {
    for (let gx = 0; gx < GRID_COLS; gx++) {
      const startIdx = gy * GRID_COLS + gx;
      if (visited.has(startIdx) || gridDiffs[startIdx] <= threshold) continue;

      let minX = gx, maxX = gx, minY = gy, maxY = gy;
      let size = 0;
      let totalDiff = 0;

      const stack = [[gx, gy]];
      while (stack.length > 0) {
        const [cx, cy] = stack.pop();
        const cIdx = cy * GRID_COLS + cx;
        if (visited.has(cIdx)) continue;
        visited.add(cIdx);

        minX = Math.min(minX, cx);
        maxX = Math.max(maxX, cx);
        minY = Math.min(minY, cy);
        maxY = Math.max(maxY, cy);
        size++;
        totalDiff += gridDiffs[cIdx];

        const neighbors = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]];
        for (const [nx, ny] of neighbors) {
          if (nx >= 0 && nx < GRID_COLS && ny >= 0 && ny < GRID_ROWS) {
            const nIdx = ny * GRID_COLS + nx;
            if (!visited.has(nIdx) && gridDiffs[nIdx] > threshold * 0.6) {
              stack.push([nx, ny]);
            }
          }
        }
      }

      if (size >= MIN_DIFF_REGION_SIZE) {
        regions.push({
          x: minX / GRID_COLS,
          y: minY / GRID_ROWS,
          width: (maxX - minX + 1) / GRID_COLS,
          height: (maxY - minY + 1) / GRID_ROWS,
          gridX: minX,
          gridY: minY,
          gridW: maxX - minX + 1,
          gridH: maxY - minY + 1,
          size,
          avgDiff: totalDiff / size
        });
      }
    }
  }

  return regions.sort((a, b) => b.avgDiff - a.avgDiff).slice(0, 10);
}

function detectChangeTypes(scores, thresholds, regions) {
  const types = [];

  if (scores.layout > thresholds.layout_threshold) {
    types.push({ type: 'layout', severity: scores.layout, description: '页面布局变化' });
  }
  if (scores.content > thresholds.content_threshold) {
    types.push({ type: 'content', severity: scores.content, description: '内容增删变化' });
  }
  if (scores.style > thresholds.style_threshold) {
    types.push({ type: 'style', severity: scores.style, description: '样式/配色调整' });
  }

  if (types.length === 0 && scores.overall > 0.02) {
    types.push({ type: 'minor', severity: scores.overall, description: '轻微变化' });
  }

  return types;
}

export async function compareImages(imagePath1, imagePath2, thresholds = null) {
  const defaultThresholds = {
    overall_threshold: 0.05,
    layout_threshold: 0.10,
    content_threshold: 0.05,
    style_threshold: 0.08
  };
  const effectiveThresholds = thresholds || defaultThresholds;

  const [img1, img2] = await Promise.all([
    loadPNG(imagePath1),
    loadPNG(imagePath2)
  ]);

  const targetWidth = 256;
  const targetHeight = 256;
  const resized1 = resizeImageData(img1, targetWidth, targetHeight);
  const resized2 = resizeImageData(img2, targetWidth, targetHeight);

  const { gridDiffs, gridGrays1, gridGrays2, gridColors1, gridColors2, width, height } =
    computeGridDiffs(resized1, resized2);

  const layoutScore = computeLayoutScore(gridDiffs);
  const contentScore = computeContentScore(gridGrays1, gridGrays2, gridDiffs);
  const styleScore = computeStyleScore(gridColors1, gridColors2, gridDiffs);

  const overallScore = (layoutScore * 0.35 + contentScore * 0.40 + styleScore * 0.25);

  const regions = findDiffRegions(gridDiffs);

  const scores = {
    overall: overallScore,
    layout: layoutScore,
    content: contentScore,
    style: styleScore
  };

  const changeTypes = detectChangeTypes(scores, effectiveThresholds, regions);

  const shouldAlert = overallScore > effectiveThresholds.overall_threshold ||
    layoutScore > effectiveThresholds.layout_threshold ||
    contentScore > effectiveThresholds.content_threshold ||
    styleScore > effectiveThresholds.style_threshold;

  return {
    scores,
    changeTypes,
    regions,
    shouldAlert,
    metadata: {
      image1Size: { width: img1.width, height: img1.height },
      image2Size: { width: img2.width, height: img2.height },
      analysisSize: { width: targetWidth, height: targetHeight }
    }
  };
}

export default { compareImages };
