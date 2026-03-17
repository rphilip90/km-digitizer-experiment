// Auto-detection module - automatically traces curves by color
const AutoDetect = {
    // Detection settings
    colorTolerance: 30,      // How similar colors need to be (0-255)
    sampleInterval: 2,       // Pixels between samples when tracing
    minPoints: 5,            // Minimum points to consider valid curve

    // Colors to ignore (backgrounds, grids, axes)
    ignoredColors: [
        { r: 255, g: 255, b: 255 },  // White
        { r: 0, g: 0, b: 0 },        // Black
        { r: 128, g: 128, b: 128 },  // Gray
        { r: 200, g: 200, b: 200 },  // Light gray
        { r: 240, g: 240, b: 240 },  // Very light gray
    ],

    // Detect and trace a curve starting from a clicked point
    detectCurve(startX, startY, imageData, width, height) {
        // Get the color at the clicked point
        const targetColor = this.getPixelColor(imageData, startX, startY, width);

        if (!targetColor) return [];

        // Find all pixels matching this color
        const matchingPixels = this.findMatchingPixels(imageData, width, height, targetColor);

        if (matchingPixels.length < this.minPoints) {
            return [];
        }

        // Sort pixels by X coordinate and extract curve points
        const curvePoints = this.extractCurveFromPixels(matchingPixels, width);

        return curvePoints;
    },

    // Convert a hex color string to RGB
    hexToRgb(hex) {
        if (!hex) return null;

        let normalized = hex.replace('#', '').trim();
        if (normalized.length === 3) {
            normalized = normalized.split('').map(char => char + char).join('');
        }

        if (normalized.length !== 6) return null;

        const value = parseInt(normalized, 16);
        if (Number.isNaN(value)) return null;

        return {
            r: (value >> 16) & 255,
            g: (value >> 8) & 255,
            b: value & 255
        };
    },

    // Get color at a specific pixel
    getPixelColor(imageData, x, y, width) {
        const px = Math.round(x);
        const py = Math.round(y);
        const index = (py * width + px) * 4;

        if (index < 0 || index >= imageData.data.length - 3) {
            return null;
        }

        return {
            r: imageData.data[index],
            g: imageData.data[index + 1],
            b: imageData.data[index + 2]
        };
    },

    // Check whether a point is inside the image bounds
    isWithinBounds(x, y, width, height) {
        return x >= 0 && y >= 0 && x < width && y < height;
    },

    // Check if two colors are similar within tolerance
    colorMatch(color1, color2) {
        if (!color1 || !color2) return false;

        const diff = Math.abs(color1.r - color2.r) +
                     Math.abs(color1.g - color2.g) +
                     Math.abs(color1.b - color2.b);

        return diff <= this.colorTolerance * 3;
    },

    // Find the closest pixel matching the target color near the cursor
    findNearestMatchingPixel(imageData, width, height, targetColor, centerX, centerY, maxRadius = 10) {
        if (!targetColor) return null;

        const originX = Math.round(centerX);
        const originY = Math.round(centerY);
        const radiusSq = maxRadius * maxRadius;

        let bestMatch = null;
        let bestDistanceSq = Infinity;

        const minX = Math.max(0, originX - maxRadius);
        const maxX = Math.min(width - 1, originX + maxRadius);
        const minY = Math.max(0, originY - maxRadius);
        const maxY = Math.min(height - 1, originY + maxRadius);

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const distanceSq = (x - originX) ** 2 + (y - originY) ** 2;
                if (distanceSq > radiusSq || distanceSq >= bestDistanceSq) continue;

                const color = this.getPixelColor(imageData, x, y, width);
                if (!this.colorMatch(color, targetColor)) continue;

                bestDistanceSq = distanceSq;
                bestMatch = {
                    x,
                    y,
                    distance: Math.sqrt(distanceSq)
                };
            }
        }

        return bestMatch;
    },

    // Collect a local connected run of pixels so the hovered curve segment can be highlighted
    collectConnectedPixels(imageData, width, height, targetColor, startX, startY, maxRadius = 18, maxPixels = 250) {
        const originX = Math.round(startX);
        const originY = Math.round(startY);

        if (!this.isWithinBounds(originX, originY, width, height)) {
            return [];
        }

        const seedColor = this.getPixelColor(imageData, originX, originY, width);
        if (!this.colorMatch(seedColor, targetColor)) {
            return [];
        }

        const queue = [{ x: originX, y: originY }];
        const visited = new Set([`${originX},${originY}`]);
        const collected = [];
        const radiusSq = maxRadius * maxRadius;
        let queueIndex = 0;

        while (queueIndex < queue.length && collected.length < maxPixels) {
            const current = queue[queueIndex++];
            collected.push(current);

            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue;

                    const nextX = current.x + dx;
                    const nextY = current.y + dy;
                    const key = `${nextX},${nextY}`;

                    if (visited.has(key) || !this.isWithinBounds(nextX, nextY, width, height)) {
                        continue;
                    }
                    visited.add(key);

                    const distanceSq = (nextX - originX) ** 2 + (nextY - originY) ** 2;
                    if (distanceSq > radiusSq) continue;

                    const nextColor = this.getPixelColor(imageData, nextX, nextY, width);
                    if (this.colorMatch(nextColor, targetColor)) {
                        queue.push({ x: nextX, y: nextY });
                    }
                }
            }
        }

        return collected;
    },

    // Find all pixels matching the target color
    findMatchingPixels(imageData, width, height, targetColor) {
        const matching = [];

        // Sample every few pixels for performance
        for (let y = 0; y < height; y += this.sampleInterval) {
            for (let x = 0; x < width; x += this.sampleInterval) {
                const color = this.getPixelColor(imageData, x, y, width);
                if (this.colorMatch(color, targetColor)) {
                    matching.push({ x, y });
                }
            }
        }

        return matching;
    },

    // Extract curve points from matching pixels
    // Groups by X and takes the vertical center for each X slice
    extractCurveFromPixels(pixels, imageWidth) {
        // Group pixels by X coordinate (binned)
        const binSize = 3;
        const bins = {};

        pixels.forEach(p => {
            const binX = Math.floor(p.x / binSize) * binSize;
            if (!bins[binX]) {
                bins[binX] = [];
            }
            bins[binX].push(p.y);
        });

        // For each X bin, take the median Y value
        const curvePoints = [];
        const sortedXs = Object.keys(bins).map(Number).sort((a, b) => a - b);

        sortedXs.forEach(x => {
            const yValues = bins[x].sort((a, b) => a - b);
            // Take median Y
            const medianY = yValues[Math.floor(yValues.length / 2)];
            curvePoints.push({ x: x + binSize/2, y: medianY });
        });

        // Smooth the curve by removing outliers
        return this.smoothCurve(curvePoints);
    },

    // Simple smoothing to remove outliers
    smoothCurve(points) {
        if (points.length < 3) return points;

        const smoothed = [points[0]];

        for (let i = 1; i < points.length - 1; i++) {
            const prev = points[i - 1];
            const curr = points[i];
            const next = points[i + 1];

            // Check if current point is an outlier (Y jumps too much)
            const avgY = (prev.y + next.y) / 2;
            const maxJump = Math.abs(next.x - prev.x) * 2; // Allow some slope

            if (Math.abs(curr.y - avgY) > maxJump + 20) {
                // Skip outlier, interpolate instead
                smoothed.push({ x: curr.x, y: avgY });
            } else {
                smoothed.push(curr);
            }
        }

        smoothed.push(points[points.length - 1]);

        return smoothed;
    },

    // Reduce number of points while preserving curve shape
    simplifyPoints(points, targetCount = 50) {
        if (points.length <= targetCount) return points;

        const step = Math.floor(points.length / targetCount);
        const simplified = [];

        for (let i = 0; i < points.length; i += step) {
            simplified.push(points[i]);
        }

        // Always include the last point
        if (simplified[simplified.length - 1] !== points[points.length - 1]) {
            simplified.push(points[points.length - 1]);
        }

        return simplified;
    },

    // Check if a color should be ignored (background, grid, etc.)
    isIgnoredColor(color) {
        if (!color) return true;

        // Check if too close to white or black
        const brightness = (color.r + color.g + color.b) / 3;
        if (brightness > 240 || brightness < 15) return true;

        // Check if grayscale (likely grid or axis)
        const maxDiff = Math.max(
            Math.abs(color.r - color.g),
            Math.abs(color.g - color.b),
            Math.abs(color.r - color.b)
        );
        if (maxDiff < 20 && brightness > 100) return true;

        return false;
    },

    // Automatically detect all curves in the calibrated region
    detectAllCurves(imageData, width, height, calibration) {
        // Get the pixel bounds of the calibrated area
        const bounds = this.getCalibrationBounds(calibration);
        if (!bounds) return [];

        // Find all distinct colors that could be curves
        const curveColors = this.findCurveColors(imageData, width, height, bounds);

        if (curveColors.length === 0) {
            return [];
        }

        // Extract curve for each detected color
        const detectedCurves = [];

        curveColors.forEach((colorInfo, index) => {
            const pixels = this.findPixelsOfColor(imageData, width, height, colorInfo.color, bounds);
            const curvePoints = this.extractCurveFromPixels(pixels, width);

            if (curvePoints.length >= this.minPoints) {
                const simplified = this.simplifyPoints(curvePoints, 50);
                detectedCurves.push({
                    color: colorInfo.color,
                    hexColor: this.rgbToHex(colorInfo.color),
                    points: simplified,
                    pixelCount: colorInfo.count
                });
            }
        });

        // Sort by pixel count (most prominent curves first)
        detectedCurves.sort((a, b) => b.pixelCount - a.pixelCount);

        return detectedCurves;
    },

    // Get pixel bounds from calibration
    getCalibrationBounds(calibration) {
        if (!calibration.isComplete) return null;

        const points = calibration.points;
        return {
            left: Math.min(points.xMin.x, points.xMax.x),
            right: Math.max(points.xMin.x, points.xMax.x),
            top: Math.min(points.yMin.y, points.yMax.y),
            bottom: Math.max(points.yMin.y, points.yMax.y)
        };
    },

    // Find all distinct curve colors in the calibrated region
    findCurveColors(imageData, width, height, bounds) {
        const colorCounts = {};
        const sampleStep = 3;

        // Sample pixels in the calibrated region
        for (let y = Math.floor(bounds.top); y < bounds.bottom; y += sampleStep) {
            for (let x = Math.floor(bounds.left); x < bounds.right; x += sampleStep) {
                const color = this.getPixelColor(imageData, x, y, width);
                if (!color || this.isIgnoredColor(color)) continue;

                // Quantize color to reduce variations
                const quantized = this.quantizeColor(color);
                const key = `${quantized.r},${quantized.g},${quantized.b}`;

                if (!colorCounts[key]) {
                    colorCounts[key] = { color: quantized, count: 0 };
                }
                colorCounts[key].count++;
            }
        }

        // Filter to colors with significant presence (likely curves)
        const minPixels = 20;
        const significantColors = Object.values(colorCounts)
            .filter(c => c.count >= minPixels)
            .sort((a, b) => b.count - a.count);

        // Merge similar colors
        const mergedColors = this.mergeSimilarColors(significantColors);

        return mergedColors.slice(0, 8); // Limit to 8 curves max
    },

    // Quantize color to reduce slight variations
    quantizeColor(color) {
        const step = 16;
        return {
            r: Math.round(color.r / step) * step,
            g: Math.round(color.g / step) * step,
            b: Math.round(color.b / step) * step
        };
    },

    // Merge colors that are very similar
    mergeSimilarColors(colors) {
        const merged = [];
        const used = new Set();

        colors.forEach((colorInfo, i) => {
            if (used.has(i)) return;

            let totalCount = colorInfo.count;
            let r = colorInfo.color.r * colorInfo.count;
            let g = colorInfo.color.g * colorInfo.count;
            let b = colorInfo.color.b * colorInfo.count;

            // Find and merge similar colors
            colors.forEach((other, j) => {
                if (i !== j && !used.has(j) && this.colorMatch(colorInfo.color, other.color)) {
                    used.add(j);
                    totalCount += other.count;
                    r += other.color.r * other.count;
                    g += other.color.g * other.count;
                    b += other.color.b * other.count;
                }
            });

            merged.push({
                color: {
                    r: Math.round(r / totalCount),
                    g: Math.round(g / totalCount),
                    b: Math.round(b / totalCount)
                },
                count: totalCount
            });
        });

        return merged;
    },

    // Find all pixels of a specific color within bounds
    findPixelsOfColor(imageData, width, height, targetColor, bounds) {
        const pixels = [];

        for (let y = Math.floor(bounds.top); y < bounds.bottom; y += this.sampleInterval) {
            for (let x = Math.floor(bounds.left); x < bounds.right; x += this.sampleInterval) {
                const color = this.getPixelColor(imageData, x, y, width);
                if (this.colorMatch(color, targetColor)) {
                    pixels.push({ x, y });
                }
            }
        }

        return pixels;
    },

    // Convert RGB to hex color
    rgbToHex(color) {
        const toHex = (c) => {
            const hex = Math.min(255, Math.max(0, c)).toString(16);
            return hex.length === 1 ? '0' + hex : hex;
        };
        return '#' + toHex(color.r) + toHex(color.g) + toHex(color.b);
    }
};
