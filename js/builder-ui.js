/*
 * Canvas interaction for builder mode.
 *
 * Tools:
 *   'road'   — mousedown on a node, drag to adjacent node, mouseup commits
 *   'erase'  — click a node (removes intersection) or near a road (erases segment)
 *
 * Grid snapping: nearest node within SNAP_RADIUS pixels.
 * Ghost preview: translucent road drawn from drag-start to cursor.
 *
 * Exports TT.builderUI with:
 *   attach(canvas, model, onWorldChange)
 *   detach(canvas)
 *   setTool(tool)
 *   renderOverlay(ctx, t)   — called by renderer each frame
 */
(function (TT) {
  'use strict';

  const SNAP_RADIUS = 0.45; // fraction of cell width in world coords used for snap

  // Direction helpers (mirror builder-model.js)
  const DIR = {
    N: { dc: 0, dr: -1 },
    E: { dc: 1, dr: 0 },
    S: { dc: 0, dr: 1 },
    W: { dc: -1, dr: 0 },
  };
  const ALL_DIRS = ['N', 'E', 'S', 'W'];

  const INTERSECTION_TOOLS = new Set(['fourway', 'tee_N', 'tee_E', 'tee_S', 'tee_W', 'roundabout', 'entry', 'exit', 'entryexit']);

  function nodeKey(c, r) { return c + ',' + r; }

  // -------------------------------------------------------------------------

  let _canvas = null;
  let _model = null;
  let _onChange = null;
  let _tool = 'road';

  // Drag state
  let _dragging = false;
  let _dragStart = null;   // { col, row } grid node
  let _ghostEnd = null;    // { col, row } or null — snapped end node during drag
  let _cursorWorld = null; // { x, y } raw cursor in world coords (for ghost preview)

  // -------------------------------------------------------------------------
  // Coordinate helpers
  // -------------------------------------------------------------------------

  function canvasToWorld(e, t) {
    const rect = _canvas.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;
    return {
      x: (cssX - t.ox) / t.scale,
      y: (cssY - t.oy) / t.scale,
    };
  }

  // Snap a world-coord point to the nearest grid node within snap radius.
  // Returns { col, row } or null.
  function snapToNode(wx, wy) {
    const cs = _model.cellSize;
    const snapDist = cs * SNAP_RADIUS;
    const col = Math.round(wx / cs);
    const row = Math.round(wy / cs);
    if (col < 0 || col >= _model.cols || row < 0 || row >= _model.rows) return null;
    const dx = wx - col * cs, dy = wy - row * cs;
    if (Math.sqrt(dx * dx + dy * dy) > snapDist) return null;
    return { col, row };
  }

  // Given a drag-start node and a raw world cursor position, find the nearest
  // valid adjacent node in one of the 4 cardinal directions.
  function snapAdjacentNode(start, wx, wy) {
    const cs = _model.cellSize;
    const sx = start.col * cs, sy = start.row * cs;
    const dx = wx - sx, dy = wy - sy;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return null;

    // Pick dominant axis direction
    let bestDir = null;
    if (Math.abs(dx) >= Math.abs(dy)) {
      bestDir = dx > 0 ? 'E' : 'W';
    } else {
      bestDir = dy > 0 ? 'S' : 'N';
    }

    const d = DIR[bestDir];
    const nc = start.col + d.dc;
    const nr = start.row + d.dr;
    if (nc < 0 || nc >= _model.cols || nr < 0 || nr >= _model.rows) return null;
    if (!_model.canConnect(start, bestDir, { col: nc, row: nr })) return null;
    return { col: nc, row: nr };
  }

  // -------------------------------------------------------------------------
  // Event handlers
  // -------------------------------------------------------------------------

  // t is captured once per interaction via closure — stored on attach.
  let _getTransform = null;

  function onMouseDown(e) {
    const t = _getTransform();
    if (!t) return;
    const w = canvasToWorld(e, t);
    const node = snapToNode(w.x, w.y);
    if (!node) return;

    if (_tool === 'road') {
      _dragging = true;
      _dragStart = node;
      _ghostEnd = null;
      _cursorWorld = w;
    } else if (INTERSECTION_TOOLS.has(_tool)) {
      _model.placeIntersection(node.col, node.row, _tool);
      _onChange();
    } else if (_tool === 'erase') {
      eraseAt(node, w);
    }
  }

  function onMouseMove(e) {
    if (!_dragging) return;
    const t = _getTransform();
    if (!t) return;
    const w = canvasToWorld(e, t);
    _cursorWorld = w;
    _ghostEnd = snapAdjacentNode(_dragStart, w.x, w.y);
  }

  function onMouseUp(e) {
    if (!_dragging) return;
    _dragging = false;

    if (_tool === 'road' && _ghostEnd) {
      const drawn = _model.drawRoad(_dragStart, _ghostEnd);
      if (drawn) _onChange();
    }

    _dragStart = null;
    _ghostEnd = null;
    _cursorWorld = null;
  }

  function onMouseLeave() {
    _dragging = false;
    _dragStart = null;
    _ghostEnd = null;
    _cursorWorld = null;
  }

  function eraseAt(node, w) {
    const nk = nodeKey(node.col, node.row);
    // If the node has an intersection, remove it.
    if (_model.nodes[nk] && _model.nodes[nk].type) {
      _model.removeIntersection(node.col, node.row);
      _onChange();
      return;
    }
    // Otherwise, erase any road segment connected to this node.
    const cs = _model.cellSize;
    for (const dir of ALL_DIRS) {
      const d = DIR[dir];
      const nc = node.col + d.dc;
      const nr = node.row + d.dr;
      if (nc < 0 || nc >= _model.cols || nr < 0 || nr >= _model.rows) continue;
      _model.eraseRoad(node, { col: nc, row: nr });
    }
    _onChange();
  }

  // -------------------------------------------------------------------------
  // Intersection icon drawing
  // -------------------------------------------------------------------------

  // Type colours
  const TYPE_COLOR = {
    fourway:    '#4da3ff',
    tee_N:      '#a78bfa',
    tee_E:      '#a78bfa',
    tee_S:      '#a78bfa',
    tee_W:      '#a78bfa',
    roundabout: '#46d17a',
    entry:      '#22d3ee',
    exit:       '#f87171',
    entryexit:  '#a3e635',
  };

  // Open arms per type (mirrors builder-model.js TYPE_ARMS)
  const TYPE_ARMS = {
    fourway:    ['N', 'E', 'S', 'W'],
    tee_N:      ['E', 'S', 'W'],
    tee_E:      ['N', 'S', 'W'],
    tee_S:      ['N', 'E', 'W'],
    tee_W:      ['N', 'E', 'S'],
    roundabout: ['N', 'E', 'S', 'W'],
    entry:      ['N', 'E', 'S', 'W'],
    exit:       ['N', 'E', 'S', 'W'],
    entryexit:  ['N', 'E', 'S', 'W'],
  };

  const ARM_VEC = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

  const PORTAL_TYPES = new Set(['entry', 'exit', 'entryexit']);

  function drawIntersectionIcon(ctx, type, wx, wy, r) {
    const color = TYPE_COLOR[type] || '#f5c542';
    ctx.save();

    if (PORTAL_TYPES.has(type)) {
      // Solid filled circle — no inner cutout
      ctx.beginPath();
      ctx.arc(wx, wy, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    } else if (type === 'roundabout') {
      // Filled circle with inner ring
      ctx.beginPath();
      ctx.arc(wx, wy, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(wx, wy, r * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = '#0f1115';
      ctx.fill();
    } else {
      // Filled square for signal intersections
      ctx.fillStyle = color;
      ctx.fillRect(wx - r, wy - r, r * 2, r * 2);

      // Draw small arm stubs to show open directions
      const arms = TYPE_ARMS[type] || [];
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, r * 0.4);
      ctx.lineCap = 'round';
      for (const arm of arms) {
        const [dx, dy] = ARM_VEC[arm];
        ctx.beginPath();
        ctx.moveTo(wx + dx * r, wy + dy * r);
        ctx.lineTo(wx + dx * r * 1.8, wy + dy * r * 1.8);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // Overlay rendering (called by renderer each frame)
  // -------------------------------------------------------------------------

  function renderOverlay(ctx, t) {
    if (!_model) return;
    const X = x => t.ox + x * t.scale;
    const Y = y => t.oy + y * t.scale;
    const cs = _model.cellSize;

    // Faint grid lines
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    for (let c = 0; c < _model.cols; c++) {
      ctx.beginPath();
      ctx.moveTo(X(c * cs), Y(0));
      ctx.lineTo(X(c * cs), Y((_model.rows - 1) * cs));
      ctx.stroke();
    }
    for (let r = 0; r < _model.rows; r++) {
      ctx.beginPath();
      ctx.moveTo(X(0), Y(r * cs));
      ctx.lineTo(X((_model.cols - 1) * cs), Y(r * cs));
      ctx.stroke();
    }

    // Node dots: hollow circle for plain nodes, icons for intersections
    const dotR = Math.max(3, 4 * t.scale);
    for (let c = 0; c < _model.cols; c++) {
      for (let r = 0; r < _model.rows; r++) {
        const nk = nodeKey(c, r);
        const node = _model.nodes[nk];
        const wx = X(c * cs), wy = Y(r * cs);
        if (node && node.type) {
          drawIntersectionIcon(ctx, node.type, wx, wy, dotR);
        } else {
          ctx.beginPath();
          ctx.arc(wx, wy, dotR, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255,255,255,0.2)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }

    // Ghost preview during road drag
    if (_dragging && _dragStart && _cursorWorld) {
      const sx = X(_dragStart.col * cs);
      const sy = Y(_dragStart.row * cs);
      let ex, ey;
      if (_ghostEnd) {
        ex = X(_ghostEnd.col * cs);
        ey = Y(_ghostEnd.row * cs);
      } else {
        ex = X(_cursorWorld.x);
        ey = Y(_cursorWorld.y);
      }
      ctx.save();
      ctx.strokeStyle = _ghostEnd ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.2)';
      ctx.lineWidth = Math.max(2, 3.4 * t.scale);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  const builderUI = {
    currentTool: 'road',

    attach(canvas, model, onWorldChange, getTransform) {
      _canvas = canvas;
      _model = model;
      _onChange = onWorldChange;
      _getTransform = getTransform;
      _tool = 'road';

      canvas.addEventListener('mousedown', onMouseDown);
      canvas.addEventListener('mousemove', onMouseMove);
      canvas.addEventListener('mouseup', onMouseUp);
      canvas.addEventListener('mouseleave', onMouseLeave);
    },

    detach(canvas) {
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('mouseleave', onMouseLeave);
      _canvas = null;
      _model = null;
      _onChange = null;
      _getTransform = null;
      _dragging = false;
    },

    setTool(tool) {
      _tool = tool;
      this.currentTool = tool;
      _dragging = false;
      _dragStart = null;
      _ghostEnd = null;
    },

    renderOverlay,
  };

  TT.builderUI = builderUI;
})(window.TT);
