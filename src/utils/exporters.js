export const exportSQL = (sqlInput, dbName = 'mon_schema') => {
  const exportDate = new Date().toISOString();
  const headerComment = `-- =====================================================\n-- Database: ${dbName}\n-- Exported on: ${exportDate}\n-- =====================================================\n\n`;
  const content = headerComment + (sqlInput ? sqlInput.trim() : '');
  
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${dbName}-script-${new Date().toISOString().slice(0, 10)}.sql`;
  link.click();
  URL.revokeObjectURL(url);
};

export const exportJSON = (sqlInput, showSuggestions, nodes, edges, dbName = 'mon_schema', businessGroups = []) => {
  const edgesToExport = showSuggestions ? edges : edges.filter((e) => !e.data?.isSuggested);
  const exportData = {
    version: 1,
    dbName,
    exportDate: new Date().toISOString(),
    sqlInput,
    showSuggestions,
    businessGroups,
    nodes,
    edges: edgesToExport,
  };
  const blob = new Blob([JSON.stringify(exportData, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${dbName}-save-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
};

export const exportHTML = (nodes, edges, showSuggestions, dbName = 'mon_schema', businessGroups = []) => {
  const exportDate = new Date().toISOString();
  
  const sortedBusinessGroups = [...(businessGroups || [])].sort((a, b) =>
    (a.name || '').localeCompare(b.name || '', 'fr', { sensitivity: 'base' })
  );

  const visibleEdgesToExport = showSuggestions
    ? edges
    : edges.filter((e) => !e.data?.isSuggested);

  let minX = nodes.length > 0 ? nodes[0].position.x : 0;
  let minY = nodes.length > 0 ? nodes[0].position.y : 0;
  let maxX = nodes.length > 0 ? nodes[0].position.x + (nodes[0].measured?.width || 260) : 0;
  let maxY = nodes.length > 0 ? nodes[0].position.y + 400 : 0;

  nodes.forEach((n) => {
    const w = n.measured?.width || 260;
    const h = 45 + (n.data?.columns?.length || 1) * 28;
    if (n.position.x < minX) minX = n.position.x;
    if (n.position.y < minY) minY = n.position.y;
    if (n.position.x + w > maxX) maxX = n.position.x + w;
    if (n.position.y + h > maxY) maxY = n.position.y + h;
  });

  const padding = 120;
  const offsetX = -minX + padding;
  const offsetY = -minY + padding;
  const canvasWidth = maxX - minX + padding * 2;
  const canvasHeight = maxY - minY + padding * 2;

  const getNodeColIndex = (node, colName) => {
    const cols = node.data?.columns || [];
    const idx = cols.findIndex((c) => c.name === colName);
    return idx >= 0 ? idx : 0;
  };

  const getHandleCoords = (node, colName, side) => {
    const colIndex = getNodeColIndex(node, colName);
    const cardWidth = node.measured?.width || 260;
    const headerHeight = 40; 
    const paddingTop = 4;
    const rowHeight = 28; 

    const x = node.position.x + offsetX + (side === 'right' ? cardWidth + 1 : -1);
    const y = node.position.y + offsetY + headerHeight + paddingTop + (colIndex * rowHeight) + (rowHeight / 2);

    return { x, y };
  };

  const extractColName = (handleStr, tableId) => {
    if (!handleStr) return '';
    let clean = handleStr;
    if (clean.startsWith(`${tableId}-`)) {
      clean = clean.slice(tableId.length + 1);
    }
    return clean
      .replace(/-(left|right)-(source|target)$/, '')
      .replace(/-(source|target)$/, '');
  };

  const groupsHTML = sortedBusinessGroups
    .map((group, idx) => {
      const memberNodes = nodes.filter((n) => group.tableIds && group.tableIds.includes(n.id));
      if (memberNodes.length === 0) return '';

      let gMinX = Infinity;
      let gMinY = Infinity;
      let gMaxX = -Infinity;
      let gMaxY = -Infinity;

      memberNodes.forEach((node) => {
        const w = node.measured?.width || 260;
        const colCount = node.data?.columns?.length || 1;
        const h = 45 + colCount * 28;

        if (node.position.x < gMinX) gMinX = node.position.x;
        if (node.position.y < gMinY) gMinY = node.position.y;
        if (node.position.x + w > gMaxX) gMaxX = node.position.x + w;
        if (node.position.y + h > gMaxY) gMaxY = node.position.y + h;
      });

      const padX = 24;
      const padTop = 36;
      const padBottom = 20;

      const gx = gMinX + offsetX - padX;
      const gy = gMinY + offsetY - padTop;
      const gw = gMaxX - gMinX + padX * 2;
      const gh = gMaxY - gMinY + padTop + padBottom;
      const color = group.color || '#0284c7';

      return `
        <div id="group-${idx}" class="group-card-html" style="left: ${gx}px; top: ${gy}px; width: ${gw}px; height: ${gh}px; border-color: ${color}; background-color: ${color}15;">
          <div class="group-card-header-html" style="background-color: ${color};">
            ${group.name}
          </div>
        </div>
      `;
    })
    .join('\n');

  const edgesDataMap = {};
  const svgPathsHTML = visibleEdgesToExport
    .map((edge, idx) => {
      const sourceNode = nodes.find((n) => n.id === edge.source);
      const targetNode = nodes.find((n) => n.id === edge.target);
      if (!sourceNode || !targetNode) return '';

      const sourceCol = edge.data?.sourceCol || extractColName(edge.sourceHandle, edge.source);
      const targetCol = edge.data?.targetCol || extractColName(edge.targetHandle, edge.target);

      const sourceSide = edge.sourceHandle?.includes('-left-') ? 'left' : 'right';
      const targetSide = edge.targetHandle?.includes('-left-') ? 'left' : 'right';

      const p1 = getHandleCoords(sourceNode, sourceCol, sourceSide);
      const p2 = getHandleCoords(targetNode, targetCol, targetSide);

      const isSuggested = edge.data?.isSuggested;
      const strokeColor = isSuggested ? '#f97316' : '#0284c7';
      const strokeDash = isSuggested ? 'stroke-dasharray="5,5"' : '';

      const edgeKey = `edge_${idx}`;
      edgesDataMap[edgeKey] = {
        sourceTable: edge.source,
        targetTable: edge.target,
        sourceCol: sourceCol,
        targetCol: targetCol,
        isSuggested: isSuggested,
        similarityScore: edge.data?.similarityScore,
        scriptA: edge.data?.scriptA,
        scriptB: edge.data?.scriptB,
      };

      let d = '';
      if (edge.source === edge.target) {
        const loopX = p1.x + 40;
        d = `M ${p1.x} ${p1.y} L ${loopX} ${p1.y} L ${loopX} ${p2.y} L ${p2.x} ${p2.y}`;
      } else {
        const midX = (p1.x + p2.x) / 2;
        d = `M ${p1.x} ${p1.y} L ${midX} ${p1.y} L ${midX} ${p2.y} L ${p2.x} ${p2.y}`;
      }

      return `
        <path d="${d}" fill="none" stroke="${strokeColor}" stroke-width="2.5" ${strokeDash} class="interactive-edge" onclick="openEdgeModal('${edgeKey}')" marker-end="url(#arrow-${isSuggested ? 'suggested' : 'normal'})" />
        <path d="${d}" fill="none" stroke="transparent" stroke-width="12" class="interactive-edge" onclick="openEdgeModal('${edgeKey}')" />
      `;
    })
    .join('\n');

  const insertsDataMap = {};
  const commentsDataMap = {};
  nodes.forEach((node) => {
    const inserts = node.data?.inserts;
    if (inserts) {
      const columns = inserts.columns || node.data?.columns?.map((c) => c.name) || [];
      const rows = inserts.rows || inserts.values || [];
      if (rows.length > 0) {
        insertsDataMap[node.id] = { columns, rows };
      }
    }
    
    if (node.data?.columns) {
      node.data.columns.forEach((col) => {
        if (col.comment) {
          const commentKey = `${node.data.name}___${col.name}`;
          commentsDataMap[commentKey] = {
            table: node.data.name,
            column: col.name,
            comment: col.comment
          };
        }
      });
    }
  });

  const htmlContent = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>MPD - ${dbName}</title>
  <style>
    body { margin: 0; padding: 0; font-family: system-ui, -apple-system, sans-serif; background: #f1f1f1; color: #f8fafc; overflow: hidden; user-select: none; }
    
    .header { position: fixed; top: 15px; left: 20px; z-index: 1000; background: rgba(30, 41, 59, 0.94); padding: 14px 18px; border-radius: 8px; border: 1px solid #334155; backdrop-filter: blur(8px); box-shadow: 0 4px 12px rgba(0,0,0,0.3); display: flex; flex-direction: column; gap: 10px; width: 280px; max-height: calc(100vh - 30px); box-sizing: border-box; pointer-events: auto; }
    .header-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
    .header-info { display: flex; flex-direction: column; gap: 2px; flex: 1; }
    .header h1 { margin: 0; font-size: 16px; color: #f8fafc; word-break: break-word; }
    .header span.date-span { font-size: 11px; color: #94a3b8; }
    .toggle-btn { background: #334155; border: 1px solid #475569; color: #f8fafc; border-radius: 4px; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 14px; font-weight: bold; transition: background 0.2s; flex-shrink: 0; }
    .toggle-btn:hover { background: #475569; }

    .nav-container { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; padding-right: 4px; margin-top: 4px; transition: max-height 0.3s ease, opacity 0.2s ease; max-height: calc(100vh - 110px); opacity: 1; }
    .nav-container.collapsed { max-height: 0; opacity: 0; margin-top: 0; padding: 0; overflow: hidden; pointer-events: none; }
    .nav-label { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
    .nav-chips-column { display: flex; flex-direction: column; gap: 6px; align-items: stretch; }

    .chip { background: rgba(2, 132, 199, 0.15); border: 1px solid #0284c7; color: #f8fafc; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.2s ease; display: flex; align-items: center; text-align: left; width: 100%; box-sizing: border-box; }
    .chip:hover { background: #0284c7; border-color: #38bdf8; color: #ffffff; transform: translateX(3px); }

    .viewport { position: relative; width: 100vw; height: 100vh; overflow: hidden; cursor: grab; background: #f1f1f1; }
    .viewport:active { cursor: grabbing; }
    .canvas { position: absolute; width: ${canvasWidth}px; height: ${canvasHeight}px; transform-origin: 0 0; }
    .svg-layer { position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 5; pointer-events: none; }
    .interactive-edge { cursor: pointer; pointer-events: stroke; }
    .interactive-edge:hover { filter: brightness(1.2); }
    
    .group-card-html { position: absolute; border: 2px dashed #0284c7; border-radius: 16px; z-index: 2; box-sizing: border-box; pointer-events: none; transition: box-shadow 0.3s, border-color 0.3s; }
    .group-card-header-html { position: absolute; top: -14px; left: 16px; padding: 3px 10px; border-radius: 12px; color: #ffffff; font-size: 12px; font-weight: 700; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15); }

    .card { position: absolute; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.3); overflow: hidden; z-index: 10; pointer-events: auto; transition: box-shadow 0.3s, border-color 0.3s; user-select: text; }
    .card-header { background: #0288d1; color: #fff; font-weight: 700; font-size: 14px; height: 40px; box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; position: relative; padding: 0 12px; }
    .card-body { padding: 4px 0; background: #ffffff; }
    .data-btn { background: rgba(255, 255, 255, 0.25); border: none; border-radius: 4px; color: #ffffff; cursor: pointer !important; padding: 2px 6px; font-size: 12px; display: flex; align-items: center; justify-content: center; transition: background 0.2s; z-index: 20; }
    .data-btn:hover { background: rgba(255, 255, 255, 0.4); }
    .col-row { padding: 0 14px; display: flex; justify-content: space-between; align-items: center; gap: 24px; white-space: nowrap; border-bottom: 1px solid #f1f5f9; font-size: 13px; height: 28px; box-sizing: border-box; }
    .col-row:last-child { border-bottom: none; }
    .col-name { font-weight: 500; color: #334155; display: flex; align-items: center; gap: 4px; }
    .col-type { color: #94a3b8; font-size: 11px; font-weight: 600; text-transform: uppercase; margin-left: 16px; }
    .badge-notnull { color: #ef4444; font-weight: bold; font-size: 13px; }
    .comment-icon { background: none; border: none; cursor: pointer; font-size: 12px; padding: 0; display: inline-flex; align-items: center; }

    .highlight-pulse {
      animation: pulseAnimation 1.8s ease-in-out;
    }

    @keyframes pulseAnimation {
      0% { box-shadow: 0 0 0 0 rgba(56, 189, 248, 0.9); border-color: #38bdf8; }
      50% { box-shadow: 0 0 0 18px rgba(56, 189, 248, 0); border-color: #38bdf8; }
      100% { box-shadow: 0 0 0 0 rgba(56, 189, 248, 0); }
    }

    .modal-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(15, 23, 42, 0.6); display: none; justify-content: center; align-items: center; z-index: 9999; user-select: text; }
    .modal-content { background: #ffffff; padding: 24px; border-radius: 8px; max-width: 800px; width: 90%; max-height: 80vh; display: flex; flex-direction: column; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.2); color: #0f172a; }
    .modal-body { overflow-x: auto; overflow-y: auto; flex: 1; border: 1px solid #e2e8f0; border-radius: 6px; margin-top: 12px; }
    .data-table { width: 100%; border-collapse: collapse; font-size: 13px; text-align: left; }
    .data-table th { background: #f8fafc; border-bottom: 2px solid #e2e8f0; padding: 10px 12px; color: #334155; }
    .data-table td { padding: 8px 12px; color: #475569; border-bottom: 1px solid #f1f5f9; }
    .btn-close-modal { background: #94a3b8; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 600; margin-top: 16px; align-self: flex-end; }
    .option-block { margin-top: 12px; border: 1px solid #e2e8f0; padding: 12px; border-radius: 6px; background: #f8fafc; }
    .option-block h4 { margin: 0 0 8px 0; font-size: 13px; color: #334155; }
    .option-block pre { margin: 0 0 8px 0; background: #ffffff; padding: 8px; border: 1px solid #e2e8f0; border-radius: 4px; font-size: 12px; overflow-x: auto; color: #0f172a; }
    .btn-copy { background: #0284c7; color: white; border: none; padding: 6px 12px; border-radius: 4px; font-size: 12px; cursor: pointer; font-weight: 500; }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-top">
      <div class="header-info">
        <h1>${dbName}</h1>
        <span class="date-span">Exporté le ${new Date(exportDate).toLocaleString()}</span>
      </div>
      ${(sortedBusinessGroups && sortedBusinessGroups.length > 0) ? `
        <button class="toggle-btn" id="toggleNavBtn" onclick="toggleNav()" title="Réduire / Agrandir le panneau">−</button>
      ` : ''}
    </div>
    
    ${(sortedBusinessGroups && sortedBusinessGroups.length > 0) ? `
      <div class="nav-container" id="navContainer">
        <span class="nav-label">Objets Métier (${sortedBusinessGroups.length}) :</span>
        <div class="nav-chips-column">
          ${sortedBusinessGroups.map((g, i) => `
            <button class="chip" onclick="focusElement('group-${i}')">
              <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${g.name}</span>
            </button>
          `).join('')}
        </div>
      </div>
    ` : ''}
  </div>

  <div class="viewport" id="viewport">
    <div class="canvas" id="canvas">
      ${groupsHTML}
      ${nodes
        .map((node) => {
          const hasData = insertsDataMap[node.id] ? true : false;
          const nodeWidth = node.measured?.width || 260;
          return `
        <div id="node-${node.id}" class="card" style="left: ${node.position.x + offsetX}px; top: ${node.position.y + offsetY}px; width: ${nodeWidth}px;">
          <div class="card-header">
            <div style="width:28px; display:flex; align-items:center;">
              ${hasData ? `<button class="data-btn" onclick="openTableModal('${node.id}')" title="Voir les données">📋</button>` : ''}
            </div>
            <span style="flex:1; text-align:center;">${node.data.name}</span>
            <div style="width:28px;"></div>
          </div>
          <div class="card-body">
            ${(node.data.columns || [])
              .map((col) => {
                const commentKey = `${node.data.name}___${col.name}`;
                return `
              <div class="col-row">
                <div class="col-name">
                  ${col.name}
                  ${col.isPk ? '<span>🔑</span>' : ''}
                  ${col.isNotNull && !col.isPk ? '<span class="badge-notnull">*</span>' : ''}
                  ${col.comment ? `<button class="comment-icon" onclick="openCommentModal('${commentKey}')" title="Voir le commentaire">💬</button>` : ''}
                </div>
                <div class="col-type">${col.type}</div>
              </div>
            `;
              })
              .join('')}
          </div>
        </div>
        `;
        })
        .join('')}
      <svg class="svg-layer">
        <defs>
          <marker id="arrow-normal" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#0284c7"/>
          </marker>
          <marker id="arrow-suggested" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#f97316"/>
          </marker>
        </defs>
        ${svgPathsHTML}
      </svg>
    </div>
  </div>

  <div id="tableModal" class="modal-overlay" onclick="closeTableModal()">
    <div class="modal-content" onclick="event.stopPropagation()">
      <h3 id="modalTitle" style="margin:0;">Données</h3>
      <div class="modal-body">
        <table class="data-table" id="modalTable">
          <thead id="modalHead"></thead>
          <tbody id="modalBody"></tbody>
        </table>
      </div>
      <button class="btn-close-modal" onclick="closeTableModal()">Fermer</button>
    </div>
  </div>

  <div id="edgeModal" class="modal-overlay" onclick="closeEdgeModal()">
    <div class="modal-content" onclick="event.stopPropagation()">
      <h3 id="edgeModalTitle" style="margin:0;">Relation Clé Étrangère</h3>
      <p id="edgeModalSubtitle" style="font-size:13px; color:#475569; margin:8px 0 0 0;"></p>
      <div class="modal-body" style="border:none; margin-top:8px;" id="edgeModalOptions"></div>
      <button class="btn-close-modal" onclick="closeEdgeModal()">Fermer</button>
    </div>
  </div>

  <div id="commentModal" class="modal-overlay" onclick="closeCommentModal()">
    <div class="modal-content" onclick="event.stopPropagation()" style="max-width: 500px;">
      <h3 id="commentModalTitle" style="margin:0;">Commentaire de colonne</h3>
      <p id="commentModalSubtitle" style="font-size:13px; color:#475569; margin:8px 0 0 0;"></p>
      <div class="option-block" style="margin-top:12px;">
        <p id="commentModalText" style="margin:0; font-size:14px; color:#0f172a; white-space: pre-wrap;"></p>
      </div>
      <button class="btn-close-modal" onclick="closeCommentModal()">Fermer</button>
    </div>
  </div>

  <script>
    const embedsData = ${JSON.stringify(insertsDataMap)};
    const embedsEdges = ${JSON.stringify(edgesDataMap)};
    const embedsComments = ${JSON.stringify(commentsDataMap)};

    let scale = 1;
    let pointX = 0;
    let pointY = 0;
    let startX = 0;
    let startY = 0;
    let isDragging = false;

    const viewport = document.getElementById('viewport');
    const canvas = document.getElementById('canvas');

    function setTransform() {
      canvas.style.transform = 'translate(' + pointX + 'px, ' + pointY + 'px) scale(' + scale + ')';
    }

    viewport.addEventListener('mousedown', (e) => {
      if (e.target.closest('.card') || e.target.closest('.interactive-edge') || e.target.closest('.header') || e.target.closest('.modal-overlay')) return;
      isDragging = true;
      startX = e.clientX - pointX;
      startY = e.clientY - pointY;
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      e.preventDefault();
      pointX = e.clientX - startX;
      pointY = e.clientY - startY;
      setTransform();
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
    });

    viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const xs = (e.clientX - pointX) / scale;
      const ys = (e.clientY - pointY) / scale;
      const delta = -e.deltaY;
      let newScale = delta > 0 ? scale * 1.1 : scale / 1.1;
      newScale = Math.min(Math.max(0.15, newScale), 3);

      pointX = e.clientX - xs * newScale;
      pointY = e.clientY - ys * newScale;
      scale = newScale;
      setTransform();
    }, { passive: false });

    function toggleNav() {
      const nav = document.getElementById('navContainer');
      const btn = document.getElementById('toggleNavBtn');
      if (!nav || !btn) return;

      if (nav.classList.contains('collapsed')) {
        nav.classList.remove('collapsed');
        btn.innerText = '−';
      } else {
        nav.classList.add('collapsed');
        btn.innerText = '+';
      }
    }

    function focusElement(elementId) {
      const el = document.getElementById(elementId);
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();

      const elLeft = (rect.left - canvasRect.left) / scale;
      const elTop = (rect.top - canvasRect.top) / scale;
      const elWidth = rect.width / scale;
      const elHeight = rect.height / scale;

      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      pointX = viewportWidth / 2 - (elLeft + elWidth / 2) * scale;
      pointY = viewportHeight / 2 - (elTop + elHeight / 2) * scale;
      setTransform();

      el.classList.remove('highlight-pulse');
      void el.offsetWidth;
      el.classList.add('highlight-pulse');
    }

    function openTableModal(tableId) {
      const data = embedsData[tableId];
      if (!data) return;

      document.getElementById('modalTitle').innerText = 'Données de la table : ' + tableId;
      
      const headEl = document.getElementById('modalHead');
      const bodyEl = document.getElementById('modalBody');

      headEl.innerHTML = '<tr>' + (data.columns || []).map(c => '<th>' + c + '</th>').join('') + '</tr>';
      bodyEl.innerHTML = (data.rows || []).map(row => '<tr>' + row.map(val => '<td>' + (val !== null ? val : '') + '</td>').join('') + '</tr>').join('');

      document.getElementById('tableModal').style.display = 'flex';
    }

    function closeTableModal() {
      document.getElementById('tableModal').style.display = 'none';
    }

    function openEdgeModal(edgeKey) {
      const data = embedsEdges[edgeKey];
      if (!data) return;

      document.getElementById('edgeModalTitle').innerText = data.isSuggested ? 'Clé étrangère suggérée' : 'Lien Clé Étrangère';
      
      let subText = 'Relation entre : <strong>' + data.sourceTable + '.' + data.sourceCol + '</strong> et <strong>' + data.targetTable + '.' + data.targetCol + '</strong>';
      if (data.isSuggested && data.similarityScore) {
        subText += ' (Similarité : ' + data.similarityScore + '%)';
      }
      document.getElementById('edgeModalSubtitle').innerHTML = subText;

      const optionsContainer = document.getElementById('edgeModalOptions');
      let html = '';

      if (data.isSuggested) {
        const sqlA = data.scriptA || 'ALTER TABLE ' + data.sourceTable + '\\nADD CONSTRAINT fk_' + data.sourceTable + '_' + data.sourceCol + '\\nFOREIGN KEY (' + data.sourceCol + ') REFERENCES ' + data.targetTable + '(' + data.targetCol + ');';
        const sqlB = data.scriptB || 'ALTER TABLE ' + data.targetTable + '\\nADD CONSTRAINT fk_' + data.targetTable + '_' + data.targetCol + '\\nFOREIGN KEY (' + data.targetCol + ') REFERENCES ' + data.sourceTable + '(' + data.sourceCol + ');';
        
        html += '<div class="option-block"><h4>Ajouter FK sur ' + data.sourceTable + '</h4><pre>' + sqlA + '</pre><button class="btn-copy" onclick=\\'copyText(' + JSON.stringify(sqlA) + ', this)\\'>Copier le script</button></div>';
        html += '<div class="option-block" style="margin-top:12px;"><h4>Ajouter FK sur ' + data.targetTable + '</h4><pre>' + sqlB + '</pre><button class="btn-copy" onclick=\\'copyText(' + JSON.stringify(sqlB) + ', this)\\'>Copier le script</button></div>';
      } else {
        const innerJoin = 'SELECT *\\nFROM ' + data.sourceTable + '\\nINNER JOIN ' + data.targetTable + '\\n  ON ' + data.sourceTable + '.' + data.sourceCol + ' = ' + data.targetTable + '.' + data.targetCol + ';';
        const reverseJoin = 'SELECT *\\nFROM ' + data.targetTable + '\\nINNER JOIN ' + data.sourceTable + '\\n  ON ' + data.targetTable + '.' + data.targetCol + ' = ' + data.sourceTable + '.' + data.sourceCol + ';';

        html += '<div class="option-block"><h4>INNER JOIN (' + data.sourceTable + ' ➔ ' + data.targetTable + ')</h4><pre>' + innerJoin + '</pre><button class="btn-copy" onclick=\\'copyText(' + JSON.stringify(innerJoin) + ', this)\\'>Copier le script</button></div>';
        html += '<div class="option-block" style="margin-top:12px;"><h4>INNER JOIN Inversé (' + data.targetTable + ' ➔ ' + data.sourceTable + ')</h4><pre>' + reverseJoin + '</pre><button class="btn-copy" onclick=\\'copyText(' + JSON.stringify(reverseJoin) + ', this)\\'>Copier le script</button></div>';
      }

      optionsContainer.innerHTML = html;
      document.getElementById('edgeModal').style.display = 'flex';
    }

    function closeEdgeModal() {
      document.getElementById('edgeModal').style.display = 'none';
    }

    function openCommentModal(commentKey) {
      const data = embedsComments[commentKey];
      if (!data) return;

      document.getElementById('commentModalTitle').innerText = 'Commentaire';
      document.getElementById('commentModalSubtitle').innerHTML = 'Colonne : <strong>' + data.table + '.' + data.column + '</strong>';
      document.getElementById('commentModalText').innerText = data.comment;

      document.getElementById('commentModal').style.display = 'flex';
    }

    function closeCommentModal() {
      document.getElementById('commentModal').style.display = 'none';
    }

    function copyText(text, btn) {
      navigator.clipboard.writeText(text).then(() => {
        const original = btn.innerText;
        btn.innerText = 'Copié !';
        setTimeout(() => { btn.innerText = original; }, 2000);
      });
    }
  </script>
</body>
</html>`;

  const blob = new Blob([htmlContent], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${dbName}-report-${new Date().toISOString().slice(0, 10)}.html`;
  link.click();
  URL.revokeObjectURL(url);
};