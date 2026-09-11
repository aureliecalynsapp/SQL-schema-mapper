import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  applyNodeChanges,
  applyEdgeChanges,
  useViewport,
} from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import '@xyflow/react/dist/style.css';
import { parseSQLScript } from './utils/sqlParser';
import { exportSQL, exportJSON, exportHTML } from './utils/exporters';
import TableNode from './components/TableNode';
import GroupNode from './components/GroupNode';
import './App.css';

const LOCAL_STORAGE_KEY = 'sql_schema_mapper_save_v1';
const SNAP_THRESHOLD = 10;
const MAX_HISTORY_SIZE = 30;
const ALLOWED_EXTENSIONS = ['.sql', '.txt'];
const ALLOWED_MIME_TYPES = ['text/plain', 'application/sql', 'text/x-sql', 'text/sql'];
const COLOR_PALETTE = ['#0284c7', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#14b8a6', '#6366f1'];
const MAX_FK_THRESHOLD = 1000;

function HelperLinesRenderer({ horizontal, vertical }) {
  const { x, y, zoom } = useViewport();

  if (horizontal === null && vertical === null) return null;

  return (
    <svg className="helper-lines-svg">
      {horizontal !== null && (
        <line
          x1="0"
          y1={horizontal * zoom + y}
          x2="100%"
          y2={horizontal * zoom + y}
          stroke="#06b6d4"
          strokeWidth="1.5"
          strokeDasharray="4,4"
        />
      )}
      {vertical !== null && (
        <line
          x1={vertical * zoom + x}
          y1="0"
          x2={vertical * zoom + x}
          y2="100%"
          stroke="#06b6d4"
          strokeWidth="1.5"
          strokeDasharray="4,4"
        />
      )}
    </svg>
  );
}

const getLayoutedElements = (nodes, edges, direction = 'LR') => {
  const tableNodes = nodes.filter((n) => n.type === 'tableNode');
  const structuralEdges = edges.filter((e) => !e.data?.isSuggested && e.source !== e.target);

  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  const nodeWidth = 260;
  const isHorizontal = direction === 'LR';

  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: 80,
    ranksep: 120,
  });

  tableNodes.forEach((node) => {
    const columnCount = node.data?.columns?.length || 1;
    const nodeHeight = node.measured?.height || (45 + columnCount * 28);
    const width = node.measured?.width || nodeWidth;
    dagreGraph.setNode(node.id, { width, height: nodeHeight });
  });

  structuralEdges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  try {
    dagre.layout(dagreGraph);
  } catch (err) {
    console.warn('⚠️ Échec de Dagre layout, bascule sur position par défaut :', err);
  }

  const layoutedNodes = nodes.map((node) => {
    if (node.type !== 'tableNode') return node;

    const columnCount = node.data?.columns?.length || 1;
    const nodeHeight = node.measured?.height || (45 + columnCount * 28);
    const width = node.measured?.width || nodeWidth;
    const nodeWithPosition = dagreGraph.node(node.id);

    return {
      ...node,
      targetPosition: isHorizontal ? 'left' : 'top',
      sourcePosition: isHorizontal ? 'right' : 'bottom',
      position: nodeWithPosition
        ? {
            x: nodeWithPosition.x - width / 2,
            y: nodeWithPosition.y - nodeHeight / 2,
          }
        : node.position || { x: 0, y: 0 },
    };
  });

  const layoutedEdges = updateEdgeHandles(layoutedNodes, edges);

  return { nodes: layoutedNodes, edges: layoutedEdges };
};

const updateEdgeHandles = (nodesList, edgesList) => {
  return edgesList.map((edge) => {
    const sourceNode = nodesList.find((n) => n.id === edge.source);
    const targetNode = nodesList.find((n) => n.id === edge.target);

    if (!sourceNode || !targetNode) return edge;

    const isSelf = edge.source === edge.target;

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

    const sourceCol = edge.data?.sourceCol || extractColName(edge.sourceHandle, edge.source);
    const targetCol = edge.data?.targetCol || extractColName(edge.targetHandle, edge.target);

    let sourceHandle, targetHandle;

    if (isSelf) {
      sourceHandle = `${edge.source}-${sourceCol}-right-source`;
      targetHandle = `${edge.target}-${targetCol}-right-target`;
    } else {
      const isSourceLeft = sourceNode.position.x <= targetNode.position.x;
      sourceHandle = `${edge.source}-${sourceCol}-${isSourceLeft ? 'right' : 'left'}-source`;
      targetHandle = `${edge.target}-${targetCol}-${isSourceLeft ? 'left' : 'right'}-target`;
    }

    return {
      ...edge,
      type: 'smoothstep',
      sourceHandle,
      targetHandle,
    };
  });
};

export default function App() {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [businessGroups, setBusinessGroups] = useState([]);
  const [sqlInput, setSqlInput] = useState('');
  const [dbName, setDbName] = useState('mon_schema');
  const [history, setHistory] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [selectedEdgeModal, setSelectedEdgeModal] = useState(null);
  const [selectedCommentModal, setSelectedCommentModal] = useState(null);
  const [selectedInsertModal, setSelectedInsertModal] = useState(null);
  const [copiedKey, setCopiedKey] = useState(null);
  const [helperLines, setHelperLines] = useState({ horizontal: null, vertical: null });
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('Chargement en cours...');

  const lastSnappedPosRef = useRef(null);
  const lastProcessedSqlRef = useRef('');
  const groupDragStartPosRef = useRef(null);
  const isUndoingRef = useRef(false);

  const nodeTypes = useMemo(
    () => ({
      tableNode: TableNode,
      groupNode: GroupNode,
    }),
    []
  );

  const pushHistory = useCallback(() => {
    if (isUndoingRef.current) return;
    const currentState = {
      nodes,
      edges,
      businessGroups,
      sqlInput,
      dbName,
      showSuggestions,
    };

    setHistory((prev) => {
      const lastState = prev[prev.length - 1];
      if (lastState && JSON.stringify(lastState) === JSON.stringify(currentState)) {
        return prev;
      }
      return [...prev, currentState].slice(-MAX_HISTORY_SIZE);
    });
  }, [nodes, edges, businessGroups, sqlInput, dbName, showSuggestions]);

  useEffect(() => {
    const savedData = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (savedData) {
      try {
        const parsed = JSON.parse(savedData);
        if (parsed.sqlInput) {
          lastProcessedSqlRef.current = parsed.sqlInput;
          setSqlInput(parsed.sqlInput);
        }
        if (parsed.dbName !== undefined) setDbName(parsed.dbName);
        if (typeof parsed.showSuggestions === 'boolean') setShowSuggestions(parsed.showSuggestions);
        if (parsed.businessGroups && Array.isArray(parsed.businessGroups)) {
          setBusinessGroups(parsed.businessGroups);
        }
        if (parsed.nodes && parsed.edges) {
          setNodes(parsed.nodes);
          setEdges(updateEdgeHandles(parsed.nodes, parsed.edges));
        }
      } catch (err) {
        console.warn('Échec de lecture du localStorage:', err);
      }
    }
  }, []);

  useEffect(() => {
    if (nodes.length > 0 || sqlInput.trim() !== '') {
      const edgesToSave = showSuggestions ? edges : edges.filter((e) => !e.data?.isSuggested);
      const payload = {
        sqlInput,
        dbName,
        showSuggestions,
        businessGroups,
        nodes,
        edges: edgesToSave,
      };
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(payload));
    }
  }, [nodes, edges, sqlInput, dbName, showSuggestions, businessGroups]);

  const handleDeleteGroup = useCallback((groupId) => {
    pushHistory();
    setBusinessGroups((prev) => prev.filter((g) => g.id !== groupId));
  }, [pushHistory]);

  const handleRenameGroup = useCallback((groupId) => {
    setBusinessGroups((prev) => {
      const target = prev.find((g) => g.id === groupId);
      if (!target) return prev;
      const newName = prompt("Nouveau nom de l'objet métier :", target.name);
      if (!newName || !newName.trim()) return prev;
      pushHistory();
      return prev.map((g) => (g.id === groupId ? { ...g, name: newName.trim() } : g));
    });
  }, [pushHistory]);

  const handleChangeGroupColor = useCallback((groupId) => {
    pushHistory();
    setBusinessGroups((prev) =>
      prev.map((g) => {
        if (g.id !== groupId) return g;
        const currIndex = COLOR_PALETTE.indexOf(g.color);
        const nextColor = COLOR_PALETTE[(currIndex + 1) % COLOR_PALETTE.length];
        return { ...g, color: nextColor };
      })
    );
  }, [pushHistory]);

  const selectedTables = useMemo(() => {
    return nodes.filter((n) => n.type === 'tableNode' && n.selected);
  }, [nodes]);

  const handleCreateBusinessGroup = useCallback(() => {
    if (selectedTables.length === 0) return;
    const name = prompt("Nom de l'objet métier :", `Objet Métier ${businessGroups.length + 1}`);
    if (!name || !name.trim()) return;

    pushHistory();

    const newGroup = {
      id: `group_${Date.now()}`,
      name: name.trim(),
      color: COLOR_PALETTE[businessGroups.length % COLOR_PALETTE.length],
      tableIds: selectedTables.map((t) => t.id),
    };

    setBusinessGroups((prev) => [...prev, newGroup]);

    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        selected: false,
      }))
    );
  }, [selectedTables, businessGroups, pushHistory]);

  const computedGroupNodes = useMemo(() => {
    if (!businessGroups || businessGroups.length === 0) return [];

    return businessGroups
      .map((group) => {
        const memberNodes = nodes.filter(
          (n) => n.type === 'tableNode' && group.tableIds && group.tableIds.includes(n.id)
        );

        if (memberNodes.length === 0) return null;

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        memberNodes.forEach((node) => {
          const w = node.measured?.width || 260;
          const colCount = node.data?.columns?.length || 1;
          const h = node.measured?.height || (45 + colCount * 28);

          if (node.position.x < minX) minX = node.position.x;
          if (node.position.y < minY) minY = node.position.y;
          if (node.position.x + w > maxX) maxX = node.position.x + w;
          if (node.position.y + h > maxY) maxY = node.position.y + h;
        });

        const paddingX = 24;
        const paddingTop = 36;
        const paddingBottom = 20;

        const groupX = minX - paddingX;
        const groupY = minY - paddingTop;
        const groupWidth = maxX - minX + paddingX * 2;
        const groupHeight = maxY - minY + paddingTop + paddingBottom;

        return {
          id: group.id,
          type: 'groupNode',
          position: { x: groupX, y: groupY },
          width: groupWidth,
          height: groupHeight,
          draggable: true,
          dragHandle: '.group-node-header',
          style: {
            width: groupWidth,
            height: groupHeight,
            zIndex: -1,
          },
          zIndex: -1,
          selectable: false,
          data: {
            id: group.id,
            label: group.name,
            color: group.color,
            tableIds: group.tableIds,
            onDelete: handleDeleteGroup,
          },
        };
      })
      .filter(Boolean);
  }, [businessGroups, nodes, handleDeleteGroup]);

  const allDisplayNodes = useMemo(() => {
    return [...computedGroupNodes, ...nodes];
  }, [computedGroupNodes, nodes]);

  const processSQLContent = useCallback((content, recordHistory = true, preservePositions = true) => {
    console.time('⏱️ Traitement SQL global');

    if (recordHistory) {
      pushHistory();
    }

    lastProcessedSqlRef.current = content;
    setSqlInput(content);

    console.time('⏱️ Parsing SQL (sqlParser)');
    const { tables, edges: parsedEdges } = parseSQLScript(content);
    console.timeEnd('⏱️ Parsing SQL (sqlParser)');
    console.log(`📊 Statistiques du Parsing : ${tables.length} tables détectées, ${parsedEdges.length} relations identifiées.`);

    if (preservePositions) {
      console.time('⏱️ Mise à jour des positions existantes');
      setNodes((prevNodes) => {
        const tableOnlyNodes = prevNodes.filter((n) => n.type === 'tableNode');
        const currentPositions = new Map(tableOnlyNodes.map((node) => [node.id, node.position]));

        let defaultX = 100;
        let defaultY = 100;
        if (tableOnlyNodes.length > 0) {
          const maxX = Math.max(...tableOnlyNodes.map((n) => n.position.x));
          defaultX = maxX + 320;
        }

        const updatedNodes = tables.map((table) => {
          const existingPos = currentPositions.get(table.id);
          const nodeData = {
            name: table.name,
            columns: table.columns,
            inserts: table.inserts,
            onOpenInserts: () => setSelectedInsertModal({ tableName: table.name, ...table.inserts }),
            onOpenComment: (col) => setSelectedCommentModal({ table: table.name, column: col.name, comment: col.comment }),
          };

          if (existingPos) {
            return {
              id: table.id,
              type: 'tableNode',
              position: existingPos,
              targetPosition: 'left',
              sourcePosition: 'right',
              data: nodeData,
            };
          } else {
            const newPos = { x: defaultX, y: defaultY };
            defaultY += 200;
            return {
              id: table.id,
              type: 'tableNode',
              position: newPos,
              targetPosition: 'left',
              sourcePosition: 'right',
              data: nodeData,
            };
          }
        });

        const updatedEdges = updateEdgeHandles(updatedNodes, parsedEdges);
        setEdges(updatedEdges);
        return updatedNodes;
      });
      console.timeEnd('⏱️ Mise à jour des positions existantes');
    } else {
      console.time('⏱️ Calcul Layout');
      const initialNodes = tables.map((table) => ({
        id: table.id,
        type: 'tableNode',
        position: { x: 0, y: 0 },
        data: {
          name: table.name,
          columns: table.columns,
          inserts: table.inserts,
          onOpenInserts: () => setSelectedInsertModal({ tableName: table.name, ...table.inserts }),
          onOpenComment: (col) => setSelectedCommentModal({ table: table.name, column: col.name, comment: col.comment }),
        },
      }));

      if (tables.length > 80) {
        console.warn('⚠️ Grand nombre de tables (>80), application d’une disposition en grille optimisée par ordre alphabétique.');
        const COLS = 8;
        const sortedTables = [...tables].sort((a, b) => a.name.localeCompare(b.name));
        const gridNodes = sortedTables.map((table, idx) => ({
          id: table.id,
          type: 'tableNode',
          targetPosition: 'left',
          sourcePosition: 'right',
          position: {
            x: (idx % COLS) * 320,
            y: Math.floor(idx / COLS) * 450,
          },
          data: {
            name: table.name,
            columns: table.columns,
            inserts: table.inserts,
            onOpenInserts: () => setSelectedInsertModal({ tableName: table.name, ...table.inserts }),
            onOpenComment: (col) => setSelectedCommentModal({ table: table.name, column: col.name, comment: col.comment }),
          },
        }));
        const gridEdges = updateEdgeHandles(gridNodes, parsedEdges);
        setNodes(gridNodes);
        setEdges(gridEdges);
      } else {
        const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
          initialNodes,
          parsedEdges,
          'LR'
        );
        setNodes(layoutedNodes);
        setEdges(layoutedEdges);
      }
      console.timeEnd('⏱️ Calcul Layout');
    }

    console.timeEnd('⏱️ Traitement SQL global');
  }, [pushHistory]);

  useEffect(() => {
    if (sqlInput === lastProcessedSqlRef.current) return;

    const timer = setTimeout(() => {
      processSQLContent(sqlInput, true, true);
    }, 400);

    return () => clearTimeout(timer);
  }, [sqlInput, processSQLContent]);

  const handleUndo = useCallback(() => {
    setHistory((prevHistory) => {
      if (prevHistory.length === 0) return prevHistory;
      const previousState = prevHistory[prevHistory.length - 1];
      const newHistory = prevHistory.slice(0, prevHistory.length - 1);

      isUndoingRef.current = true;
      setNodes(previousState.nodes);
      setEdges(updateEdgeHandles(previousState.nodes, previousState.edges));
      setBusinessGroups(previousState.businessGroups);
      setSqlInput(previousState.sqlInput);
      setDbName(previousState.dbName);
      setShowSuggestions(previousState.showSuggestions);
      lastProcessedSqlRef.current = previousState.sqlInput;

      setTimeout(() => {
        isUndoingRef.current = false;
      }, 50);

      return newHistory;
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') {
          return;
        }
        e.preventDefault();
        handleUndo();
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        exportJSON(sqlInput, showSuggestions, nodes, edges, dbName, businessGroups);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, sqlInput, showSuggestions, nodes, edges, dbName, businessGroups]);

  const isValidSQLFile = (file) => {
    if (!file) return false;
    const fileName = file.name.toLowerCase();
    const hasValidExtension = ALLOWED_EXTENSIONS.some((ext) => fileName.endsWith(ext));
    const hasValidMime = file.type === '' || ALLOWED_MIME_TYPES.includes(file.type);

    return hasValidExtension && hasValidMime;
  };

  const validateAndReadFile = (file) => {
    if (!isValidSQLFile(file)) {
      alert("Format non supporté. Veuillez fournir un fichier avec l'extension .sql ou .txt.");
      return;
    }

    setIsLoading(true);
    setLoadingMessage('Analyse et chargement du fichier SQL...');

    console.log(`📂 Début de lecture du fichier : ${file.name} (${Math.round(file.size / 1024)} Ko)`);
    console.time('⏱️ FileReader lecture');

    const reader = new FileReader();
    reader.onload = (event) => {
      console.timeEnd('⏱️ FileReader lecture');
      const content = event.target.result;
      pushHistory();
      setBusinessGroups([]);

      setTimeout(() => {
        processSQLContent(content, false, false);
        setIsLoading(false);
      }, 10);
    };
    reader.onerror = () => {
      console.error('❌ Erreur lors de la lecture du fichier.');
      alert('Erreur lors de la lecture du fichier.');
      setIsLoading(false);
    };
    reader.readAsText(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDraggingFile) setIsDraggingFile(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      validateAndReadFile(files[0]);
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    validateAndReadFile(file);
    e.target.value = '';
  };

  const onNodesChange = useCallback(
    (changes) => {
      setNodes((nds) => {
        const updatedNodes = applyNodeChanges(changes, nds);
        const hasPositionChange = changes.some(
          (c) => c.type === 'position' || c.type === 'drag'
        );
        if (hasPositionChange) {
          setEdges((egs) => updateEdgeHandles(updatedNodes, egs));
        }
        return updatedNodes;
      });
    },
    []
  );

  const onEdgesChange = useCallback(
    (changes) => setEdges((egs) => applyEdgeChanges(changes, egs)),
    []
  );

  const onNodeDragStart = useCallback((event, node) => {
    pushHistory();
    if (node.type === 'groupNode') {
      groupDragStartPosRef.current = { x: node.position.x, y: node.position.y };
    }
  }, [pushHistory]);

  const onNodeDrag = useCallback(
    (event, draggedNode) => {
      if (draggedNode.type === 'groupNode') {
        if (!groupDragStartPosRef.current) return;

        const dx = draggedNode.position.x - groupDragStartPosRef.current.x;
        const dy = draggedNode.position.y - groupDragStartPosRef.current.y;

        if (dx === 0 && dy === 0) return;

        groupDragStartPosRef.current = {
          x: draggedNode.position.x,
          y: draggedNode.position.y,
        };

        const memberIds = draggedNode.data.tableIds || [];

        setNodes((prevNodes) => {
          const updatedNodes = prevNodes.map((n) => {
            if (memberIds.includes(n.id)) {
              return {
                ...n,
                position: {
                  x: n.position.x + dx,
                  y: n.position.y + dy,
                },
              };
            }
            return n;
          });
          setEdges((egs) => updateEdgeHandles(updatedNodes, egs));
          return updatedNodes;
        });
        return;
      }

      let horizontalLine = null;
      let verticalLine = null;

      let snappedX = draggedNode.position.x;
      let snappedY = draggedNode.position.y;

      nodes.forEach((otherNode) => {
        if (otherNode.id === draggedNode.id || otherNode.type !== 'tableNode') return;

        if (Math.abs(otherNode.position.x - snappedX) < SNAP_THRESHOLD) {
          snappedX = otherNode.position.x;
          verticalLine = snappedX;
        }

        if (Math.abs(otherNode.position.y - snappedY) < SNAP_THRESHOLD) {
          snappedY = otherNode.position.y;
          horizontalLine = snappedY;
        }
      });

      lastSnappedPosRef.current = {
        id: draggedNode.id,
        position: { x: snappedX, y: snappedY },
      };

      setHelperLines({ horizontal: horizontalLine, vertical: verticalLine });
    },
    [nodes]
  );

  const onNodeDragStop = useCallback(
    (event, draggedNode) => {
      if (draggedNode.type === 'groupNode') {
        groupDragStartPosRef.current = null;
        return;
      }

      setHelperLines({ horizontal: null, vertical: null });

      const finalX = lastSnappedPosRef.current?.position?.x ?? draggedNode.position.x;
      const finalY = lastSnappedPosRef.current?.position?.y ?? draggedNode.position.y;

      setNodes((nds) => {
        const updated = nds.map((n) =>
          n.id === draggedNode.id ? { ...n, position: { x: finalX, y: finalY } } : n
        );
        setEdges((egs) => updateEdgeHandles(updated, egs));
        return updated;
      });

      lastSnappedPosRef.current = null;
    },
    []
  );

  const handleResetLayout = () => {
    const tableNodes = nodes.filter((n) => n.type === 'tableNode');
    if (tableNodes.length > 80) {
      alert(`Impossible d'appliquer l'Auto-Layout : le schéma contient trop de tables (${tableNodes.length} > 80). Le calcul automatique est désactivé pour éviter de bloquer l'interface.`);
      return;
    }

    pushHistory();

    const resetNodes = nodes.map((n) => ({
      ...n,
      position: { x: 0, y: 0 },
    }));

    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      resetNodes,
      edges,
      'LR'
    );
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
  };

  const handleApplySqlToScript = (sqlSnippet) => {
    const updatedSql = `${sqlInput.trim()}\n\n${sqlSnippet}`;
    processSQLContent(updatedSql, true, true);
    setSelectedEdgeModal(null);
  };

  const handleImportJSON = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsLoading(true);
    setLoadingMessage('Importation du projet JSON...');

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        
        setHistory([]);

        setBusinessGroups(Array.isArray(parsed.businessGroups) ? parsed.businessGroups : []);
        setDbName(parsed.dbName !== undefined ? parsed.dbName : 'mon_schema');
        if (parsed.showSuggestions !== undefined) setShowSuggestions(parsed.showSuggestions);

        setTimeout(() => {
          if (parsed.sqlInput !== undefined && parsed.sqlInput.trim() !== '') {
            processSQLContent(parsed.sqlInput, false, false);
            
            if (parsed.nodes && Array.isArray(parsed.nodes)) {
              setNodes((prevNodes) => {
                const posMap = new Map(parsed.nodes.map((n) => [n.id, n.position]));
                const mergedNodes = prevNodes.map((n) =>
                  posMap.has(n.id) ? { ...n, position: posMap.get(n.id) } : n
                );
                if (parsed.edges) {
                  setEdges(updateEdgeHandles(mergedNodes, parsed.edges));
                }
                return mergedNodes;
              });
            }
          } else if (parsed.nodes && parsed.edges) {
            setNodes(parsed.nodes);
            setEdges(updateEdgeHandles(parsed.nodes, parsed.edges));
          }
          setIsLoading(false);
        }, 10);

      } catch (err) {
        alert('Fichier de sauvegarde invalide.');
        setIsLoading(false);
      }
    };
    reader.onerror = () => {
      alert('Erreur lors de la lecture du fichier JSON.');
      setIsLoading(false);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const visibleEdges = useMemo(() => {
    if (!showSuggestions) return edges.filter((edge) => !edge.data?.isSuggested);
    
    // Vérification de la limite du nombre de FK suggérées ou totales
    if (edges.length > MAX_FK_THRESHOLD) {
      alert(`⚠️ Trop de clés étrangères détectées (${edges.length}). L'affichage des suggestions est désactivé pour éviter de surcharger l'interface (limite fixée à ${MAX_FK_THRESHOLD}).`);
      setShowSuggestions(false);
      return edges.filter((edge) => !edge.data?.isSuggested);
    }

    return edges;
  }, [edges, showSuggestions]);

  const onEdgeClick = useCallback((event, edge) => {
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

    const sourceCol = edge.data?.sourceCol || extractColName(edge.sourceHandle, edge.source);
    const targetCol = edge.data?.targetCol || extractColName(edge.targetHandle, edge.target);

    setSelectedEdgeModal({
      ...edge.data,
      sourceTable: edge.source,
      sourceCol: sourceCol,
      targetTable: edge.target,
      targetCol: targetCol,
    });
    setCopiedKey(null);
  }, []);

  const handleCopy = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const generateModalOptions = (data) => {
    if (!data) return [];
    const { isSuggested, sourceTable, sourceCol, targetTable, targetCol, scriptA, scriptB } = data;

    if (isSuggested) {
      return [
        {
          key: 'alterA',
          label: `Ajouter FK sur ${sourceTable} (${sourceCol} ➔ ${targetTable}.${targetCol})`,
          sql: scriptA || `ALTER TABLE ${sourceTable}\nADD CONSTRAINT fk_${sourceTable}_${sourceCol}\nFOREIGN KEY (${sourceCol}) REFERENCES ${targetTable}(${targetCol});`,
        },
        {
          key: 'alterB',
          label: `Ajouter FK sur ${targetTable} (${targetCol} ➔ ${sourceTable}.${sourceCol})`,
          sql: scriptB || `ALTER TABLE ${targetTable}\nADD CONSTRAINT fk_${targetTable}_${targetCol}\nFOREIGN KEY (${targetCol}) REFERENCES ${sourceTable}(${sourceCol});`,
        },
      ];
    }

    const innerJoin = `SELECT *\nFROM ${sourceTable}\nINNER JOIN ${targetTable}\n  ON ${sourceTable}.${sourceCol} = ${targetTable}.${targetCol};`;
    const reverseInnerJoin = `SELECT *\nFROM ${targetTable}\nINNER JOIN ${sourceTable}\n  ON ${targetTable}.${targetCol} = ${sourceTable}.${sourceCol};`;

    return [
      { key: 'inner', label: `INNER JOIN (${sourceTable} ➔ ${targetTable})`, sql: innerJoin },
      { key: 'reverse', label: `INNER JOIN Inversé (${targetTable} ➔ ${sourceTable})`, sql: reverseInnerJoin },
    ];
  };

  return (
    <div className="app-container">
      {isLoading && (
        <div className="global-loading-overlay">
          <div className="global-loading-spinner-box">
            <div className="spinner-circle"></div>
            <span>{loadingMessage}</span>
          </div>
        </div>
      )}

      <div className="sidebar">
        <h2>SQL Schema Mapper</h2>
        <div className="sidebar-section">
          <label className="sidebar-section-title">Importer un projet :</label>
          <div className="export-grid">
            <label className="btn-import-json">
              Import JSON
              <input
                type="file"
                accept=".json"
                onChange={handleImportJSON}
              />
            </label>
          </div>
        </div>

        <div className="sidebar-section">
          <label className="sidebar-section-title">Nom de la base de données :</label>
          <input
            type="text"
            value={dbName}
            onChange={(e) => {
              pushHistory();
              setDbName(e.target.value);
            }}
            placeholder="Nom de la base..."
            className="db-name-input"
          />
        </div>

        <div
          className={`drop-zone ${isDraggingFile ? 'dragging' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <textarea
            value={sqlInput}
            onChange={(e) => setSqlInput(e.target.value)}
            placeholder="Glisse-dépose un fichier SQL/TXT ici ou colle le..."
          />

          <label className="file-browse-label">
            📁 Parcourir un fichier SQL / TXT
            <input
              type="file"
              accept=".sql,.txt"
              onChange={handleFileSelect}
            />
          </label>
        </div>

        <div className="action-buttons-row">
          <button
            onClick={handleUndo}
            disabled={history.length === 0}
            className="btn-undo"
            title="Annuler la dernière action (Ctrl+Z)"
          >
            Annuler (Ctrl+Z)
          </button>
          <button
            onClick={handleResetLayout}
            className="btn-layout"
            title="Réorganiser automatiquement l'emplacement des cartes"
          >
            Auto-Layout
          </button>
        </div>

        <div className="sidebar-section">
          <label className="sidebar-section-title">Objets Métiers :</label>
          {selectedTables.length > 0 && (
            <span className="selected-count-badge">
              ✓ {selectedTables.length} table(s) sélectionnée(s)
            </span>
          )}
          <button
            onClick={handleCreateBusinessGroup}
            disabled={selectedTables.length === 0}
            className="btn-create-group"
            title="Sélectionne une ou plusieurs tables sur le schéma pour les regrouper"
          >
            Grouper les tables sélectionnées
          </button>

          {businessGroups.length > 0 && (
            <div className="groups-list">
              {businessGroups.map((group) => (
                <div key={group.id} className="group-item">
                  <div className="group-item-header">
                    <span
                      className="group-color-indicator"
                      style={{ backgroundColor: group.color }}
                      onClick={() => handleChangeGroupColor(group.id)}
                      title="Cliquer pour changer la couleur"
                    />
                    <span className="group-item-title">{group.name}</span>
                    <div className="group-item-actions">
                      <button
                        className="group-action-btn"
                        onClick={() => handleRenameGroup(group.id)}
                        title="Renommer"
                      >
                        ✏️
                      </button>
                      <button
                        className="group-action-btn"
                        onClick={() => handleDeleteGroup(group.id)}
                        title="Supprimer"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                  <div className="group-item-tables">
                    {group.tableIds.join(', ')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="sidebar-section">
          <label className="sidebar-section-title">Suggestions de FK :</label>
          <div className="radio-group">
            <label className="radio-label">
              <input
                type="radio"
                name="fkSuggestions"
                checked={showSuggestions === true}
                onChange={() => {
                  pushHistory();
                  setShowSuggestions(true);
                }}
              />
              Afficher
            </label>
            <label className="radio-label">
              <input
                type="radio"
                name="fkSuggestions"
                checked={showSuggestions === false}
                onChange={() => {
                  pushHistory();
                  setShowSuggestions(false);
                }}
              />
              Masquer
            </label>
          </div>
        </div>

        <div className="sidebar-section">
          <label className="sidebar-section-title">Sauvegarde & Exportation :</label>
          <div className="export-grid">
            <button onClick={() => exportSQL(sqlInput, dbName)} className="btn-export-sql">
              Export SQL
            </button>
            <button onClick={() => exportHTML(nodes, edges, showSuggestions, dbName, businessGroups)} className="btn-export-html">
              Export HTML
            </button>
            <button onClick={() => exportJSON(sqlInput, showSuggestions, nodes, edges, dbName, businessGroups)} className="btn-export-json" title="Ctrl+S">
              Sauvegarde JSON
            </button>
          </div>
        </div>
      </div>

      <div className="canvas">
        <ReactFlow
          nodes={allDisplayNodes}
          edges={visibleEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onEdgeClick={onEdgeClick}
          fitView
        >
          <Background />
          <Controls />
          <HelperLinesRenderer
            horizontal={helperLines.horizontal}
            vertical={helperLines.vertical}
          />
        </ReactFlow>
      </div>

      {selectedEdgeModal && (
        <div className="modal-overlay" onClick={() => setSelectedEdgeModal(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>
              {selectedEdgeModal.isSuggested ? 'Clé étrangère suggérée' : 'Lien Clé Étrangère'}
            </h3>
            <p>
              Relation entre : <strong>{selectedEdgeModal.sourceTable}.{selectedEdgeModal.sourceCol}</strong> et <strong>{selectedEdgeModal.targetTable}.{selectedEdgeModal.targetCol}</strong>
              {selectedEdgeModal.isSuggested && selectedEdgeModal.similarityScore && (
                <span className="modal-similarity-badge">
                  (Similarité : {selectedEdgeModal.similarityScore}%)
                </span>
              )}
            </p>

            {generateModalOptions(selectedEdgeModal).map((q) => (
              <div key={q.key} className="option-block">
                <h4>{q.label}</h4>
                <pre>{q.sql}</pre>
                <div className="modal-btn-row">
                  <button
                    onClick={() => handleCopy(q.sql, q.key)}
                    className="btn-copy"
                  >
                    {copiedKey === q.key ? 'Copié !' : 'Copier le script'}
                  </button>
                  {selectedEdgeModal.isSuggested && (
                    <button
                      onClick={() => handleApplySqlToScript(q.sql)}
                      className="btn-apply-script"
                    >
                      Appliquer au script
                    </button>
                  )}
                </div>
              </div>
            ))}

            <div className="modal-actions">
              <button
                onClick={() => setSelectedEdgeModal(null)}
                className="btn-close"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedInsertModal && (
        <div className="modal-overlay" onClick={() => setSelectedInsertModal(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Données de la table : {selectedInsertModal.tableName}</h3>
            <div className="modal-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    {selectedInsertModal.columns.map((colName, idx) => (
                      <th key={idx}>
                        {colName}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {selectedInsertModal.rows.map((row, rIdx) => (
                    <tr key={rIdx}>
                      {row.map((val, vIdx) => (
                        <td key={vIdx}>
                          {val !== null ? val : ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="modal-actions">
              <button
                onClick={() => setSelectedInsertModal(null)}
                className="btn-close"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedCommentModal && (
        <div className="modal-overlay" onClick={() => setSelectedCommentModal(null)}>
          <div className="modal-content modal-content-sm" onClick={(e) => e.stopPropagation()}>
            <h3>Commentaire</h3>
            <p className="modal-subtitle">
              Colonne : <strong>{selectedCommentModal.table}.{selectedCommentModal.column}</strong>
            </p>
            <div className="option-block option-block-spaced">
              <p className="comment-text">
                {selectedCommentModal.comment}
              </p>
            </div>
            <div className="modal-actions">
              <button
                onClick={() => setSelectedCommentModal(null)}
                className="btn-close"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}