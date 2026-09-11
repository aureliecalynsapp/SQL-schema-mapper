import { MarkerType } from '@xyflow/react';

function calculateSimilarity(str1, str2) {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();

  if (s1 === s2) return 100;
  if (!s1.length || !s2.length) return 0;

  const track = Array(s2.length + 1)
    .fill(null)
    .map(() => Array(s1.length + 1).fill(null));

  for (let i = 0; i <= s1.length; i++) track[0][i] = i;
  for (let j = 0; j <= s2.length; j++) track[j][0] = j;

  for (let j = 1; j <= s2.length; j++) {
    for (let i = 1; i <= s1.length; i++) {
      const indicator = s1[i - 1] === s2[j - 1] ? 0 : 1;
      track[j][i] = Math.min(
        track[j][i - 1] + 1,
        track[j - 1][i] + 1,
        track[j - 1][i - 1] + indicator
      );
    }
  }

  const distance = track[s2.length][s1.length];
  const maxLength = Math.max(s1.length, s2.length);
  return ((maxLength - distance) / maxLength) * 100;
}

function isDateColumn(col) {
  const type = (col.type || '').toUpperCase();
  const name = (col.name || '').toLowerCase();

  const dateTypes = ['DATE', 'DATETIME', 'TIMESTAMP', 'TIME'];
  const isTypeDate = dateTypes.some((dt) => type.includes(dt));

  const isNameDate =
    name.endsWith('_date') ||
    name.endsWith('_at') ||
    name.startsWith('date_') ||
    name.includes('created') ||
    name.includes('modified') ||
    name.includes('updated');

  return isTypeDate || isNameDate;
}

function splitSqlDefinitions(body) {
  const results = [];
  let current = '';
  let depth = 0;

  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (char === '(') depth++;
    else if (char === ')') depth--;

    if (char === ',' && depth === 0) {
      if (current.trim()) {
        results.push(current);
      }
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) {
    results.push(current);
  }
  return results;
}

function parseInsertValues(valuesStr) {
  const rows = [];
  let currentRow = [];
  let currentVal = '';
  let inString = false;
  let escape = false;
  let depth = 0;

  for (let i = 0; i < valuesStr.length; i++) {
    const char = valuesStr[i];

    if (escape) {
      currentVal += char;
      escape = false;
      continue;
    }

    if (char === '\\') {
      escape = true;
      currentVal += char;
      continue;
    }

    if (char === "'" && !escape) {
      inString = !inString;
      currentVal += char;
      continue;
    }

    if (!inString) {
      if (char === '(') {
        if (depth === 0) {
          currentRow = [];
          currentVal = '';
        } else {
          currentVal += char;
        }
        depth++;
        continue;
      }
      if (char === ')') {
        depth--;
        if (depth === 0) {
          currentRow.push(currentVal.trim().replace(/^['"]|['"]$/g, ''));
          rows.push(currentRow);
          currentVal = '';
        } else {
          currentVal += char;
        }
        continue;
      }
      if (char === ',' && depth === 1) {
        currentRow.push(currentVal.trim().replace(/^['"]|['"]$/g, ''));
        currentVal = '';
        continue;
      }
    }

    if (depth > 0) {
      currentVal += char;
    }
  }
  return rows;
}

export function parseSQLScript(sqlString) {
  let tables = [];
  let fkEdges = [];
  let explicitFkSet = new Set();
  let columnComments = {};
  let tableInserts = {};

  if (!sqlString || typeof sqlString !== 'string') {
    return { tables, edges: fkEdges };
  }

  const cleanSql = sqlString
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  // 1. Parse Comments
  const commentRegex = /COMMENT\s+ON\s+COLUMN\s+([`"']?[a-zA-Z0-9_]+[`"']?)\.([`"']?[a-zA-Z0-9_]+[`"']?)\s+IS\s+'([^']*(?:''[^']*)*)'/gi;
  let commentMatch;
  while ((commentMatch = commentRegex.exec(cleanSql)) !== null) {
    const tableName = commentMatch[1].replace(/[`"']/g, '').trim().toLowerCase();
    const colName = commentMatch[2].replace(/[`"']/g, '').trim().toLowerCase();
    const rawComment = commentMatch[3];
    const commentText = rawComment.replace(/''/g, "'").trim();

    if (!columnComments[tableName]) {
      columnComments[tableName] = {};
    }
    columnComments[tableName][colName] = commentText;
  }

  // 2. Parse INSERT INTO statements (robustifié pour supporter tous formats de noms de tables)
  const insertRegex = /INSERT\s+INTO\s+([^\s(]+)\s*\(([^)]+)\)\s*VALUES\s*([\s\S]*?)(?=;|$)/gi;
  let insertMatch;
  while ((insertMatch = insertRegex.exec(cleanSql)) !== null) {
    const rawTableName = insertMatch[1].trim();
    const tableName = rawTableName.replace(/[`"']/g, '');
    const tableNameLower = tableName.toLowerCase();
    const columns = insertMatch[2].split(',').map(c => c.replace(/[`"']/g, '').trim());
    const valuesClause = insertMatch[3].trim();

    const rows = parseInsertValues(valuesClause);

    if (!tableInserts[tableNameLower]) {
      tableInserts[tableNameLower] = { columns, rows: [] };
    }
    tableInserts[tableNameLower].rows.push(...rows);
  }

  // 3. Parse CREATE TABLE statements
  const tableBlockRegex =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)\s*\(([\s\S]*?\);\s*)/gi;
  let match;

  while ((match = tableBlockRegex.exec(cleanSql)) !== null) {
    try {
      const tableName = match[1].replace(/[`"']/g, '').trim();
      const body = match[2].trim();
      const columns = [];
      const primaryKeyCols = new Set();

      const definitions = splitSqlDefinitions(body);

      definitions.forEach((def) => {
        const trimmedDef = def.trim();
        const pkMatch = trimmedDef.match(
          /^(?:CONSTRAINT\s+[`"']?[a-zA-Z0-9_]+[`"']?\s+)?PRIMARY\s+KEY\s*\(([^)]+)\)/i
        );
        if (pkMatch) {
          const pkCols = pkMatch[1].split(',').map((c) => c.replace(/[`"']/g, '').trim());
          pkCols.forEach((col) => primaryKeyCols.add(col));
        }
      });

      definitions.forEach((def) => {
        try {
          const trimmedDef = def.trim();
          if (!trimmedDef) return;

          const fkMatch = trimmedDef.match(
            /^(?:CONSTRAINT\s+[`"']?[a-zA-Z0-9_]+[`"']?\s+)?FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+([^\s(]+)\s*\(([^)]+)\)/i
          );
          if (fkMatch) {
            const sourceCol = fkMatch[1].trim().replace(/[`"']/g, '');
            const targetTable = fkMatch[2].trim().replace(/[`"']/g, '');
            const targetCol = fkMatch[3].trim().replace(/[`"']/g, '');

            const isSelfReference = tableName === targetTable;
            explicitFkSet.add(`${tableName}.${sourceCol}->${targetTable}.${targetCol}`);

            fkEdges.push({
              id: `fk-${tableName}.${sourceCol}->${targetTable}.${targetCol}`,
              source: tableName,
              sourceHandle: `${tableName}-${sourceCol}-source`,
              target: targetTable,
              targetHandle: `${targetTable}-${targetCol}-target`,
              type: isSelfReference ? 'smoothstep' : 'default',
              style: { stroke: '#0284c7', strokeWidth: 2 },
              markerEnd: {
                type: MarkerType.ArrowClosed,
                color: '#0284c7',
                width: 16,
                height: 16,
              },
              label: 'FK',
              data: {
                isSuggested: false,
                sourceTable: tableName,
                sourceCol,
                targetTable,
                targetCol,
              },
            });
            return;
          }

          if (/^(PRIMARY\s+KEY|UNIQUE|CONSTRAINT|CHECK|KEY)/i.test(trimmedDef)) {
            return;
          }

          const colMatch = trimmedDef.match(
            /^([`"']?[a-zA-Z0-9_]+[`"']?)\s+([a-zA-Z0-9_]+(?:\s*\([^)]*\))?)([\s\S]*)/
          );
          if (colMatch) {
            const colName = colMatch[1].replace(/[`"']/g, '');
            const colType = colMatch[2].toUpperCase();
            const colRest = colMatch[3] || '';

            const isInlinePk = /PRIMARY\s+KEY/i.test(colRest);
            const isPk = isInlinePk || primaryKeyCols.has(colName);
            const isNotNull = isPk || /NOT\s+NULL/i.test(colRest);

            const tKey = tableName.toLowerCase();
            const cKey = colName.toLowerCase();
            const comment = columnComments[tKey]?.[cKey] || null;

            columns.push({
              name: colName,
              type: colType,
              isPk,
              isNotNull,
              comment,
            });
          }
        } catch (innerErr) {
          console.warn('Ligne ignorée dans la table:', def, innerErr);
        }
      });

      if (tableName) {
        const lowerName = tableName.toLowerCase();
        tables.push({
          id: tableName,
          name: tableName,
          columns,
          inserts: tableInserts[lowerName] || null,
        });
      }
    } catch (tableErr) {
      console.warn("Erreur de lecture d'un bloc table:", tableErr);
    }
  }

  // 4. Parse ALTER TABLE ADD COLUMN statements (exige explicitement le mot-clé COLUMN)
  try {
    const alterAddColRegex = /ALTER\s+TABLE\s+([`"']?[a-zA-Z0-9_]+[`"']?)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"']?[a-zA-Z0-9_]+[`"']?)\s+([a-zA-Z0-9_]+(?:\s*\([^)]*\))?)([\s\S]*?)(?=;|$)/gi;
    let addColMatch;

    while ((addColMatch = alterAddColRegex.exec(cleanSql)) !== null) {
      const tableName = addColMatch[1].replace(/[`"']/g, '').trim();
      const colName = addColMatch[2].replace(/[`"']/g, '').trim();
      const colType = addColMatch[3].toUpperCase();
      const colRest = addColMatch[4] || '';

      const targetTable = tables.find(
        (t) => t.name.toLowerCase() === tableName.toLowerCase()
      );

      if (targetTable) {
        const alreadyExists = targetTable.columns.some(
          (c) => c.name.toLowerCase() === colName.toLowerCase()
        );

        if (!alreadyExists) {
          const isPk = /PRIMARY\s+KEY/i.test(colRest);
          const isNotNull = isPk || /NOT\s+NULL/i.test(colRest);
          
          const tKey = targetTable.name.toLowerCase();
          const cKey = colName.toLowerCase();
          const comment = columnComments[tKey]?.[cKey] || null;

          targetTable.columns.push({
            name: colName,
            type: colType,
            isPk,
            isNotNull,
            comment,
          });
        }
      }
    }
  } catch (err) {
    console.warn('Erreur sur les ALTER TABLE ADD COLUMN:', err);
  }

  // 5. Parse ALTER TABLE FOREIGN KEY statements
  try {
    const alterTableRegex =
      /ALTER\s+TABLE\s+([`"']?[a-zA-Z0-9_]+[`"']?)\s+ADD\s+(?:CONSTRAINT\s+[`"']?[a-zA-Z0-9_]+[`"']?\s+)?FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+([`"']?[a-zA-Z0-9_]+[`"']?)\s*\(([^)]+)\)/gi;
    let alterMatch;

    while ((alterMatch = alterTableRegex.exec(cleanSql)) !== null) {
      const tableName = alterMatch[1].replace(/[`"']/g, '').trim();
      const sourceCol = alterMatch[2].replace(/[`"']/g, '').trim();
      const targetTable = alterMatch[3].replace(/[`"']/g, '').trim();
      const targetCol = alterMatch[4].replace(/[`"']/g, '').trim();

      const isSelfReference = tableName === targetTable;
      explicitFkSet.add(`${tableName}.${sourceCol}->${targetTable}.${targetCol}`);

      fkEdges.push({
        id: `fk-alter-${tableName}.${sourceCol}->${targetTable}.${targetCol}`,
        source: tableName,
        sourceHandle: `${tableName}.${sourceCol}-source`,
        target: targetTable,
        targetHandle: `${targetTable}.${targetCol}-target`,
        type: isSelfReference ? 'smoothstep' : 'default',
        style: { stroke: '#0284c7', strokeWidth: 2 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: '#0284c7',
          width: 16,
          height: 16,
        },
        label: 'FK',
        data: {
          isSuggested: false,
          sourceTable: tableName,
          sourceCol,
          targetTable,
          targetCol,
        },
      });
    }
  } catch (err) {
    console.warn('Erreur sur les ALTER TABLE FK:', err);
  }

  // 6. Parse Suggested Foreign Keys
  try {
    const suggestedPairsSet = new Set();

    tables.forEach((tableA, i) => {
      tableA.columns.forEach((colA) => {
        if (isDateColumn(colA)) return;

        tables.forEach((tableB, j) => {
          if (i === j) return;

          tableB.columns.forEach((colB) => {
            if (isDateColumn(colB)) return;

            const sim = calculateSimilarity(colA.name, colB.name);
            const isSubMatch =
              colA.name.includes(colB.name) || colB.name.includes(colA.name);

            if (
              sim >= 99 ||
              (isSubMatch &&
                colA.name !== colB.name &&
                colA.name.length > 2 &&
                colB.name.length > 2 &&
                sim >= 90)
            ) {
              const pairKey = [
                `${tableA.id}.${colA.name}`,
                `${tableB.id}.${colB.name}`,
              ]
                .sort()
                .join('<->');

              const explicit1 = `${tableA.id}.${colA.name}->${tableB.id}.${colB.name}`;
              const explicit2 = `${tableB.id}.${colB.name}->${tableA.id}.${colA.name}`;

              if (
                !explicitFkSet.has(explicit1) &&
                !explicitFkSet.has(explicit2) &&
                !suggestedPairsSet.has(pairKey)
              ) {
                suggestedPairsSet.add(pairKey);

                fkEdges.push({
                  id: `suggested-${tableA.id}.${colA.name}<->${tableB.id}.${colB.name}`,
                  source: tableA.id,
                  sourceHandle: `${tableA.id}.${colA.name}-source`,
                  target: tableB.id,
                  targetHandle: `${tableB.id}.${colB.name}-target`,
                  style: { stroke: '#f97316', strokeDasharray: '5,5', strokeWidth: 2 },
                  markerEnd: {
                    type: MarkerType.ArrowClosed,
                    color: '#f97316',
                    width: 16,
                    height: 16,
                  },
                  label: 'FK ?',
                  labelStyle: { fill: '#f97316', fontWeight: 700 },
                  data: {
                    isSuggested: true,
                    sourceTable: tableA.id,
                    sourceCol: colA.name,
                    targetTable: tableB.id,
                    targetCol: colB.name,
                    tableA: tableA.id,
                    colA: colA.name,
                    tableB: tableB.id,
                    colB: colB.name,
                    similarityScore: Math.round(sim),
                    scriptA: `ALTER TABLE ${tableA.id}\nADD CONSTRAINT fk_${tableA.id}_${colA.name}\nFOREIGN KEY (${colA.name}) REFERENCES ${tableB.id}(${colB.name});`,
                    scriptB: `ALTER TABLE ${tableB.id}\nADD CONSTRAINT fk_${tableB.id}_${colB.name}\nFOREIGN KEY (${colB.name}) REFERENCES ${tableA.id}(${colA.name});`,
                  },
                });
              }
            }
          });
        });
      });
    });
  } catch (err) {
    console.warn('Erreur sur les suggestions FK:', err);
  }

  return { tables, edges: fkEdges };
}