import React from 'react';
import { Handle, Position } from '@xyflow/react';

export default function TableNode({ data, id }) {
  return (
    <div className="table-card">
      <div className="table-header">
        <div className="header-actions">
          {data.inserts && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                data.onOpenInserts?.();
              }}
              className="data-btn"
              title="Voir les données"
            >
              📋
            </button>
          )}
        </div>
        <span className="header-title">{data.name}</span>
        <div className="header-spacer" />
      </div>

      <div className="table-body">
        {(data.columns || []).map((col) => (
          <div key={col.name} className="table-col">
            
            <Handle
              type="target"
              position={Position.Left}
              id={`${id}-${col.name}-left-target`}
              className="col-handle col-handle-left"
            />
            <Handle
              type="source"
              position={Position.Left}
              id={`${id}-${col.name}-left-source`}
              className="col-handle col-handle-left"
            />

            <div className="col-name">
              {col.name}
              {col.isPk ? <span>🔑</span> : null}
              {col.isNotNull && !col.isPk ? <span className="badge-notnull">*</span> : null}
              {col.comment ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    data.onOpenComment?.(col);
                  }}
                  className="comment-btn"
                  title="Voir le commentaire"
                >
                  💬
                </button>
              ) : null}
            </div>
            
            <div className="col-type">
              {col.type}
            </div>

            <Handle
              type="source"
              position={Position.Right}
              id={`${id}-${col.name}-right-source`}
              className="col-handle col-handle-right"
            />
            <Handle
              type="target"
              position={Position.Right}
              id={`${id}-${col.name}-right-target`}
              className="col-handle col-handle-right"
            />
          </div>
        ))}
      </div>
    </div>
  );
}